require('./helpers/testEnv.js');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocket } = require('ws');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const Room = require('../src/domain/entities/Room');

describe('Nghiệm thu Task COT-595: [2.4] [BE] Bộ đếm thời gian Timer 60s và logic tự động xử thua do mất kết nối', () => {
  let server;
  let roomHub;
  let roomManager;
  let mockUserRepo;
  let port;
  let hostUser;
  let opponentUser;
  let spectatorUser;
  let testRoom;
  let updatedEloUsers;

  const fakeTokenService = {
    verifyAccessToken(token) {
      if (token === 'host-token') return hostUser;
      if (token === 'opp-token') return opponentUser;
      if (token === 'spec-token') return spectatorUser;
      const err = new Error('Invalid token');
      err.code = 'INVALID_TOKEN';
      throw err;
    },
  };

  beforeEach(async () => {
    roomManager = new RoomManager();
    updatedEloUsers = new Map();

    mockUserRepo = {
      async updateElo(userId, newElo) {
        updatedEloUsers.set(Number(userId), Number(newElo));
        return { id: userId, eloRating: newElo };
      },
    };

    hostUser = { id: 301, username: 'hostPlayer301', displayName: 'Chủ Phòng 301', eloRating: 1000 };
    opponentUser = { id: 302, username: 'oppPlayer302', displayName: 'Đối Thủ 302', eloRating: 1000 };
    spectatorUser = { id: 303, username: 'specPlayer303', displayName: 'Khán Giả 303' };

    testRoom = new Room({
      code: '666666',
      name: 'Phòng Timeout COT-595',
      hostId: hostUser.id,
      hostUser,
    });
    roomManager.rooms.set(testRoom.code, testRoom);

    roomHub = new RoomHub({
      roomManager,
      tokenService: fakeTokenService,
      userRepository: mockUserRepo,
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 150,
      reconnectCountdownSeconds: 60,
      enableHeartbeat: false,
    });

    server = http.createServer();
    server.on('upgrade', (req, socket, head) => {
      roomHub.handleUpgrade(req, socket, head);
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    roomHub.close();
    await new Promise((resolve) => server.close(resolve));
  });

  function connectClient(token, roomCode = testRoom.code) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room?token=${token}&roomCode=${roomCode}`);
      const messages = [];

      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          messages.push(data.toString());
        }
      });
    });
  }

  function waitForMessage(messages, type, timeoutMs = 1500) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        const found = messages.find((m) => m && m.type === type);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for message type "${type}". Received: ${JSON.stringify(messages)}`));
        }
      }, 20);
    });
  }

  // AC 1 & AC 2: Quá 60s xử thua đúng người mất kết nối & chốt kết quả duy nhất 1 lần
  describe('1. Quá 60s tự động xử thua đúng người mất kết nối & Chốt kết quả đúng một lần', () => {
    test('Hết 60s chờ: Tự động xử thua bên mất kết nối, đối thủ thắng, khóa bàn cờ và chốt đúng 1 lần', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');
      const spec = await connectClient('spec-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');
      await waitForMessage(spec.messages, 'Connected');

      // Bắt đầu ván đấu
      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Host (bên Đỏ) bị mất kết nối đột ngột
      host.ws.close();
      await waitForMessage(opp.messages, 'PlayerDisconnected');

      // Giả lập timer 60s đếm ngược hết và kích hoạt handleDisconnectTimeout
      await roomHub.handleDisconnectTimeout(testRoom, hostUser.id, 'RED');

      // 1. Đối thủ nhận được thông báo kết thúc trận
      const matchEndedMsg = await waitForMessage(opp.messages, 'matchEnded');
      assert.strictEqual(matchEndedMsg.winner, 'black', 'Bên Đen (Đối thủ) phải là bên Thắng');
      assert.strictEqual(matchEndedMsg.reason, 'DISCONNECT_TIMEOUT');
      assert.strictEqual(matchEndedMsg.loserUserId, hostUser.id);
      assert.strictEqual(matchEndedMsg.winnerUserId, opponentUser.id);
      assert.match(matchEndedMsg.message, /do đối thủ mất kết nối quá thời gian quy định/i);

      // Khán giả cũng nhận được thông báo kết thúc
      const specMatchEnded = await waitForMessage(spec.messages, 'matchEnded');
      assert.strictEqual(specMatchEnded.winner, 'black');

      // 2. Chốt kết quả đúng một lần (Idempotency)
      const prevEloCalls = updatedEloUsers.size;
      const historyLength = testRoom.history.length;
      await roomHub.handleDisconnectTimeout(testRoom, hostUser.id, 'RED');
      assert.strictEqual(testRoom.history.length, historyLength, 'Không được tạo trùng lặp lịch sử trận đấu');

      opp.ws.close();
      spec.ws.close();
    });
  });

  // AC 3: Tính điểm Elo chuẩn xác theo công thức K=32 & Lưu lịch sử
  describe('2. Tính điểm Elo chuẩn xác theo công thức K=32 & Lưu lịch sử ván cờ', () => {
    test('Cập nhật Elo theo công thức K=32: Thắng +16, Thua -16 khi 2 người cùng 1000 Elo', async () => {
      hostUser.eloRating = 1000;
      opponentUser.eloRating = 1000;

      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Opponent (bên Đen) bị mất kết nối
      opp.ws.close();
      await waitForMessage(host.messages, 'PlayerDisconnected');

      // Hết 60s xử thua bên Đen
      await roomHub.handleDisconnectTimeout(testRoom, opponentUser.id, 'BLACK');

      const matchEndedMsg = await waitForMessage(host.messages, 'matchEnded');
      assert.strictEqual(matchEndedMsg.winner, 'red');

      // Kiểm tra công thức K=32 khi 1000 vs 1000:
      // Expected = 0.5 -> Winner: +16, Loser: -16
      assert.strictEqual(matchEndedMsg.winnerEloChange, 16, 'Điểm Elo bên Thắng tăng 16');
      assert.strictEqual(matchEndedMsg.loserEloChange, -16, 'Điểm Elo bên Thua giảm 16');
      assert.strictEqual(matchEndedMsg.winnerNewElo, 1016);
      assert.strictEqual(matchEndedMsg.loserNewElo, 984);

      // Kiểm tra lưu vào repository / database
      assert.strictEqual(updatedEloUsers.get(hostUser.id), 1016, 'Elo Host cập nhật vào CSDL phải là 1016');
      assert.strictEqual(updatedEloUsers.get(opponentUser.id), 984, 'Elo Opponent cập nhật vào CSDL phải là 984');

      // Kiểm tra lưu lịch sử trận đấu
      assert.strictEqual(testRoom.history.length, 1);
      assert.strictEqual(testRoom.history[0].endReason, 'DISCONNECT_TIMEOUT');
      assert.strictEqual(testRoom.history[0].winnerUserId, hostUser.id);
      assert.strictEqual(testRoom.history[0].loserUserId, opponentUser.id);

      host.ws.close();
    });

    test('Cập nhật Elo theo công thức K=32 khi chênh lệch trình độ (1200 vs 1000)', async () => {
      hostUser.eloRating = 1200;
      testRoom.players.red.eloRating = 1200;
      opponentUser.eloRating = 1000;

      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Host (1200 Elo) mất kết nối quá 60s -> Thua Opponent (1000 Elo)
      host.ws.close();
      await waitForMessage(opp.messages, 'PlayerDisconnected');

      await roomHub.handleDisconnectTimeout(testRoom, hostUser.id, 'RED');

      const matchEndedMsg = await waitForMessage(opp.messages, 'matchEnded');
      assert.strictEqual(matchEndedMsg.winner, 'black');

      // 1000 Elo thắng 1200 Elo: Expected = 1/(1+10^(200/400)) ≈ 0.24 -> change = round(32 * (1 - 0.24)) = +24
      assert.strictEqual(matchEndedMsg.winnerEloChange, 24, 'Bên cửa dưới thắng nhận +24 Elo');
      assert.strictEqual(matchEndedMsg.loserEloChange, -24, 'Bên cửa trên thua bị trừ 24 Elo');
      assert.strictEqual(matchEndedMsg.winnerNewElo, 1024);
      assert.strictEqual(matchEndedMsg.loserNewElo, 1176);

      opp.ws.close();
    });
  });

  // AC 4: Chuyển phòng sang Chờ trận mới an toàn & Chuyển quyền Host nếu Host mất mạng
  describe('3. Chuyển phòng sang Chờ trận mới & Chuyển quyền Chủ phòng khi Host mất mạng', () => {
    test('Nếu người mất mạng là Host: Phòng chuyển sang Chờ trận mới và chuyển quyền Chủ phòng cho Đối thủ', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Host mất mạng
      host.ws.close();
      await waitForMessage(opp.messages, 'PlayerDisconnected');

      await roomHub.handleDisconnectTimeout(testRoom, hostUser.id, 'RED');

      // Phòng chuyển sang WAITING_OPPONENT (không bị tự đóng phòng)
      assert.strictEqual(testRoom.status, 'WAITING_OPPONENT');
      assert.notStrictEqual(testRoom.status, 'CLOSED', 'Phòng tuyệt đối không tự đóng');

      // Chuyển giao quyền Chủ phòng cho Đối thủ
      assert.strictEqual(testRoom.hostId, opponentUser.id, 'Đối thủ trở thành Chủ phòng mới');
      assert.strictEqual(testRoom.players.red.id, opponentUser.id, 'Đối thủ chuyển lên làm Chủ phòng (ghế Đỏ)');

      // Đối thủ nhận được thông báo HostTransferred
      const hostTransferredMsg = await waitForMessage(opp.messages, 'HostTransferred');
      assert.strictEqual(hostTransferredMsg.newHostId, opponentUser.id);

      opp.ws.close();
    });
  });

  // AC 5: Xử lý ngoại lệ sự cố hệ thống (Cả 2 cùng mất kết nối)
  describe('4. Ngoại lệ sự cố hệ thống (Cả 2 cùng mất kết nối)', () => {
    test('Cả 2 cùng mất kết nối: Hủy trận SYSTEM_ERROR, không tự trao thắng và không thay đổi Elo', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');
      const spec = await connectClient('spec-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');
      await waitForMessage(spec.messages, 'Connected');

      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Cả 2 cùng ngắt kết nối (Sự cố mạng hoặc server crash)
      host.ws.close();
      opp.ws.close();

      await new Promise((r) => setTimeout(r, 50));

      // Kích hoạt timeout khi cả 2 đều không còn kết nối.
      // REV2-02: cửa sổ của Đỏ hết trước thì phải CHỜ (Đen còn trong cửa sổ của mình);
      // chỉ khi cửa sổ của Đen cũng hết mới huỷ ván SYSTEM_ERROR.
      await roomHub.handleDisconnectTimeout(testRoom, hostUser.id, 'RED');
      roomHub.clearDisconnectTimer(testRoom.code, 'RED');
      roomHub.clearDisconnectTimer(testRoom.code, 'BLACK');
      await roomHub.handleDisconnectTimeout(testRoom, opponentUser.id, 'BLACK');

      // Khán giả nhận thông báo SYSTEM_ERROR
      const endedMsg = await waitForMessage(spec.messages, 'matchEnded');
      assert.strictEqual(endedMsg.winner, null, 'Không tự trao thắng cho ai');
      assert.strictEqual(endedMsg.reason, 'SYSTEM_ERROR');
      assert.strictEqual(updatedEloUsers.size, 0, 'Tuyệt đối không thay đổi Elo của bất kỳ ai');

      spec.ws.close();
    });
  });
});
