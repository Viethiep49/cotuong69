require('./helpers/testEnv.js');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocket } = require('ws');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const Room = require('../src/domain/entities/Room');

describe('Nghiệm thu Task COT-594: [2.4] [BE] Xử lý Auto-reconnect và khôi phục (Load) toàn bộ trạng thái ván cờ từ Auto Save', () => {
  let server;
  let roomHub;
  let roomManager;
  let port;
  let hostUser;
  let opponentUser;
  let testRoom;

  const fakeTokenService = {
    verifyAccessToken(token) {
      if (token === 'host-token') return hostUser;
      if (token === 'opp-token') return opponentUser;
      const err = new Error('Invalid token');
      err.code = 'INVALID_TOKEN';
      throw err;
    },
  };

  beforeEach(async () => {
    roomManager = new RoomManager();
    hostUser = { id: 201, username: 'playerRed', displayName: 'Kỳ Thủ Đỏ' };
    opponentUser = { id: 202, username: 'playerBlack', displayName: 'Kỳ Thủ Đen' };

    testRoom = new Room({
      code: '777777',
      name: 'Phòng Reconnect COT-594',
      hostId: hostUser.id,
      hostUser,
    });
    roomManager.rooms.set(testRoom.code, testRoom);

    roomHub = new RoomHub({
      roomManager,
      tokenService: fakeTokenService,
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

  // AC 1 & AC 2: Nhận diện Reconnect trong 60s, hủy Timer và gửi snapshot
  describe('1. Nhận diện Reconnect trong 60 giây và Khôi phục nguyên vẹn ván cờ', () => {
    test('Người chơi mất mạng kết nối lại trong 60s: hủy đếm ngược, tải đúng snapshot 32 quân, lượt đi và đồng hồ tiếp tục', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      // Bắt đầu trận đấu
      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));

      const startMsg = await waitForMessage(host.messages, 'GameStarted');
      const originalMatchId = startMsg.matchId;

      // Đỏ (Host) đi nước Pháo b2 -> e2 (Vào Pháo đầu)
      host.ws.send(JSON.stringify({ type: 'move', from: 'b2', to: 'e2' }));
      const moveRes = await waitForMessage(host.messages, 'moveResult');
      assert.strictEqual(moveRes.accepted, true);
      assert.strictEqual(testRoom.matchState.currentTurn, 'black');

      // Giả lập Đen ngắt kết nối (drop mạng)
      opp.ws.close();

      const disconnectNotice = await waitForMessage(host.messages, 'PlayerDisconnected');
      assert.strictEqual(disconnectNotice.userId, opponentUser.id);
      assert.strictEqual(testRoom.matchState.isPaused, true);
      // BE-06: timer theo từng bên
      const hasTimer = Array.from(roomHub.disconnectTimers.keys()).some((key) => key.startsWith(`${testRoom.code}:`));
      assert.ok(hasTimer, 'Timer 60s phải đang hoạt động');

      const frozenClock = testRoom.matchState.turnRemainingSeconds;

      // Đen kết nối lại trong 60s bằng token cũ
      await new Promise((r) => setTimeout(r, 100));
      const oppReconnected = await connectClient('opp-token');

      // 1. Nhận sự kiện reconnectState chứa snapshot vẹn toàn
      const reconnectMsg = await waitForMessage(oppReconnected.messages, 'reconnectState');
      assert.ok(reconnectMsg.snapshot, 'Phải có trường snapshot');
      assert.strictEqual(reconnectMsg.snapshot.matchId, originalMatchId, 'TUYỆT ĐỐI KHÔNG tạo trận mới khi tải lại');
      assert.strictEqual(reconnectMsg.snapshot.currentTurn, 'black', 'Lượt đi phải được giữ nguyên là bên Đen');
      assert.strictEqual(reconnectMsg.role, 'PLAYER');
      assert.strictEqual(reconnectMsg.side, 'BLACK');

      // Kiểm tra vị trí quân cờ trên bàn: Nước cờ b2 -> e2 trước đó phải còn nguyên
      const cannonPiece = reconnectMsg.snapshot.board.find((p) => p.id === 'red-cannon-b2');
      assert.ok(cannonPiece, 'Quân Pháo Đỏ phải tồn tại trên bàn');
      assert.strictEqual(cannonPiece.position, 'e2', 'Vị trí Pháo Đỏ phải là e2 như trước khi mất mạng');

      // 2. Hủy bộ đếm thời gian 60s
      const hasTimerAfter = Array.from(roomHub.disconnectTimers.keys()).some((key) => key.startsWith(`${testRoom.code}:`));
      assert.strictEqual(hasTimerAfter, false, 'Timer 60s phải được hủy ngay khi kết nối lại');
      assert.strictEqual(testRoom.reconnectState, null, 'reconnectState phải được dọn dẹp');

      // 3. Ván đấu tiếp tục, đồng hồ lượt đi tiếp tục từ số giây đã lưu
      assert.strictEqual(testRoom.matchState.isPaused, false, 'Trận đấu không còn bị tạm dừng');
      assert.strictEqual(testRoom.matchState.turnRemainingSeconds, frozenClock, 'Đồng hồ lượt đi tiếp tục từ số giây chính thức');

      // 4. Đối thủ (Host) nhận được thông báo Reconnected
      const oppReconnectedNotice = await waitForMessage(host.messages, 'opponentReconnected');
      assert.strictEqual(oppReconnectedNotice.player, 'black');

      // 5. Đen đi tiếp nước đi hợp lệ: Mã b9 -> c7
      oppReconnected.ws.send(JSON.stringify({ type: 'move', from: 'b9', to: 'c7' }));
      const oppMoveRes = await waitForMessage(oppReconnected.messages, 'moveResult');
      assert.strictEqual(oppMoveRes.accepted, true);
      assert.strictEqual(testRoom.matchState.currentTurn, 'red', 'Sau khi Đen đi tiếp thì chuyển lượt sang Đỏ');

      host.ws.close();
      oppReconnected.ws.close();
    });
  });

  // AC 3: Xử lý ngoại lệ - Trận đấu đã kết thúc trong lúc vắng mặt
  describe('2. Xử lý ngoại lệ khi trận đấu đã kết thúc trong lúc vắng mặt', () => {
    test('Nếu trận đấu đã kết thúc trong lúc vắng mặt, trả về kết quả đã chốt và không cho đi quân', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      await new Promise((r) => setTimeout(r, 40));
      host.ws.send(JSON.stringify({ type: 'start' }));
      await waitForMessage(host.messages, 'GameStarted');

      // Opponent ngắt kết nối
      opp.ws.close();
      await waitForMessage(host.messages, 'PlayerDisconnected');

      // Giả lập trận đấu đã kết thúc trong lúc vắng mặt (ví dụ xử thua do quá giờ hoặc đối thủ thắng)
      testRoom.status = 'FINISHED';
      testRoom.matchState.status = 'completed';
      testRoom.matchState.winner = 'red';
      testRoom.matchState.endReason = 'DISCONNECT_TIMEOUT';

      // Opponent kết nối lại sau khi ván đã chốt kết quả
      const oppReconnected = await connectClient('opp-token');
      const connMsg = await waitForMessage(oppReconnected.messages, 'Connected');

      assert.strictEqual(connMsg.room.status, 'FINISHED');
      assert.strictEqual(testRoom.status, 'FINISHED', 'Trạng thái phòng phải là FINISHED');

      // Thử gửi nước đi -> Bị từ chối
      oppReconnected.ws.send(JSON.stringify({ type: 'move', from: 'b9', to: 'c7' }));
      const errorMsg = await waitForMessage(oppReconnected.messages, 'error');
      assert.strictEqual(errorMsg.code, 'GAME_NOT_PLAYING', 'Máy chủ từ chối nước đi khi trận đã kết thúc');

      host.ws.close();
      oppReconnected.ws.close();
    });
  });
});
