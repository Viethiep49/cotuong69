require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-625:
 * [4.1] [BE] WebSocket trung chuyển tin nhắn Text Chat phòng riêng giữa hai người chơi.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/useCases/registerUser');
const LoginUserUseCase = require('../src/application/useCases/loginUser');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { createServer } = require('../src/server');

describe('Nghiệm thu Task COT-625: WebSocket trung chuyển tin nhắn Text Chat phòng riêng giữa hai người chơi', () => {
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

  let otherHostUser;
  let otherHostToken;
  let otherOppUser;
  let otherOppToken;

  let room1;
  let room2;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    userRepo = new PgUserRepository({ db });
    registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    loginUseCase = new LoginUserUseCase({ userRepository: userRepo });
    roomManager = new RoomManager();
    roomHub = new RoomHub({ roomManager });

    // Users phòng 1
    hostUser = await registerUseCase.execute({
      username: 'chat_host',
      displayName: 'Chủ Phòng Đức Tài',
      email: 'chat_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    const hLog = await loginUseCase.execute({ username: 'chat_host', password: 'StrongPassword123' });
    hostToken = hLog.token;

    oppUser = await registerUseCase.execute({
      username: 'chat_opp',
      displayName: 'Đối Thủ Cờ Hay',
      email: 'chat_opp@cotuong.vn',
      password: 'StrongPassword123',
    });
    const oLog = await loginUseCase.execute({ username: 'chat_opp', password: 'StrongPassword123' });
    oppToken = oLog.token;

    specUser = await registerUseCase.execute({
      username: 'chat_spec',
      displayName: 'Khán Giả Xem Cờ',
      email: 'chat_spec@cotuong.vn',
      password: 'StrongPassword123',
    });
    const sLog = await loginUseCase.execute({ username: 'chat_spec', password: 'StrongPassword123' });
    specToken = sLog.token;

    // Users phòng 2
    otherHostUser = await registerUseCase.execute({
      username: 'other_host',
      displayName: 'Chủ Phòng B',
      email: 'other_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    const ohLog = await loginUseCase.execute({ username: 'other_host', password: 'StrongPassword123' });
    otherHostToken = ohLog.token;

    otherOppUser = await registerUseCase.execute({
      username: 'other_opp',
      displayName: 'Đối Thủ B',
      email: 'other_opp@cotuong.vn',
      password: 'StrongPassword123',
    });
    const ooLog = await loginUseCase.execute({ username: 'other_opp', password: 'StrongPassword123' });
    otherOppToken = ooLog.token;

    // Tạo 2 phòng riêng biệt
    room1 = roomManager.createRoom({ hostUser, name: 'Phòng Đấu 1' });
    room2 = roomManager.createRoom({ hostUser: otherHostUser, name: 'Phòng Đấu 2' });

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

  function waitForMessage(messages, predicate, timeoutMs = 2000) {
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

  describe('1. Quyền sử dụng & Phân quyền riêng tư giữa Người chơi và Khán giả (COT-625)', () => {
    test('Chủ phòng và Đối thủ gửi nhận tin nhắn Text Chat thành công, hiển thị đầy đủ tên, nội dung, thời gian', async () => {
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room1.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room1.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Host gửi tin nhắn
      hostWs.send(JSON.stringify({ type: 'chat', text: 'Chào bạn, ván này chơi vui nhé!' }));

      // Cả Host và Opponent đều nhận được ChatMessage
      const oppReceived = await waitForMessage(oppMsgs, (m) => m.type === 'ChatMessage');
      assert.equal(oppReceived.text, 'Chào bạn, ván này chơi vui nhé!');
      assert.equal(oppReceived.senderId, hostUser.id);
      assert.ok(oppReceived.senderName);
      assert.equal(oppReceived.roomCode, room1.code);
      assert.ok(oppReceived.timestamp > 0);

      const hostReceived = await waitForMessage(hostMsgs, (m) => m.type === 'ChatMessage');
      assert.equal(hostReceived.id, oppReceived.id);

      hostWs.close();
      oppWs.close();
    });

    test('Khán giả tuyệt đối không nhìn thấy và không gửi được tin nhắn Chat riêng', async () => {
      const testRoom = roomManager.createRoom({ hostUser, name: 'Phòng Bảo Mật Chat' });

      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, testRoom.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, testRoom.code);
      const { ws: specWs, messages: specMsgs } = await connectWs(specToken, testRoom.code);

      await waitForMessage(specMsgs, (m) => m.type === 'Connected' && m.role === 'SPECTATOR');

      // 1. Khán giả thử gửi chat -> Máy chủ từ chối với mã lỗi FORBIDDEN
      specWs.send(JSON.stringify({ type: 'chat', text: 'Tôi là khán giả muốn nhắn tin!' }));
      const forbiddenErr = await waitForMessage(specMsgs, (m) => m.type === 'error' && m.code === 'FORBIDDEN');
      assert.ok(forbiddenErr.message.includes('Chỉ hai người chơi'));

      // 2. Hai người chơi nhắn tin qua lại
      hostWs.send(JSON.stringify({ type: 'chat', text: 'Bí mật chiến thuật giữa 2 người chơi' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'ChatMessage');

      // Chờ một chút để đảm bảo spectator hoàn toàn không nhận được tin nhắn
      await new Promise((r) => setTimeout(r, 100));
      const leakedMessage = specMsgs.find((m) => m.type === 'ChatMessage');
      assert.equal(leakedMessage, undefined, 'Khán giả tuyệt đối không được nhận ChatMessage');

      hostWs.close();
      oppWs.close();
      specWs.close();
    });
  });

  describe('2. Kiểm tra tính hợp lệ & Cách ly tin nhắn giữa các Room (COT-625)', () => {
    test('Không cho phép gửi tin nhắn rỗng hoặc chỉ chứa khoảng trắng', async () => {
      const emptyRoom = roomManager.createRoom({ hostUser, name: 'Phòng Test Rỗng' });
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, emptyRoom.code);
      const { ws: oppWs } = await connectWs(oppToken, emptyRoom.code);

      // Gửi rỗng
      hostWs.send(JSON.stringify({ type: 'chat', text: '' }));
      const emptyErr1 = await waitForMessage(hostMsgs, (m) => m.type === 'error' && m.code === 'EMPTY_MESSAGE');
      assert.ok(emptyErr1);

      // Gửi toàn khoảng trắng
      hostWs.send(JSON.stringify({ type: 'chat', text: '     ' }));
      const emptyErr2 = await waitForMessage(hostMsgs, (m) => m.type === 'error' && m.code === 'EMPTY_MESSAGE');
      assert.ok(emptyErr2);

      hostWs.close();
      oppWs.close();
    });

    test('Cách ly hoàn toàn giữa các Room: Tin nhắn của Room 1 không bao giờ phát sang Room 2', async () => {
      const r1 = roomManager.createRoom({ hostUser, name: 'Phòng Cách Ly 1' });
      const r2 = roomManager.createRoom({ hostUser: otherHostUser, name: 'Phòng Cách Ly 2' });

      const { ws: r1HostWs, messages: r1HostMsgs } = await connectWs(hostToken, r1.code);
      const { ws: r1OppWs, messages: r1OppMsgs } = await connectWs(oppToken, r1.code);

      const { ws: r2HostWs, messages: r2HostMsgs } = await connectWs(otherHostToken, r2.code);
      const { ws: r2OppWs, messages: r2OppMsgs } = await connectWs(otherOppToken, r2.code);

      await waitForMessage(r1OppMsgs, (m) => m.type === 'Connected');
      await waitForMessage(r2OppMsgs, (m) => m.type === 'Connected');

      // Gửi tin nhắn ở Room 1
      r1HostWs.send(JSON.stringify({ type: 'chat', text: 'Tin nhắn nội bộ Phòng 1' }));
      await waitForMessage(r1OppMsgs, (m) => m.type === 'ChatMessage');

      // Chờ kiểm tra Room 2 không hề nhận được
      await new Promise((r) => setTimeout(r, 100));
      const r2Received = r2HostMsgs.concat(r2OppMsgs).find((m) => m.type === 'ChatMessage');
      assert.equal(r2Received, undefined, 'Tin nhắn phòng 1 không được rò rỉ sang phòng 2');

      r1HostWs.close();
      r1OppWs.close();
      r2HostWs.close();
      r2OppWs.close();
    });
  });

  describe('3. Thay đổi vai trò & Độc lập với trạng thái ván cờ (COT-625)', () => {
    test('Người mất vai trò (bị hạ quyền xuống Khán giả) lập tức mất quyền Chat', async () => {
      const demoteRoom = roomManager.createRoom({ hostUser, name: 'Phòng Test Demote Chat' });

      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, demoteRoom.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, demoteRoom.code);

      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Chủ phòng hạ quyền Đối thủ
      hostWs.send(JSON.stringify({ type: 'demote' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'RoleChanged');

      // Đối thủ (giờ là Khán giả) thử gửi tin nhắn -> Bị từ chối FORBIDDEN
      oppWs.send(JSON.stringify({ type: 'chat', text: 'Tôi vừa bị demote nhưng vẫn muốn chat' }));
      const forbidden = await waitForMessage(oppMsgs, (m) => m.type === 'error' && m.code === 'FORBIDDEN');
      assert.ok(forbidden);

      hostWs.close();
      oppWs.close();
    });

    test('Chat độc lập hoàn toàn với trận đấu: không đổi lượt, không ảnh hưởng bàn cờ và trạng thái', async () => {
      const matchRoom = roomManager.createRoom({ hostUser, name: 'Phòng Chat Trận Đấu' });

      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, matchRoom.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, matchRoom.code);

      // Cả hai sẵn sàng và bắt đầu trận
      hostWs.send(JSON.stringify({ type: 'ready', isReady: true }));
      oppWs.send(JSON.stringify({ type: 'ready', isReady: true }));
      await waitForMessage(hostMsgs, (m) => m.type === 'ReadyStateChanged' && m.allReady === true);

      hostWs.send(JSON.stringify({ type: 'start' }));
      const startEvt = await waitForMessage(hostMsgs, (m) => m.type === 'GameStarted');
      assert.equal(startEvt.room.status, 'PLAYING');

      // Gửi chat trong trận đấu
      hostWs.send(JSON.stringify({ type: 'chat', text: 'Nước cờ hay đấy!' }));
      const chatEvt = await waitForMessage(oppMsgs, (m) => m.type === 'ChatMessage');
      assert.equal(chatEvt.text, 'Nước cờ hay đấy!');

      // Trạng thái phòng vẫn là PLAYING, không bị reset hay gián đoạn
      assert.equal(matchRoom.status, 'PLAYING');
      assert.equal(matchRoom.matchId, startEvt.matchId);

      hostWs.close();
      oppWs.close();
    });
  });
});
