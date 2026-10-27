require('./helpers/testEnv.js');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { WebSocket } = require('ws');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const Room = require('../src/domain/entities/Room');

describe('Nghiệm thu Task COT-593: [2.4] [BE] Xây dựng cơ chế Heartbeat (Ping/Pong) phát hiện mạng chập chờn và mất kết nối', () => {
  let server;
  let roomHub;
  let roomManager;
  let port;
  let hostUser;
  let opponentUser;
  let spectatorUser;
  let testRoom;

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
    hostUser = { id: 101, username: 'hostPlayer', displayName: 'Chủ Phòng' };
    opponentUser = { id: 102, username: 'oppPlayer', displayName: 'Đối Thủ' };
    spectatorUser = { id: 103, username: 'spectator1', displayName: 'Khán Giả' };

    testRoom = new Room({
      code: '888888',
      name: 'Phòng Test COT-593',
      hostId: hostUser.id,
      hostUser,
    });
    roomManager.rooms.set(testRoom.code, testRoom);

    roomHub = new RoomHub({
      roomManager,
      tokenService: fakeTokenService,
      heartbeatIntervalMs: 50, // Chu kỳ ping nhanh trong kiểm thử
      heartbeatTimeoutMs: 150, // Timeout nhanh trong kiểm thử
      reconnectCountdownSeconds: 60,
      enableHeartbeat: false, // Quản lý thủ công theo từng kịch bản
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

  // AC 1: Tín hiệu Heartbeat (Ping/Pong)
  describe('1. Tín hiệu Heartbeat (Ping/Pong) định kỳ & Ghi nhận timestamp', () => {
    test('Máy chủ phát gói Ping định kỳ và cập nhật lastSeen / lastPong khi nhận gói Pong', async () => {
      const { ws, messages } = await connectClient('host-token');
      await waitForMessage(messages, 'Connected');

      // Kích hoạt chu kỳ Ping
      roomHub.checkHeartbeats();

      const pingMsg = await waitForMessage(messages, 'ping');
      assert.ok(pingMsg.timestamp, 'Gói ping phải có trường timestamp');

      // Lấy metadata socket hiện tại trên Hub
      const socketEntries = Array.from(roomHub.clients.entries());
      assert.strictEqual(socketEntries.length, 1);
      const [, meta] = socketEntries[0];
      const previousPong = meta.lastPong;

      // Client gửi phản hồi Pong
      await new Promise((r) => setTimeout(r, 20));
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));

      await new Promise((r) => setTimeout(r, 50));
      assert.ok(meta.lastPong >= previousPong, 'lastPong của socket phải được cập nhật mới nhất sau khi nhận pong');

      ws.close();
    });
  });

  // AC 2: Phát hiện mất kết nối quá thời hạn không có phản hồi
  describe('2. Phát hiện mất kết nối (Quá 10-15s không có phản hồi)', () => {
    test('Socket không gửi Pong quá thời gian quy định bị máy chủ đánh dấu mất kết nối và ngắt kết nối', async () => {
      const { ws, messages } = await connectClient('host-token');
      await waitForMessage(messages, 'Connected');

      // Giả lập socket không phản hồi vượt ngưỡng heartbeatTimeoutMs
      const socketEntries = Array.from(roomHub.clients.entries());
      const [, meta] = socketEntries[0];
      meta.lastSeen = Date.now() - 200; // Quá 150ms timeout

      let closedCode = null;
      ws.on('close', (code) => {
        closedCode = code;
      });

      // Thực thi kiểm tra Heartbeat
      roomHub.checkHeartbeats();

      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(closedCode, 4008, 'Socket phải bị đóng với mã 4008 do Heartbeat timeout');
      assert.strictEqual(roomHub.clients.size, 0, 'Socket đã bị loại bỏ khỏi danh sách active clients');
    });
  });

  // AC 3 & AC 4: Tạm dừng trận đấu, bảo lưu Turn Timer & Bộ đếm 60 giây khi mất mạng
  describe('3. Tạm dừng trận đấu, đóng băng đồng hồ nước đi & Bộ đếm 60s trên máy chủ', () => {
    test('Khi trận đấu đang diễn ra, người chơi mất kết nối -> Trận đấu tạm dừng, Turn Timer đóng băng và bộ đếm 60s kích hoạt', async () => {
      // 1. Host và Opponent cùng vào phòng
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');
      const spec = await connectClient('spec-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');
      await waitForMessage(spec.messages, 'Connected');

      // 2. Cả 2 cùng Ready và Start trận đấu
      host.ws.send(JSON.stringify({ type: 'ready', isReady: true }));
      opp.ws.send(JSON.stringify({ type: 'ready', isReady: true }));

      await new Promise((r) => setTimeout(r, 50));
      host.ws.send(JSON.stringify({ type: 'start' }));

      await waitForMessage(host.messages, 'GameStarted');
      await waitForMessage(opp.messages, 'GameStarted');
      assert.strictEqual(testRoom.status, 'PLAYING', 'Trạng thái phòng phải là PLAYING');
      assert.strictEqual(testRoom.matchState.status, 'active');
      assert.strictEqual(testRoom.matchState.turnRemainingSeconds, 60);

      // Cho ván cờ chạy 100ms
      await new Promise((r) => setTimeout(r, 100));

      // 3. Đối thủ (Opponent) đột ngột ngắt kết nối (mất mạng)
      opp.ws.close();

      // Chờ máy chủ xử lý sự kiện ngắt kết nối
      const oppDisconnectMsg = await waitForMessage(host.messages, 'PlayerDisconnected');
      assert.strictEqual(oppDisconnectMsg.userId, opponentUser.id, 'Người ngắt mạng phải là opponentUser');
      assert.strictEqual(oppDisconnectMsg.side, 'BLACK');
      assert.strictEqual(oppDisconnectMsg.countdownSeconds, 60, 'Thời gian đếm ngược phải bắt đầu từ 60 giây');

      // Khán giả cũng nhận được thông báo
      const specMsg = await waitForMessage(spec.messages, 'PlayerDisconnected');
      assert.strictEqual(specMsg.userId, opponentUser.id);

      // Thông báo tương thích chuẩn frontend ReconnectManager
      const bannerMsg = await waitForMessage(host.messages, 'opponentDisconnected');
      assert.strictEqual(bannerMsg.countdownSeconds, 60);

      // 4. Kiểm tra trạng thái đóng băng ván cờ và Turn timer
      assert.strictEqual(testRoom.matchState.isPaused, true, 'Ván đấu phải được đánh dấu tạm dừng');
      assert.ok(testRoom.matchState.turnRemainingSeconds <= 60, 'Thời gian lượt đi phải được chốt lại');
      const frozenSeconds = testRoom.matchState.turnRemainingSeconds;

      // Ghế người chơi trong phòng TUYỆT ĐỐI không bị xóa trong thời hạn chờ
      assert.ok(testRoom.players.black, 'Ghế bên Đen vẫn được giữ cho đối thủ kết nối lại');
      assert.strictEqual(testRoom.players.black.id, opponentUser.id);

      // Chờ thêm 150ms để kiểm tra đồng hồ lượt đi không bị trừ thêm
      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(testRoom.getRemainingTurnSeconds(), frozenSeconds, 'Đồng hồ nước đi không được trừ khi đang tạm dừng chờ reconnect');

      // 5. Kiểm tra bộ đếm 60s tại máy chủ
      assert.ok(roomHub.disconnectTimers.has(testRoom.code), 'Máy chủ phải duy trì disconnect timer cho phòng');
      assert.ok(testRoom.reconnectState, 'Room phải ghi nhận reconnectState');
      assert.strictEqual(testRoom.reconnectState.disconnectedUserId, opponentUser.id);

      host.ws.close();
      spec.ws.close();
    });

    test('Trước khi trận đấu bắt đầu, nếu thành viên rời phòng thì xử lý rời phòng bình thường', async () => {
      const host = await connectClient('host-token');
      const opp = await connectClient('opp-token');

      await waitForMessage(host.messages, 'Connected');
      await waitForMessage(opp.messages, 'Connected');

      // Chưa bắt đầu trận (status !== 'PLAYING') -> Opponent rời đi
      opp.ws.close();

      const userLeftMsg = await waitForMessage(host.messages, 'UserLeft');
      assert.strictEqual(userLeftMsg.userId, opponentUser.id);
      assert.strictEqual(testRoom.players.black, null, 'Trước trận đấu thì rời phòng sẽ làm trống ghế');

      host.ws.close();
    });
  });
});
