require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-626:
 * [4.2] [BE] Xử lý sự kiện Drop kết nối và ngắt cuộc gọi Video Call chủ động.
 *
 * Nghiệm thu theo đúng các Tiêu chí chấp nhận (Acceptance Criteria) trong Jira:
 *  1. Rời cuộc gọi chủ động giải phóng tài nguyên và đóng WebRTC sạch sẽ.
 *  2. Xử lý sự kiện Drop kết nối (rớt mạng/đóng socket) dọn dẹp an toàn và báo cho đối thủ.
 *  3. Dọn dẹp Video Call khi thay đổi vai trò (Demote) hoặc thành viên bị loại (Kick).
 *  4. Cleanup lặp không gây lỗi hệ thống (Idempotent cleanup).
 *  5. Có thể gọi lại sau khi phiên cũ kết thúc.
 *  6. Cuộc gọi và việc ngắt cuộc gọi tuyệt đối không làm thay đổi trạng thái trận đấu.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-626: Xử lý sự kiện Drop kết nối và ngắt cuộc gọi Video Call chủ động', () => {
  let userRepo;
  let registerUseCase;
  let loginUseCase;
  let roomManager;
  let roomHub;
  let server;
  let serverPort;

  let hostUser;
  let hostToken;
  let oppUser;
  let oppToken;
  let specUser;
  let specToken;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });
    roomManager = new RoomManager();
    roomHub = new RoomHub({ roomManager });

    // Host
    hostUser = await registerUseCase.execute({
      username: 'drop_host',
      displayName: 'Kỳ Thủ Trần Đức Tài',
      email: 'drop_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    const hLog = await loginUseCase.execute({ username: 'drop_host', password: 'StrongPassword123' });
    hostToken = hLog.token;

    // Opponent
    oppUser = await registerUseCase.execute({
      username: 'drop_opp',
      displayName: 'Kỳ Thủ Đối Phương',
      email: 'drop_opp@cotuong.vn',
      password: 'StrongPassword123',
    });
    const oLog = await loginUseCase.execute({ username: 'drop_opp', password: 'StrongPassword123' });
    oppToken = oLog.token;

    // Spectator
    specUser = await registerUseCase.execute({
      username: 'drop_spec',
      displayName: 'Khán Giả',
      email: 'drop_spec@cotuong.vn',
      password: 'StrongPassword123',
    });
    const sLog = await loginUseCase.execute({ username: 'drop_spec', password: 'StrongPassword123' });
    specToken = sLog.token;

    server = createServer({
      db,
      userRepository: userRepo,
      roomHub,
      roomOptions: { roomManager },
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    roomHub.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  });

  function createFreshRoom() {
    const room = roomManager.createRoom({ hostUser, name: 'Phòng Video Call Test' });
    room.addParticipant(oppUser);
    room.addParticipant(specUser);
    return room;
  }

  function connectWs(token, roomCode) {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${serverPort}/ws/room?token=${token}&roomCode=${roomCode}`;
      const ws = new WebSocket(url);
      const messages = [];

      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          messages.push(data.toString());
        }
      });

      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', (err) => reject(err));
    });
  }

  function waitForMessage(messages, predicate, timeoutMs = 3000) {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        const found = messages.find(predicate);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for message after ${timeoutMs}ms. Received: ${JSON.stringify(messages)}`));
        }
      }, 25);
    });
  }

  describe('AC 1: Rời cuộc gọi chủ động (Active Hangup / Leave)', () => {
    test('Người dùng bấm rời cuộc gọi: Dọn dẹp trạng thái videoCall và phát CallEnded tới cả 2 người chơi', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Khởi tạo và chấp nhận cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');
      assert.equal(room.videoCall.status, 'CONNECTED');

      // Đối thủ chủ động bấm Rời cuộc gọi (call:leave)
      oppWs.send(JSON.stringify({ type: 'call:leave', reason: 'USER_HANGUP' }));

      // Cả 2 nhận thông báo CallEnded
      const hostEnded = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded');
      assert.equal(hostEnded.reason, 'USER_HANGUP');
      assert.equal(hostEnded.endedBy, oppUser.id);

      const oppEnded = await waitForMessage(oppMsgs, (m) => m.type === 'CallEnded');
      assert.equal(oppEnded.reason, 'USER_HANGUP');

      assert.equal(room.videoCall, null, 'room.videoCall phải được dọn dẹp sạch sẽ về null');

      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 2: Drop kết nối / Rớt mạng khi đang trong cuộc gọi', () => {
    test('Khi một bên ngắt kết nối WebSocket (Drop): Máy chủ dọn dẹp cuộc gọi và báo CallEnded tới bên còn lại', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Bắt đầu cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');
      assert.equal(room.videoCall.status, 'CONNECTED');

      // Giả lập Đối thủ đột ngột rớt mạng (đóng socket)
      oppWs.close();

      // Host nhận được CallEnded với lý do PEER_DISCONNECTED
      const dropEnded = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded' && m.reason === 'PEER_DISCONNECTED');
      assert.equal(dropEnded.endedBy, oppUser.id);
      assert.match(dropEnded.message, /Đối thủ đã mất kết nối hoặc rời cuộc gọi/i);

      assert.equal(room.videoCall, null, 'room.videoCall đã được dọn dẹp an toàn');

      hostWs.close();
    });
  });

  describe('AC 3: Thay đổi vai trò (Demote) và Loại thành viên (Kick)', () => {
    test('Khi Host demote Đối thủ xuống Khán giả: Cuộc gọi video lập tức bị dọn dẹp với lý do PEER_DEMOTED', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Bắt đầu cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');

      // Host demote Đối thủ
      hostWs.send(JSON.stringify({ type: 'demote' }));

      // Cả 2 nhận được CallEnded vì đối thủ bị chuyển xuống Khán giả
      const callEnded = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded' && m.reason === 'PEER_DEMOTED');
      assert.ok(callEnded);
      assert.equal(room.videoCall, null);

      hostWs.close();
      oppWs.close();
    });

    test('Khi Host kick Đối thủ ra khỏi phòng: Cuộc gọi video lập tức bị dọn dẹp với lý do PEER_KICKED', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Bắt đầu cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');

      // Host kick Đối thủ
      hostWs.send(JSON.stringify({ type: 'kick', targetUserId: oppUser.id }));

      const callEnded = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded' && m.reason === 'PEER_KICKED');
      assert.ok(callEnded);
      assert.equal(room.videoCall, null);

      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 4 & AC 5: Cleanup lặp an toàn & Khả năng gọi lại sau khi phiên cũ kết thúc', () => {
    test('AC 4: Cleanup lặp (gửi call:leave nhiều lần) không gây lỗi hệ thống', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');

      // Gửi call:leave khi không có cuộc gọi nào
      hostWs.send(JSON.stringify({ type: 'call:leave' }));
      const msg1 = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded');
      assert.equal(msg1.reason, 'ALREADY_ENDED');

      // Gửi tiếp lần nữa
      hostWs.send(JSON.stringify({ type: 'call:leave' }));
      const msg2 = await waitForMessage(hostMsgs, (m, idx) => idx > 1 && m.type === 'CallEnded');
      assert.ok(msg2);

      // Gọi hàm domain lặp lại trực tiếp
      assert.equal(room.endVideoCall(), null);
      assert.equal(room.endVideoCall(), null);

      hostWs.close();
    });

    test('AC 5: Sau khi dọn dẹp cuộc gọi cũ, có thể thực hiện cuộc gọi mới bình thường', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Phiên gọi 1
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');

      // Rời phiên gọi 1
      hostWs.send(JSON.stringify({ type: 'call:leave' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallEnded');
      assert.equal(room.videoCall, null);

      // Bắt đầu Phiên gọi 2: Opponent gọi cho Host
      oppWs.send(JSON.stringify({ type: 'call:request' }));
      const incoming2 = await waitForMessage(hostMsgs, (m, idx) => m.type === 'CallIncoming' && m.callerId === oppUser.id);
      assert.ok(incoming2.callId);

      hostWs.send(JSON.stringify({ type: 'call:accept' }));
      const accept2 = await waitForMessage(oppMsgs, (m, idx) => idx > 3 && m.type === 'CallAccepted');
      assert.equal(accept2.callId, incoming2.callId);
      assert.equal(room.videoCall.status, 'CONNECTED');

      // Dọn dẹp
      hostWs.send(JSON.stringify({ type: 'call:leave' }));
      await waitForMessage(oppMsgs, (m, idx) => idx > 4 && m.type === 'CallEnded');

      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 6: Độc lập với ván cờ', () => {
    test('Rời cuộc gọi hoặc drop video tuyệt đối không làm dừng đồng hồ, không đổi lượt, không tạo kết quả thua', async () => {
      const room = createFreshRoom();
      room.readyStates.add(hostUser.id);
      room.readyStates.add(oppUser.id);
      room.startGame(hostUser.id);

      assert.equal(room.status, 'PLAYING');
      const startTurn = room.matchState.currentTurn;

      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Gọi và chấp nhận
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');

      // Rời cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:leave' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallEnded');

      // Trạng thái ván cờ giữ nguyên
      assert.equal(room.status, 'PLAYING');
      assert.equal(room.matchState.currentTurn, startTurn);
      assert.equal(room.matchState.isPaused, false);
      assert.equal(room.matchState.winner, null);

      hostWs.close();
      oppWs.close();
    });
  });
});
