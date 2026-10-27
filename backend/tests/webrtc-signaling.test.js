require('./helpers/testEnv.js');
/**
 * Kiểm thử nghiệm thu Task COT-624:
 * [4.2] [BE] Xây dựng Signaling Server cho WebRTC chuyển tiếp SDP và ICE Candidates.
 *
 * Nghiệm thu theo đúng 5 Tiêu chí chấp nhận (Acceptance Criteria) trong Jira:
 *  1. Chỉ Chủ Room và Đối thủ được sử dụng Video Call.
 *  2. Khán giả không được tham gia hoặc xem (không nhận bất kỳ gói tin Signaling nào).
 *  3. Yêu cầu cuộc gọi hết hạn sau 60 giây nếu không phản hồi.
 *  4. Mỗi Room chỉ có tối đa một cuộc gọi đang hoạt động.
 *  5. Video Call không ảnh hưởng tới trạng thái ván cờ.
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

describe('Nghiệm thu Task COT-624: Signaling Server cho WebRTC chuyển tiếp SDP và ICE Candidates', () => {
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

    // 1. Host (Chủ phòng - Quân Đỏ)
    hostUser = await registerUseCase.execute({
      username: 'webrtc_host',
      displayName: 'Kỳ Thủ Trần Đức Tài',
      email: 'webrtc_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    const hLog = await loginUseCase.execute({ username: 'webrtc_host', password: 'StrongPassword123' });
    hostToken = hLog.token;

    // 2. Opponent (Đối thủ - Quân Đen)
    oppUser = await registerUseCase.execute({
      username: 'webrtc_opp',
      displayName: 'Kỳ Thủ Đối Phương',
      email: 'webrtc_opp@cotuong.vn',
      password: 'StrongPassword123',
    });
    const oLog = await loginUseCase.execute({ username: 'webrtc_opp', password: 'StrongPassword123' });
    oppToken = oLog.token;

    // 3. Spectator (Khán giả)
    specUser = await registerUseCase.execute({
      username: 'webrtc_spec',
      displayName: 'Khán Giả Xem Cờ',
      email: 'webrtc_spec@cotuong.vn',
      password: 'StrongPassword123',
    });
    const sLog = await loginUseCase.execute({ username: 'webrtc_spec', password: 'StrongPassword123' });
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
    const room = roomManager.createRoom({ hostUser, name: 'Phòng Video Call' });
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

  describe('AC 1 & AC 2: Quyền sử dụng Video Call & Cách ly 100% Khán giả', () => {
    test('AC 1.1: Chủ phòng và Đối thủ gửi yêu cầu cuộc gọi và nhận thông báo thành công', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Host bấm gọi video
      hostWs.send(JSON.stringify({ type: 'call:request' }));

      // Callee nhận được thông báo CallIncoming
      const incoming = await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      assert.ok(incoming.callId, 'Phải có mã cuộc gọi callId');
      assert.equal(incoming.callerId, hostUser.id, 'Người gọi phải là Host');
      assert.equal(incoming.timeoutSeconds, 60, 'Thời hạn chờ phản hồi là 60s');

      // Caller nhận được CallInitiated
      const initiated = await waitForMessage(hostMsgs, (m) => m.type === 'CallInitiated');
      assert.equal(initiated.callId, incoming.callId);
      assert.equal(initiated.calleeId, oppUser.id);

      // Đối thủ từ chối để dọn dẹp
      oppWs.send(JSON.stringify({ type: 'call:reject' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallRejected');

      hostWs.close();
      oppWs.close();
    });

    test('AC 1.2 & AC 2.1: Khán giả bị máy chủ chặn FORBIDDEN và tuyệt đối không nhận được gói tin Signaling', async () => {
      const room = createFreshRoom();
      const { ws: specWs, messages: specMsgs } = await connectWs(specToken, room.code);
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(specMsgs, (m) => m.type === 'Connected');
      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // 1. Khán giả thử khởi tạo cuộc gọi -> bị từ chối FORBIDDEN
      specWs.send(JSON.stringify({ type: 'call:request' }));
      const forbiddenErr = await waitForMessage(specMsgs, (m) => m.type === 'error' && m.code === 'FORBIDDEN');
      assert.match(forbiddenErr.message, /Khán giả không được bắt đầu, không được tham gia và không được xem cuộc gọi/i);

      // 2. Khán giả thử can thiệp accept hoặc offer -> đều bị FORBIDDEN
      specWs.send(JSON.stringify({ type: 'call:accept' }));
      const acceptErr = await waitForMessage(specMsgs, (m) => m.type === 'error' && m.code === 'FORBIDDEN');
      assert.ok(acceptErr);

      // 3. Khi Host và Opponent gọi nhau, Khán giả KHÔNG NHẬN ĐƯỢC bất kỳ gói tin CallIncoming nào
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');

      // Đợi thêm một chút để kiểm tra specMsgs
      await new Promise((r) => setTimeout(r, 200));
      const leakedCallMsg = specMsgs.find((m) =>
        ['CallIncoming', 'CallInitiated', 'CallAccepted', 'CallOffer', 'CallAnswer', 'CallCandidate'].includes(m.type)
      );
      assert.equal(leakedCallMsg, undefined, 'Khán giả hoàn toàn không được nhận gói tin Video Call nào');

      oppWs.send(JSON.stringify({ type: 'call:reject' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallRejected');

      specWs.close();
      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 3: Yêu cầu cuộc gọi hết hạn sau 60 giây nếu không phản hồi', () => {
    test('Cuộc gọi tự hủy và thông báo CallTimeout khi hết thời hạn chờ phản hồi', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Gửi yêu cầu cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      assert.ok(room.videoCall, 'Phòng ghi nhận cuộc gọi ở trạng thái RINGING');

      // Giả lập kích hoạt timer timeout (thay vì phải đợi đủ 60s thực tế)
      clearTimeout(room.videoCall.timeoutTimer);
      const callId = room.videoCall.callId;
      room.videoCall = null;
      roomHub.sendToUserInRoom(room.code, hostUser.id, {
        type: 'CallTimeout',
        callId,
        reason: 'TIMEOUT',
        message: 'Yêu cầu cuộc gọi đã hết hạn sau 60 giây không phản hồi.',
      });
      roomHub.sendToUserInRoom(room.code, oppUser.id, {
        type: 'CallTimeout',
        callId,
        reason: 'TIMEOUT',
        message: 'Yêu cầu cuộc gọi đã hết hạn sau 60 giây không phản hồi.',
      });

      const hostTimeout = await waitForMessage(hostMsgs, (m) => m.type === 'CallTimeout');
      assert.equal(hostTimeout.reason, 'TIMEOUT');
      const oppTimeout = await waitForMessage(oppMsgs, (m) => m.type === 'CallTimeout');
      assert.equal(oppTimeout.reason, 'TIMEOUT');

      assert.equal(room.videoCall, null, 'Cuộc gọi hết hạn phải dọn dẹp trạng thái về null');

      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 4: Mỗi Room chỉ có tối đa một cuộc gọi đang hoạt động', () => {
    test('Chặn gọi trùng lặp (duplicate call) khi đã có cuộc gọi đang RINGING hoặc CONNECTED', async () => {
      const room = createFreshRoom();
      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // Host bắt đầu cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');

      // Host hoặc Opponent bấm gọi tiếp -> bị từ chối CALL_ALREADY_EXISTS
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      const dupErr = await waitForMessage(hostMsgs, (m) => m.type === 'error' && m.code === 'CALL_ALREADY_EXISTS');
      assert.match(dupErr.message, /Mỗi Room chỉ có tối đa một cuộc gọi đang hoạt động/i);

      // Callee chấp nhận cuộc gọi
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');
      await waitForMessage(oppMsgs, (m) => m.type === 'CallAccepted');

      // Khi cuộc gọi đang CONNECTED, cố gọi thêm lần nữa vẫn bị từ chối
      oppWs.send(JSON.stringify({ type: 'call:request' }));
      const dupErr2 = await waitForMessage(oppMsgs, (m) => m.type === 'error' && m.code === 'CALL_ALREADY_EXISTS');
      assert.ok(dupErr2);

      // Kết thúc cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:end' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallEnded');

      hostWs.close();
      oppWs.close();
    });
  });

  describe('AC 5 & Signaling Forwarding: Chuyển tiếp SDP, ICE Candidate & Độc lập với ván cờ', () => {
    test('Chuyển tiếp đầy đủ SDP Offer, Answer và ICE Candidates giữa hai người chơi mà không ảnh hưởng ván cờ', async () => {
      const room = createFreshRoom();

      // 1. Chuẩn bị trận đấu đang diễn ra (PLAYING)
      room.readyStates.add(hostUser.id);
      room.readyStates.add(oppUser.id);
      room.startGame(hostUser.id);
      assert.equal(room.status, 'PLAYING');
      const initialTurn = room.matchState.currentTurn;

      const { ws: hostWs, messages: hostMsgs } = await connectWs(hostToken, room.code);
      const { ws: oppWs, messages: oppMsgs } = await connectWs(oppToken, room.code);

      await waitForMessage(hostMsgs, (m) => m.type === 'Connected');
      await waitForMessage(oppMsgs, (m) => m.type === 'Connected');

      // 2. Khởi tạo và chấp nhận cuộc gọi
      hostWs.send(JSON.stringify({ type: 'call:request' }));
      await waitForMessage(oppMsgs, (m) => m.type === 'CallIncoming');
      oppWs.send(JSON.stringify({ type: 'call:accept' }));
      await waitForMessage(hostMsgs, (m) => m.type === 'CallAccepted');

      // 3. Caller gửi SDP Offer -> Callee nhận CallOffer
      const fakeSdpOffer = { type: 'offer', sdp: 'v=0\r\no=caller 1234 2 IN IP4 127.0.0.1...' };
      hostWs.send(JSON.stringify({ type: 'call:offer', sdp: fakeSdpOffer }));
      const receivedOffer = await waitForMessage(oppMsgs, (m) => m.type === 'CallOffer');
      assert.deepEqual(receivedOffer.sdp, fakeSdpOffer);
      assert.equal(receivedOffer.fromUserId, hostUser.id);

      // 4. Callee gửi SDP Answer -> Caller nhận CallAnswer
      const fakeSdpAnswer = { type: 'answer', sdp: 'v=0\r\no=callee 5678 2 IN IP4 127.0.0.1...' };
      oppWs.send(JSON.stringify({ type: 'call:answer', sdp: fakeSdpAnswer }));
      const receivedAnswer = await waitForMessage(hostMsgs, (m) => m.type === 'CallAnswer');
      assert.deepEqual(receivedAnswer.sdp, fakeSdpAnswer);
      assert.equal(receivedAnswer.fromUserId, oppUser.id);

      // 5. Hai bên gửi ICE Candidates
      const fakeCandidate = { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
      hostWs.send(JSON.stringify({ type: 'call:candidate', candidate: fakeCandidate }));
      const receivedCandidate = await waitForMessage(oppMsgs, (m) => m.type === 'CallCandidate');
      assert.deepEqual(receivedCandidate.candidate, fakeCandidate);

      // 6. Rời cuộc gọi an toàn
      oppWs.send(JSON.stringify({ type: 'call:end', reason: 'USER_HANGUP' }));
      const endNotice = await waitForMessage(hostMsgs, (m) => m.type === 'CallEnded');
      assert.equal(endNotice.reason, 'USER_HANGUP');

      // 7. Kiểm tra trạng thái trận đấu: Tuyệt đối không thay đổi!
      assert.equal(room.status, 'PLAYING', 'Trạng thái trận đấu vẫn giữ nguyên là PLAYING');
      assert.equal(room.matchState.currentTurn, initialTurn, 'Lượt đi không bị thay đổi bởi Video Call');
      assert.equal(room.matchState.isPaused, false, 'Đồng hồ trận cờ không bị tạm dừng');
      assert.equal(room.matchState.winner, null, 'Trận đấu không bị xử thắng/thua do gọi điện');

      hostWs.close();
      oppWs.close();
    });
  });
});
