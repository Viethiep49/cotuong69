const { getClientIp, roomLookupLimiter } = require('../http/middlewares/rateLimiter');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../../application/services/tokenService');
const { safeDecode } = require('../../core/safeDecode');
const { onlineUserManager: defaultOnlineUserManager } = require('../../infrastructure/database/repositories/OnlineUserManager');
const PgPvpMatchRepository = require('../../infrastructure/database/repositories/PgPvpMatchRepository');
const { roomManager: defaultRoomManager } = require('../../infrastructure/database/repositories/RoomManager');

/**
 * BE-07: kiểm tra dữ liệu signaling WebRTC trước khi relay.
 */
function isValidSdp(sdp) {
  // Chấp nhận cả chuỗi SDP thuần và RTCSessionDescription { type, sdp }
  if (typeof sdp === 'string') return sdp.length > 0 && sdp.length < 20000;
  if (sdp && typeof sdp === 'object' && typeof sdp.sdp === 'string') {
    return sdp.sdp.length > 0 && sdp.sdp.length < 20000;
  }
  return false;
}

function isValidCandidate(candidate) {
  if (typeof candidate === 'string') return candidate.length > 0 && candidate.length < 4000;
  if (!candidate || typeof candidate !== 'object') return false;
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length >= 4000) return false;
  return true;
}

/**
 * BE-07: message signaling phải trỏ đúng cuộc gọi đang diễn ra.
 */
function isSameCall(payload, room) {
  if (!room || !room.videoCall) return false;
  if (payload.callId === undefined || payload.callId === null || payload.callId === '') return true;
  return String(payload.callId) === String(room.videoCall.callId);
}

class RoomHub {
  constructor({
    roomManager = defaultRoomManager,
    tokenService = { verifyAccessToken },
    userRepository = null,
    heartbeatIntervalMs = 5000,
    heartbeatTimeoutMs = 10000,
    reconnectCountdownSeconds = 60,
    onlineUserManager = defaultOnlineUserManager,
    pvpMatchRepository = null,
    enableHeartbeat = true,
  } = {}) {
    this.roomManager = roomManager;
    this.tokenService = tokenService;
    this.userRepository = userRepository;
    // BE-09: chia sẻ singleton với friends routes để trạng thái online có tác dụng
    this.onlineUserManager = onlineUserManager;
    // REV-06: mặc định phải ghi kết quả vào bảng pvp_matches (trước đây null nên
    // production không bao giờ lưu; chỉ test truyền repo mới có dữ liệu)
    this.pvpMatchRepository = pvpMatchRepository;
    if (!this.pvpMatchRepository) {
      try {
        const PgPvpMatchRepository = require('../../infrastructure/database/repositories/PgPvpMatchRepository');
        this.pvpMatchRepository = new PgPvpMatchRepository();
      } catch {
        this.pvpMatchRepository = null;
      }
    }
    if (!this.userRepository) {
      try {
        const PgUserRepository = require('../../infrastructure/database/repositories/PgUserRepository');
        this.userRepository = new PgUserRepository();
      } catch {
        this.userRepository = null;
      }
    }
    this.heartbeatIntervalMs = Number(heartbeatIntervalMs);
    this.heartbeatTimeoutMs = Number(heartbeatTimeoutMs);
    this.reconnectCountdownSeconds = Number(reconnectCountdownSeconds);

    // BE-07: giới hạn payload 64KB (trước đây mặc định 100MB)
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    // Ánh xạ ConnectionId <-> UserId và Socket metadata
    this.clients = new Map(); // socket -> { connectionId, userId, user, roomCode, role, side, lastSeen, lastPong, connectedAt }
    this.userSockets = new Map(); // userId -> Set<socket>
    this.connectionUsers = new Map(); // connectionId -> userId

    // Gom nhóm kết nối theo từng phòng chơi (Room Group: Room_{roomCode})
    this.roomGroups = new Map(); // roomCode -> Set<socket>

    // Quản lý Timer đếm ngược 60s khi người chơi mất kết nối (COT-593, COT-595)
    this.disconnectTimers = new Map(); // roomCode -> { interval, userId, side }
    // BE-05: timer đồng hồ lượt đi của từng phòng
    this.turnTimers = new Map(); // roomCode -> Timeout
    // BE-07: rate limit chat theo từng socket (5 tin / 3 giây)
    this.chatRate = new Map(); // socket -> number[] (timestamps)
    this.heartbeatTimer = null;

    this.setupWss();

    // REV-07: cho sweeper của RoomManager biết phòng nào còn socket đang mở
    if (this.roomManager && typeof this.roomManager.setLiveSocketChecker === 'function') {
      this.roomManager.setLiveSocketChecker((code) => this.hasLiveSockets(code));
    }

    if (enableHeartbeat) {
      this.startHeartbeat();
    }
  }

  /**
   * REV-01: người này có phải người chơi đang vắng mặt và vừa kết nối lại không?
   * Phải dựa vào reconnectState.bySide (theo TỪNG bên) — field phẳng
   * reconnectState.disconnectedUserId bị người rớt SAU CÙNG ghi đè, nên dùng nó
   * sẽ khiến người vào lại đầu tiên không được nhận diện (hồi quy BE-06).
   * @param {object} room
   * @param {number|string} userId
   * @returns {boolean}
   */
  isReconnectingPlayer(room, userId) {
    if (!room || room.status !== 'PLAYING' || !room.reconnectState) return false;
    const bySide = room.reconnectState.bySide;
    if (!bySide) {
      // Đường cũ (không có bySide): giữ hành vi trước đây
      return Number(room.reconnectState.disconnectedUserId) === Number(userId);
    }
    return ['red', 'black'].some(
      (side) => bySide[side] && Number(bySide[side].disconnectedUserId) === Number(userId),
    );
  }

  /**
   * REV-07: phòng còn ít nhất một socket đang mở?
   * @param {string} code
   * @returns {boolean}
   */
  hasLiveSockets(code) {
    const group = this.roomGroups.get(code);
    return Boolean(group && group.size > 0);
  }

  setupWss() {
    this.wss.on('connection', (socket, request, user, room) => {
      const connectionId = `conn_${crypto.randomUUID()}`;
      const userId = Number(user.id);

      // Nếu phòng đang diễn ra ván đấu và người kết nối lại là người chơi đang bị mất kết nối (COT-594)
      const isReconnectingPlayer = this.isReconnectingPlayer(room, userId);

      if (isReconnectingPlayer) {
        // BE-06: chỉ huỷ bộ đếm của CHÍNH bên này, không đụng bên kia
        const reconnectRole = room.getParticipantRole(userId);
        this.clearDisconnectTimer(room.code, reconnectRole && reconnectRole.side);
        const resumeResult = room.resumeMatchAfterReconnect(userId);
        // BE-05 + BE-06: chỉ chạy lại đồng hồ khi KHÔNG còn bên nào vắng
        if (!resumeResult || !resumeResult.stillPaused) {
          this.armTurnTimer(room);
        }
      }

      // Thêm người chơi vào phòng logic (nếu chưa có trong phòng)
      let roleInfo;
      try {
        roleInfo = room.addParticipant(user);
      } catch (err) {
        this.send(socket, { type: 'error', code: err.code || 'ROOM_ERROR', message: err.message });
        socket.close(4001, err.message);
        return;
      }

      // Lưu metadata socket
      const clientMeta = {
        connectionId,
        userId,
        user,
        roomCode: room.code,
        role: roleInfo.role,
        side: roleInfo.side,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        lastPong: Date.now(),
      };
      this.clients.set(socket, clientMeta);

      // Ánh xạ ConnectionId <-> UserId
      this.connectionUsers.set(connectionId, userId);
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(socket);

      // Gom nhóm vào Room Group (Room_{roomCode})
      if (!this.roomGroups.has(room.code)) {
        this.roomGroups.set(room.code, new Set());
      }
      this.roomGroups.get(room.code).add(socket);

      // Gửi sự kiện chào mừng cho chính client vừa kết nối
      this.send(socket, {
        type: 'Connected',
        connectionId,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
        },
        role: roleInfo.role,
        side: roleInfo.side,
        room: room.getSummary(),
      });

      // Nếu là người chơi kết nối lại: gửi snapshot khôi phục trạng thái và broadcast Reconnected
      if (isReconnectingPlayer) {
        this.send(socket, {
          type: 'reconnectState',
          state: room.getSnapshot(),
          snapshot: room.getSnapshot(),
          role: roleInfo.role,
          side: roleInfo.side,
          room: room.getSummary(),
        });

        this.broadcastToRoom(room.code, {
          type: 'PlayerReconnected',
          userId,
          player: roleInfo.side ? roleInfo.side.toLowerCase() : 'opponent',
          side: roleInfo.side,
          roomCode: room.code,
          room: room.getSummary(),
        });

        this.broadcastToRoom(room.code, {
          type: 'opponentReconnected',
          player: roleInfo.side ? roleInfo.side.toLowerCase() : 'opponent',
          roomCode: room.code,
        });
      } else {
        // Broadcast sự kiện UserJoined thời gian thực tới toàn bộ nhóm phòng
        this.broadcastToRoom(room.code, {
          type: 'UserJoined',
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
          },
          role: roleInfo.role,
          side: roleInfo.side,
          room: room.getSummary(),
        });
      }

      // BE-10: đã có socket thật -> huỷ hẹn giải phóng ghế
      if (this.roomManager && typeof this.roomManager.confirmSeat === 'function') {
        this.roomManager.confirmSeat(room.code, userId);
      }

      // BE-09: đánh dấu user đang IN_GAME để mời bạn bè hoạt động đúng
      if (this.onlineUserManager) {
        this.onlineUserManager.setOnline(userId, 'IN_GAME');
      }

      // Lắng nghe sự kiện từ client
      socket.on('message', (data) => this.handleMessage(socket, data));

      // SEC-03: thiếu listener 'error' khiến frame WS sai (không mask/UTF-8 lỗi) kill process
      socket.on('error', (err) => {
        console.warn('[WS] Lỗi socket:', err && err.message);
        try {
          // BE-07: payload vượt giới hạn -> đóng đúng mã 1009 thay vì ngắt thô (1006)
          if (err && (err.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' || /max payload/i.test(err.message || ''))) {
            socket.close(1009, 'Message too big');
            return;
          }
          socket.terminate();
        } catch {
          /* ignore */
        }
      });

      // Lắng nghe đóng kết nối
      socket.on('close', () => this.handleDisconnect(socket));
    });
  }

  /**
   * REV-05: kiểm tra phiên (status ACTIVE + token chưa bị thu hồi) cho WebSocket.
   * @param {{id:number, iat?:number}} decodedUser
   * @returns {Promise<object|null>}
   */
  async ensureSessionActive(decodedUser) {
    // eslint-disable-next-line global-require
    const { ensureSessionActive } = require('../http/middlewares/authMiddleware');
    return ensureSessionActive(decodedUser, this.userRepository);
  }

  async handleUpgrade(request, socket, head) {
    let urlObj;
    try {
      urlObj = new URL(request.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    // Trích xuất roomCode và token
    let roomCode = urlObj.searchParams.get('roomCode');
    if (!roomCode) {
      const match = urlObj.pathname.match(/^\/ws\/room\/([^/]+)$/);
      if (match) {
        // SEC-03: URI hỏng (vd "%E0") trước đây làm crash process
        roomCode = safeDecode(match[1]);
        if (roomCode === null) {
          socket.destroy();
          return;
        }
      }
    }

    let token = urlObj.searchParams.get('token');
    if (!token) {
      const authHeader = request.headers['authorization'] || request.headers['Authorization'] || '';
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      }
    }

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let decodedUser;
    try {
      decodedUser = this.tokenService.verifyAccessToken(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // REV-05: WS trước đây chỉ verify chữ ký -> token đã bị thu hồi (đổi mật khẩu)
    // hoặc của tài khoản bị khoá vẫn vào phòng chơi được.
    if (this.userRepository && typeof this.userRepository.findById === 'function') {
      try {
        await this.ensureSessionActive(decodedUser);
      } catch (err) {
        const status = Number(err && err.statusCode) === 403 ? '403 Forbidden' : '401 Unauthorized';
        try {
          socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        } catch {
          /* ignore */
        }
        socket.destroy();
        return;
      }
    }

    if (!roomCode) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const room = this.roomManager.findByCode(roomCode);
    if (!room) {
      // REV-04: mã không tồn tại -> đếm vào hạn mức tra mã phòng của IP này
      roomLookupLimiter.record(`room-lookup:${getClientIp(request)}`);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request, decodedUser, room);
    });
  }

  async handleMessage(socket, rawMessage) {
    // SEC-03: bọc toàn bộ xử lý để một payload xấu không làm sập process
    try {
      await this._handleMessage(socket, rawMessage);
    } catch (err) {
      console.error('[WS] Lỗi xử lý tin nhắn:', err);
      this.send(socket, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Không xử lý được tin nhắn.',
      });
    }
  }

  async _handleMessage(socket, rawMessage) {
    const meta = this.clients.get(socket);
    if (!meta) return;

    meta.lastSeen = Date.now();

    // REV-07: mọi message đều tính là hoạt động của phòng (kể cả pong)
    const activeRoom = this.roomManager.findByCode(meta.roomCode);
    if (activeRoom && typeof activeRoom.touch === 'function') activeRoom.touch();

    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch {
      this.send(socket, { type: 'error', code: 'INVALID_JSON', message: 'Dữ liệu tin nhắn JSON không hợp lệ.' });
      return;
    }

    // SEC-03: JSON "null"/mảng/số không có .type -> trước đây TypeError
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.type !== 'string') {
      this.send(socket, { type: 'error', code: 'INVALID_PAYLOAD', message: 'Tin nhắn không hợp lệ.' });
      return;
    }

    const type = payload.type;

    // 0. Xử lý gói tin Heartbeat Pong từ Client (COT-593)
    if (type === 'pong') {
      meta.lastPong = Date.now();
      return;
    }

    const room = this.roomManager.findByCode(meta.roomCode);
    if (!room) {
      this.send(socket, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Phòng chơi không tồn tại hoặc đã đóng.' });
      return;
    }

    // 1. Phân quyền Socket nghiêm ngặt: Chặn 100% mọi yêu cầu thi đấu hoặc can thiệp ván cờ gửi từ Khán giả
    const roleInfo = room.getParticipantRole(meta.userId);
    const isSpectator = !roleInfo || roleInfo.role === 'SPECTATOR';

    const videoCallActions = [
      'call:request', 'call:start', 'call:accept', 'call:reject',
      'call:offer', 'webrtc:offer', 'call:answer', 'webrtc:answer',
      'call:candidate', 'webrtc:candidate', 'call:end', 'call:leave',
    ];

    if (isSpectator && videoCallActions.includes(type)) {
      this.send(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Khán giả không được bắt đầu, không được tham gia và không được xem cuộc gọi.',
      });
      return;
    }

    if (isSpectator && ['ready', 'start', 'demote', 'kick', 'move'].includes(type)) {
      this.send(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Khán giả chỉ có quyền xem, máy chủ chặn 100% mọi yêu cầu thi đấu hoặc can thiệp ván cờ.',
      });
      return;
    }

    // 2. Chuyển đổi trạng thái Sẵn sàng (ready)
    if (type === 'ready') {
      try {
        const isReady = payload.isReady !== undefined ? Boolean(payload.isReady) : !room.isReady(meta.userId);
        const readyResult = room.setReady(meta.userId, isReady);

        this.broadcastToRoom(room.code, {
          type: 'ReadyStateChanged',
          userId: meta.userId,
          isReady: readyResult.isReady,
          allReady: readyResult.allReady,
          room: room.getSummary(),
        });
      } catch (err) {
        this.send(socket, { type: 'error', code: err.code || 'READY_ERROR', message: err.message });
      }
      return;
    }

    // 3. Bắt đầu trận đấu (start)
    if (type === 'start') {
      // REV-02: đang chốt kết quả ván trước (ghi Elo/DB) -> không cho bắt đầu ván mới
      if (room.settling) {
        this.send(socket, {
          type: 'error',
          code: 'MATCH_SETTLING',
          message: 'Đang tổng kết ván trước, vui lòng thử lại sau 1-2 giây.',
        });
        return;
      }
      try {
        const startResult = room.startGame(meta.userId);
        this.broadcastToRoom(room.code, {
          type: 'GameStarted',
          matchId: startResult.matchId,
          startedAt: startResult.startedAt,
          room: room.getSummary(),
        });
        // BE-05: bắt đầu chạy đồng hồ của lượt đầu tiên
        this.armTurnTimer(room);
      } catch (err) {
        this.send(socket, { type: 'error', code: err.code || 'START_ERROR', message: err.message });
      }
      return;
    }

    // 3.5. Nước đi cờ của người chơi (move)
    if (type === 'move') {
      if (room.status !== 'PLAYING' || !room.matchState) {
        this.send(socket, { type: 'error', code: 'GAME_NOT_PLAYING', message: 'Trận đấu chưa bắt đầu hoặc đã kết thúc.' });
        return;
      }

      if (room.reconnectState || room.matchState.isPaused) {
        this.send(socket, {
          type: 'error',
          code: 'MATCH_PAUSED',
          message: 'Ván đấu đang tạm dừng chờ đối thủ kết nối lại.',
        });
        return;
      }

      const playerColor = roleInfo.side ? roleInfo.side.toLowerCase() : null;
      if (playerColor !== room.matchState.currentTurn) {
        this.send(socket, {
          type: 'error',
          code: 'NOT_YOUR_TURN',
          message: 'Chưa tới lượt đi của bạn.',
        });
        return;
      }

      // SEC-03: toạ độ phải là chuỗi, tránh undefined/kiểu lạ
      if (typeof payload.from !== 'string' || typeof payload.to !== 'string') {
        this.send(socket, { type: 'error', code: 'INVALID_MOVE', message: 'Toạ độ nước đi không hợp lệ.' });
        return;
      }

      const turnStartedAt = room.matchState.turnStartedAt;
      const moveResult = room.applyMove(playerColor, payload.from, payload.to);
      if (!moveResult.accepted) {
        this.send(socket, {
          type: 'error',
          code: 'INVALID_MOVE',
          message: moveResult.error || 'Nước đi không hợp lệ.',
        });
        return;
      }

      // BE-05: trừ đồng hồ theo MILI-GIÂY (trước đây chỉ hiển thị, không bao giờ trừ)
      const elapsedMs = Math.max(0, Date.now() - (turnStartedAt || Date.now()));
      const clocks = room.matchState.remainingClocks;
      if (clocks && Number.isFinite(Number(clocks[playerColor]))) {
        clocks[playerColor] = Math.max(0, Number(clocks[playerColor]) - elapsedMs / 1000);
      }

      // BE-04: chiếu bí / hết nước đi -> kết thúc trận đúng cách qua settleMatch
      if (moveResult.endReason || room.status === 'FINISHED' || room.matchState.status === 'completed') {
        // BE-20: hoà thì không có bên thắng
        const winner = moveResult.isDraw ? null : (moveResult.winnerColor || playerColor);
        await this.settleMatch(room, winner, moveResult.endReason || 'CHECKMATE');
        return;
      }

      this.broadcastToRoom(room.code, {
        type: 'moveResult',
        move: { from: payload.from, to: payload.to, color: playerColor, captured: moveResult.captured },
        state: room.getSnapshot(),
        snapshot: room.getSnapshot(),
        accepted: true,
      });
      // BE-05: chuyển đồng hồ sang lượt đối thủ
      this.armTurnTimer(room);
      return;
    }

    // BE-05: người chơi chủ động xin thua
    if (type === 'resign') {
      if (room.status !== 'PLAYING' || !room.matchState) {
        this.send(socket, { type: 'error', code: 'GAME_NOT_PLAYING', message: 'Trận đấu chưa bắt đầu hoặc đã kết thúc.' });
        return;
      }
      const mySide = roleInfo.side ? roleInfo.side.toLowerCase() : null;
      if (!mySide) {
        this.send(socket, { type: 'error', code: 'FORBIDDEN', message: 'Chỉ người chơi mới được xin thua.' });
        return;
      }
      const opponentSide = mySide === 'red' ? 'black' : 'red';
      await this.settleMatch(room, opponentSide, 'RESIGN', {
        message: `Kỳ thủ bên ${mySide === 'red' ? 'Đỏ' : 'Đen'} đã xin thua.`,
      });
      return;
    }

    // 4. Chủ phòng chuyển đổi Đối thủ xuống Khán giả (demote)
    if (type === 'demote') {
      try {
        const demoteResult = room.demoteOpponent(meta.userId);

        // Hủy cuộc gọi Video Call nếu đối thủ đang trong cuộc gọi (COT-626)
        if (room.videoCall) {
          const callId = room.videoCall.callId;
          const callerId = room.videoCall.callerId;
          const calleeId = room.videoCall.calleeId;
          room.endVideoCall(meta.userId, 'PEER_DEMOTED');
          const endMsg = {
            type: 'CallEnded',
            callId,
            endedBy: meta.userId,
            reason: 'PEER_DEMOTED',
            message: 'Cuộc gọi kết thúc do đối thủ bị chuyển xuống vai trò Khán giả.',
            roomCode: room.code,
          };
          this.sendToUserInRoom(room.code, callerId, endMsg);
          this.sendToUserInRoom(room.code, calleeId, endMsg);
        }

        // Cập nhật lại role trong socket meta của đối thủ bị hạ quyền
        const demotedSockets = this.userSockets.get(Number(demoteResult.demotedUser.id));
        if (demotedSockets) {
          for (const s of demotedSockets) {
            const m = this.clients.get(s);
            if (m && m.roomCode === room.code) {
              m.role = 'SPECTATOR';
              m.side = null;
            }
          }
        }

        this.broadcastToRoom(room.code, {
          type: 'RoleChanged',
          action: 'DEMOTE',
          demotedUserId: demoteResult.demotedUser.id,
          room: room.getSummary(),
        });
      } catch (err) {
        this.send(socket, { type: 'error', code: err.code || 'DEMOTE_ERROR', message: err.message });
      }
      return;
    }

    // 5. Chủ phòng loại (Kick) thành viên ra khỏi phòng
    if (type === 'kick') {
      try {
        const targetUserId = Number(payload.targetUserId);

        // BE-07: kiểm tra quyền kick TRƯỚC — nếu không phải host thì không được
        // kết thúc cuộc gọi của người khác
        const kickResult = room.kickParticipant(meta.userId, targetUserId);

        // Hủy cuộc gọi Video Call nếu người bị kick đang trong cuộc gọi (COT-626)
        if (room.videoCall && (Number(room.videoCall.callerId) === targetUserId || Number(room.videoCall.calleeId) === targetUserId)) {
          const callId = room.videoCall.callId;
          const callerId = room.videoCall.callerId;
          const calleeId = room.videoCall.calleeId;
          room.endVideoCall(meta.userId, 'PEER_KICKED');
          const endMsg = {
            type: 'CallEnded',
            callId,
            endedBy: meta.userId,
            reason: 'PEER_KICKED',
            message: 'Cuộc gọi kết thúc do thành viên bị loại khỏi phòng.',
            roomCode: room.code,
          };
          this.sendToUserInRoom(room.code, callerId, endMsg);
          this.sendToUserInRoom(room.code, calleeId, endMsg);
        }

        this.broadcastToRoom(room.code, {
          type: 'UserKicked',
          kickedUserId: targetUserId,
          room: room.getSummary(),
        });

        // Đóng socket của người bị kick
        const targetSockets = this.userSockets.get(targetUserId);
        if (targetSockets) {
          for (const s of Array.from(targetSockets)) {
            const m = this.clients.get(s);
            if (m && m.roomCode === room.code) {
              this.send(s, { type: 'Kicked', message: 'Bạn đã bị chủ phòng loại khỏi phòng chơi.' });
              s.close(4003, 'Kicked by host');
            }
          }
        }
      } catch (err) {
        this.send(socket, { type: 'error', code: err.code || 'KICK_ERROR', message: err.message });
      }
      return;
    }

    // 6. Chat riêng giữa hai người chơi (COT-625)
    if (type === 'chat' || type === 'chat:send') {
      if (isSpectator) {
        this.send(socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: 'Chỉ hai người chơi đang thi đấu mới được sử dụng Chat riêng. Khán giả không có quyền truy cập.',
        });
        return;
      }

      const text = payload.text || payload.message || '';
      if (typeof text !== 'string' || !text.trim()) {
        this.send(socket, {
          type: 'error',
          code: 'EMPTY_MESSAGE',
          message: 'Không thể gửi tin nhắn rỗng hoặc chỉ chứa khoảng trắng.',
        });
        return;
      }

      // BE-07: giới hạn độ dài + chống spam (5 tin / 3 giây mỗi socket)
      if (text.trim().length > 500) {
        this.send(socket, {
          type: 'error',
          code: 'MESSAGE_TOO_LONG',
          message: 'Tin nhắn tối đa 500 ký tự.',
        });
        return;
      }

      if (!this.isChatAllowed(socket)) {
        this.send(socket, {
          type: 'error',
          code: 'CHAT_RATE_LIMITED',
          message: 'Bạn gửi tin nhắn quá nhanh, vui lòng thử lại sau vài giây.',
        });
        return;
      }

      const chatMsg = {
        type: 'ChatMessage',
        id: `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        roomCode: room.code,
        senderId: meta.userId,
        senderName: meta.user.displayName || meta.user.username,
        side: roleInfo.side,
        text: text.trim(),
        timestamp: Date.now(),
      };

      this.broadcastToPlayers(room, chatMsg);
      return;
    }

    // 7. WebRTC Signaling Server cho Video Call giữa Chủ Room và Đối thủ (COT-624, COT-626)
    if (type === 'call:request' || type === 'call:start') {
      try {
        const initResult = room.initiateVideoCall(meta.userId);
        const timeoutSeconds = 60;

        // Bộ đếm thời gian 60s: Hết hạn yêu cầu cuộc gọi nếu không phản hồi
        room.videoCall.timeoutTimer = setTimeout(() => {
          if (room.videoCall && room.videoCall.callId === initResult.callId && room.videoCall.status === 'RINGING') {
            room.videoCall = null;
            const timeoutMsg = {
              type: 'CallTimeout',
              callId: initResult.callId,
              reason: 'TIMEOUT',
              message: 'Yêu cầu cuộc gọi đã hết hạn sau 60 giây không phản hồi.',
              roomCode: room.code,
            };
            this.sendToUserInRoom(room.code, initResult.callerId, timeoutMsg);
            this.sendToUserInRoom(room.code, initResult.calleeId, timeoutMsg);
          }
        }, timeoutSeconds * 1000);

        if (room.videoCall.timeoutTimer.unref) {
          room.videoCall.timeoutTimer.unref();
        }

        // Báo cho Callee có cuộc gọi đến
        this.sendToUserInRoom(room.code, initResult.calleeId, {
          type: 'CallIncoming',
          callId: initResult.callId,
          callerId: initResult.callerId,
          callerName: meta.user?.displayName || meta.user?.username || 'Đối thủ',
          callerSide: initResult.callerSide,
          timeoutSeconds,
          roomCode: room.code,
        });

        // Báo cho Caller rằng cuộc gọi đã được khởi tạo
        this.send(socket, {
          type: 'CallInitiated',
          callId: initResult.callId,
          calleeId: initResult.calleeId,
          calleeName: initResult.opponent.displayName || initResult.opponent.username || 'Đối thủ',
          timeoutSeconds,
          roomCode: room.code,
        });
      } catch (err) {
        this.send(socket, {
          type: 'error',
          code: err.code || 'CALL_REQUEST_ERROR',
          message: err.message,
        });
      }
      return;
    }

    if (type === 'call:accept') {
      try {
        const acceptResult = room.acceptVideoCall(meta.userId);
        const acceptedMsg = {
          type: 'CallAccepted',
          callId: acceptResult.callId,
          callerId: acceptResult.callerId,
          calleeId: acceptResult.calleeId,
          roomCode: room.code,
        };
        this.sendToUserInRoom(room.code, acceptResult.callerId, acceptedMsg);
        this.sendToUserInRoom(room.code, acceptResult.calleeId, acceptedMsg);
      } catch (err) {
        this.send(socket, {
          type: 'error',
          code: err.code || 'CALL_ACCEPT_ERROR',
          message: err.message,
        });
      }
      return;
    }

    if (type === 'call:reject') {
      try {
        const rejectResult = room.rejectVideoCall(meta.userId, payload.reason);
        const rejectedMsg = {
          type: 'CallRejected',
          callId: rejectResult.callId,
          reason: rejectResult.reason,
          message: rejectResult.cancelledByCaller
            ? 'Người gọi đã hủy yêu cầu cuộc gọi.'
            : 'Đối thủ đã từ chối cuộc gọi.',
          roomCode: room.code,
        };
        this.sendToUserInRoom(room.code, rejectResult.callerId, rejectedMsg);
        this.sendToUserInRoom(room.code, rejectResult.calleeId, rejectedMsg);
      } catch (err) {
        this.send(socket, {
          type: 'error',
          code: err.code || 'CALL_REJECT_ERROR',
          message: err.message,
        });
      }
      return;
    }

    if (type === 'call:offer' || type === 'webrtc:offer') {
      if (!room.videoCall || !['RINGING', 'CONNECTED'].includes(room.videoCall.status)) {
        this.send(socket, {
          type: 'error',
          code: 'CALL_NOT_ACTIVE',
          message: 'Không có phiên cuộc gọi đang hoạt động để gửi SDP Offer.',
        });
        return;
      }

      const targetId = Number(meta.userId) === Number(room.videoCall.callerId)
        ? room.videoCall.calleeId
        : room.videoCall.callerId;

      // BE-07: chỉ relay SDP hợp lệ và đúng cuộc gọi hiện tại
      const offerSdp = payload.sdp || payload.offer;
      if (!isValidSdp(offerSdp) || !isSameCall(payload, room)) {
        this.send(socket, { type: 'error', code: 'INVALID_SDP', message: 'Dữ liệu SDP không hợp lệ.' });
        return;
      }

      this.sendToUserInRoom(room.code, targetId, {
        type: 'CallOffer',
        callId: room.videoCall.callId,
        fromUserId: meta.userId,
        sdp: offerSdp,
        roomCode: room.code,
      });
      return;
    }

    if (type === 'call:answer' || type === 'webrtc:answer') {
      if (!room.videoCall || !['RINGING', 'CONNECTED'].includes(room.videoCall.status)) {
        this.send(socket, {
          type: 'error',
          code: 'CALL_NOT_ACTIVE',
          message: 'Không có phiên cuộc gọi đang hoạt động để gửi SDP Answer.',
        });
        return;
      }

      const targetId = Number(meta.userId) === Number(room.videoCall.callerId)
        ? room.videoCall.calleeId
        : room.videoCall.callerId;

      // BE-07: chỉ relay SDP hợp lệ và đúng cuộc gọi hiện tại
      const answerSdp = payload.sdp || payload.answer;
      if (!isValidSdp(answerSdp) || !isSameCall(payload, room)) {
        this.send(socket, { type: 'error', code: 'INVALID_SDP', message: 'Dữ liệu SDP không hợp lệ.' });
        return;
      }

      this.sendToUserInRoom(room.code, targetId, {
        type: 'CallAnswer',
        callId: room.videoCall.callId,
        fromUserId: meta.userId,
        sdp: answerSdp,
        roomCode: room.code,
      });
      return;
    }

    if (type === 'call:candidate' || type === 'webrtc:candidate') {
      if (!room.videoCall || !['RINGING', 'CONNECTED'].includes(room.videoCall.status)) {
        this.send(socket, {
          type: 'error',
          code: 'CALL_NOT_ACTIVE',
          message: 'Không có phiên cuộc gọi đang hoạt động để gửi ICE Candidate.',
        });
        return;
      }

      const targetId = Number(meta.userId) === Number(room.videoCall.callerId)
        ? room.videoCall.calleeId
        : room.videoCall.callerId;

      // BE-07: validate ICE candidate + đúng cuộc gọi
      if (!isValidCandidate(payload.candidate) || !isSameCall(payload, room)) {
        this.send(socket, { type: 'error', code: 'INVALID_CANDIDATE', message: 'ICE candidate không hợp lệ.' });
        return;
      }

      this.sendToUserInRoom(room.code, targetId, {
        type: 'CallCandidate',
        callId: room.videoCall.callId,
        fromUserId: meta.userId,
        candidate: payload.candidate,
        roomCode: room.code,
      });
      return;
    }

    if (type === 'call:end' || type === 'call:leave') {
      const endResult = room.endVideoCall(meta.userId, payload.reason || 'USER_HANGUP');
      if (endResult) {
        const endedMsg = {
          type: 'CallEnded',
          callId: endResult.callId,
          endedBy: endResult.endedBy,
          reason: endResult.reason,
          roomCode: room.code,
        };
        this.sendToUserInRoom(room.code, endResult.callerId, endedMsg);
        this.sendToUserInRoom(room.code, endResult.calleeId, endedMsg);
      } else {
        // Cleanup lặp an toàn không gây lỗi hệ thống
        this.send(socket, {
          type: 'CallEnded',
          callId: payload.callId || null,
          endedBy: meta.userId,
          reason: 'ALREADY_ENDED',
          roomCode: room.code,
        });
      }
      return;
    }

    // 8. Rời phòng (leave)
    if (type === 'leave') {
      socket.close(1000, 'User left');
      return;
    }
  }

  handleDisconnect(socket, reason = 'DISCONNECT') {
    const meta = this.clients.get(socket);
    if (!meta) return;

    this.clients.delete(socket);
    if (this.chatRate) this.chatRate.delete(socket);

    // Xóa khỏi userSockets
    if (this.userSockets.has(meta.userId)) {
      const set = this.userSockets.get(meta.userId);
      set.delete(socket);
      if (set.size === 0) this.userSockets.delete(meta.userId);
    }
    this.connectionUsers.delete(meta.connectionId);

    // BE-09: chỉ offline khi user không còn socket nào khác
    if (this.onlineUserManager && !this.userSockets.has(meta.userId)) {
      this.onlineUserManager.setOffline(meta.userId);
    }

    // Xóa khỏi room group
    if (this.roomGroups.has(meta.roomCode)) {
      const grp = this.roomGroups.get(meta.roomCode);
      grp.delete(socket);
      if (grp.size === 0) this.roomGroups.delete(meta.roomCode);
    }

    const room = this.roomManager.findByCode(meta.roomCode);
    if (!room) return;

    // Kiểm tra xem user này còn socket nào khác trong cùng phòng không (multi-tab)
    const remainingSockets = this.userSockets.get(meta.userId);
    const hasOtherSocketInRoom = remainingSockets && Array.from(remainingSockets).some((s) => {
      const m = this.clients.get(s);
      return m && m.roomCode === room.code;
    });
    if (hasOtherSocketInRoom) {
      return;
    }

    try {
      // Dọn dẹp Video Call WebRTC nếu người ngắt kết nối đang trong cuộc gọi (COT-624, COT-626)
      if (room && room.videoCall) {
        const callerId = room.videoCall.callerId;
        const calleeId = room.videoCall.calleeId;
        if (Number(callerId) === meta.userId || Number(calleeId) === meta.userId) {
          const peerId = Number(callerId) === meta.userId ? calleeId : callerId;
          const endResult = room.endVideoCall(meta.userId, 'PEER_DISCONNECTED');
          if (endResult) {
            this.sendToUserInRoom(room.code, peerId, {
              type: 'CallEnded',
              callId: endResult.callId,
              endedBy: meta.userId,
              reason: 'PEER_DISCONNECTED',
              message: 'Đối thủ đã mất kết nối hoặc rời cuộc gọi.',
              roomCode: room.code,
            });
          }
        }
      }

      // 1. Nếu ván đấu đang diễn ra và người ngắt kết nối là Người chơi (PLAYER) (COT-593)
      if (room.status === 'PLAYING' && meta.role === 'PLAYER') {
        const pauseResult = room.pauseMatchForDisconnect(meta.userId, this.reconnectCountdownSeconds);
        if (pauseResult) this.clearTurnTimer(room.code);
        if (pauseResult) {
          // Bắt đầu bộ đếm 60 giây tại máy chủ (COT-593, COT-595)
          this.startDisconnectTimer(room, meta.userId, meta.side);

          // Phát thông báo tới đối thủ và toàn bộ khán giả trong phòng
          this.broadcastToRoom(room.code, {
            type: 'PlayerDisconnected',
            userId: meta.userId,
            player: meta.side ? meta.side.toLowerCase() : 'opponent',
            side: meta.side,
            countdownSeconds: this.reconnectCountdownSeconds,
            roomCode: room.code,
            room: room.getSummary(),
          });

          // Tương thích với frontend ReconnectManager
          this.broadcastToRoom(room.code, {
            type: 'opponentDisconnected',
            player: meta.side ? meta.side.toLowerCase() : 'opponent',
            countdownSeconds: this.reconnectCountdownSeconds,
            roomCode: room.code,
          });
        }
        return;
      }

      // 2. Nếu người rời đi là Chủ phòng và ván chưa bắt đầu: Tự động chuyển quyền Chủ phòng
      if (Number(room.hostId) === meta.userId && room.status !== 'PLAYING') {
        const transferResult = room.transferHost();

        if (transferResult.newHostId) {
          // Cập nhật lại role metadata của người trở thành Host mới
          const newHostSockets = this.userSockets.get(transferResult.newHostId);
          if (newHostSockets) {
            for (const s of newHostSockets) {
              const m = this.clients.get(s);
              if (m && m.roomCode === room.code) {
                m.role = 'PLAYER';
                m.side = 'RED';
              }
            }
          }

          this.broadcastToRoom(room.code, {
            type: 'HostTransferred',
            previousHostId: transferResult.oldHostId,
            newHostId: transferResult.newHostId,
            newHost: transferResult.newHost,
            room: room.getSummary(),
          });
        } else {
          // Phòng không còn ai -> đóng phòng
          this.roomManager.closeRoom(room.code, meta.userId);
        }
      } else {
        // Người rời đi là Đối thủ hoặc Khán giả
        room.removeParticipant(meta.userId);
      }

      // Broadcast sự kiện UserLeft
      this.broadcastToRoom(room.code, {
        type: 'UserLeft',
        userId: meta.userId,
        room: room.getSummary(),
      });
    } catch {
      // Bỏ qua lỗi dọn dẹp khi socket ngắt kết nối
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.heartbeatIntervalMs);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  checkHeartbeats() {
    const now = Date.now();
    for (const [socket, meta] of Array.from(this.clients.entries())) {
      if (socket.readyState !== 1) continue;

      // Quá heartbeatTimeoutMs không có phản hồi -> đánh dấu mất kết nối (COT-593)
      if (now - meta.lastSeen >= this.heartbeatTimeoutMs) {
        try {
          socket.close(4008, 'Heartbeat timeout');
        } catch {
          try { socket.terminate(); } catch {}
        }
        this.handleDisconnect(socket, 'HEARTBEAT_TIMEOUT');
        continue;
      }

      // Gửi gói Ping định kỳ mỗi 5 giây
      this.send(socket, {
        type: 'ping',
        timestamp: now,
      });
    }
  }

  /**
   * BE-06: mỗi BÊN có timer riêng (khoá `${roomCode}:${side}`). Trước đây chỉ 1
   * timer/phòng nên người thứ hai rớt mạng huỷ luôn bộ đếm của người thứ nhất.
   */
  startDisconnectTimer(room, userId, side) {
    const sideKey = String(side || '').toLowerCase();
    const timerKey = `${room.code}:${sideKey}`;
    this.clearDisconnectTimer(room.code, side);

    let remaining = this.reconnectCountdownSeconds;
    const interval = setInterval(() => {
      remaining -= 1;
      const bySide = room.reconnectState && room.reconnectState.bySide;
      if (bySide && bySide[sideKey]) {
        bySide[sideKey].countdownSeconds = Math.max(0, remaining);
      }
      if (room.reconnectState) {
        room.reconnectState.countdownSeconds = Math.max(0, remaining);
      }
      if (remaining <= 0) {
        this.clearDisconnectTimer(room.code, side);
        this.handleDisconnectTimeout(room, userId, side);
      }
    }, 1000);

    if (interval.unref) interval.unref();
    this.disconnectTimers.set(timerKey, { interval, userId, side });
  }

  /**
   * @param {string} roomCode
   * @param {string} [side] chỉ xoá timer của một bên; bỏ trống = xoá tất cả của phòng
   */
  clearDisconnectTimer(roomCode, side = null) {
    if (side) {
      const timerKey = `${roomCode}:${String(side).toLowerCase()}`;
      const item = this.disconnectTimers.get(timerKey);
      if (item) {
        clearInterval(item.interval);
        this.disconnectTimers.delete(timerKey);
      }
      return;
    }

    for (const [key, item] of Array.from(this.disconnectTimers.entries())) {
      if (key === roomCode || key.startsWith(`${roomCode}:`)) {
        clearInterval(item.interval);
        this.disconnectTimers.delete(key);
      }
    }
  }

  /**
   * BE-07: token-bucket đơn giản cho chat — tối đa 5 tin trong 3 giây / socket.
   */
  isChatAllowed(socket) {
    const now = Date.now();
    const windowMs = 3000;
    const limit = 5;
    const previous = (this.chatRate.get(socket) || []).filter((t) => now - t < windowMs);
    if (previous.length >= limit) {
      this.chatRate.set(socket, previous);
      return false;
    }
    previous.push(now);
    this.chatRate.set(socket, previous);
    return true;
  }

  /**
   * BE-04: KẾT THÚC VÁN ĐẤU ở một chỗ duy nhất.
   * Trước đây Room.applyMove tự set status FINISHED nhưng hub chỉ broadcast moveResult
   * -> không có matchEnded, không cập nhật Elo, không ghi history, phòng FINISHED
   * từ chối mọi người vào. Giờ mọi nhánh (chiếu bí, hết nước, hết giờ, xin thua,
   * mất kết nối) đều đi qua đây và chỉ chạy 1 lần / ván.
   *
   * @param {object} room
   * @param {'red'|'black'|null} winnerColor null = huỷ ván (SYSTEM_ERROR)
   * @param {'CHECKMATE'|'NO_LEGAL_MOVES'|'TIMEOUT'|'RESIGN'|'DISCONNECT_TIMEOUT'|'SYSTEM_ERROR'} endReason
   * @param {{message?: string, skipElo?: boolean}} [options]
   */
  async settleMatch(room, winnerColor, endReason, options = {}) {
    if (!room || !room.matchState) return null;

    // Idempotent: 1 ván chỉ chốt 1 lần dù nhiều sự kiện cùng lúc
    if (room.matchState.status === 'completed' && room.settledMatchId === room.matchId) {
      return room.lastSettlement || null;
    }

    // REV-02: chốt trạng thái NGAY, TRƯỚC mọi await. Trước đây các bước này nằm
    // sau `await` nên nếu có người bấm "start" trong lúc chờ ghi Elo/DB, ván mới
    // sẽ bị gắn kết quả của ván cũ và ván mới kết thúc mà không có Elo/matchEnded.
    const matchId = room.matchId;
    room.settling = true;
    room.settledMatchId = matchId;
    room.matchState.status = 'completed';
    room.matchState.winner = winnerColor || null;
    room.matchState.endReason = endReason;
    room.matchState.isPaused = false;
    room.status = 'WAITING_OPPONENT';
    room.reconnectState = null;
    room.readyStates.clear();
    this.clearDisconnectTimer(room.code);
    this.clearTurnTimer(room.code);

    try {
      return await this.persistSettlement(room, matchId, winnerColor, endReason, options);
    } finally {
      room.settling = false;
    }
  }

  /**
   * REV-02: phần ghi kết quả (Elo, history, DB, broadcast) — tách ra để
   * settleMatch khoá trạng thái trước khi await.
   * @param {object} room
   * @param {string} matchId mã ván ĐÃ chốt (không đọc lại room.matchId)
   */
  async persistSettlement(room, matchId, winnerColor, endReason, options) {
    const winnerUser = winnerColor ? room.players[winnerColor] : null;
    const loserColor = winnerColor === 'red' ? 'black' : winnerColor === 'black' ? 'red' : null;
    const loserUser = loserColor ? room.players[loserColor] : null;

    let winnerElo = { change: 0, newRating: winnerUser?.eloRating ?? 1000 };
    let loserElo = { change: 0, newRating: loserUser?.eloRating ?? 1000 };

    if (winnerUser && loserUser && !options.skipElo) {
      try {
        const elo = await this.applyEloForResult(winnerUser, loserUser);
        winnerElo = elo.winner;
        loserElo = elo.loser;
        winnerUser.eloRating = winnerElo.newRating;
        loserUser.eloRating = loserElo.newRating;
      } catch (err) {
        console.error('Lỗi khi cập nhật Elo vào database:', err);
      }
    }

    const record = {
      matchId,
      roomCode: room.code,
      winnerUserId: winnerUser ? winnerUser.id : null,
      loserUserId: loserUser ? loserUser.id : null,
      winner: winnerColor || null,
      endReason,
      winnerEloChange: winnerElo.change,
      loserEloChange: loserElo.change,
      finishedAt: new Date(),
    };
    if (!room.history) room.history = [];
    room.history.push(record);

    // BE-18: lưu kết quả vào DB (best-effort, không làm hỏng luồng kết thúc trận)
    if (this.pvpMatchRepository && typeof this.pvpMatchRepository.create === 'function') {
      try {
        await this.pvpMatchRepository.create(record);
      } catch (err) {
        console.error('[pvp_matches] không lưu được kết quả:', err.message);
      }
    }

    room.lastSettlement = record;

    const defaultMessage = winnerColor
      ? `Kỳ thủ bên ${winnerColor === 'red' ? 'Đỏ' : 'Đen'} giành chiến thắng (${endReason}).`
      : 'Trận đấu đã bị huỷ.';

    this.broadcastToRoom(room.code, {
      type: 'matchEnded',
      matchId,
      // `winner` giữ đúng ngữ nghĩa cũ (màu thắng) để client hiện có không vỡ
      winner: winnerColor || null,
      winnerUserId: winnerUser ? winnerUser.id : null,
      loserUserId: loserUser ? loserUser.id : null,
      winnerColor: winnerColor || null,
      winnerSide: winnerColor ? winnerColor.toUpperCase() : null,
      reason: endReason,
      endReason,
      winnerEloChange: winnerElo.change,
      loserEloChange: loserElo.change,
      winnerNewElo: winnerElo.newRating,
      loserNewElo: loserElo.newRating,
      elo: { winner: winnerElo, loser: loserElo },
      message: options.message || defaultMessage,
      room: room.getSummary(),
    });

    return record;
  }

  /**
   * BE-05: chạy đồng hồ của lượt hiện tại ở server. Hết giờ -> xử thua.
   */
  armTurnTimer(room) {
    if (!room) return;
    this.clearTurnTimer(room.code);

    if (room.status !== 'PLAYING' || !room.matchState) return;
    if (room.matchState.isPaused || room.reconnectState) return;

    const color = room.matchState.currentTurn;
    if (color !== 'red' && color !== 'black') return;

    // REV-11: hẹn giờ theo min(thời gian còn của lượt, đồng hồ tổng còn của bên đang đi).
    // Trước đây chỉ theo lượt 60s nên đồng hồ tổng (300s) không bao giờ được thực thi.
    const turnMs = typeof room.getTurnRemainingMs === 'function'
      ? room.getTurnRemainingMs()
      : Math.max(0, Number(room.matchState.turnRemainingSeconds) * 1000);
    const clockMs = typeof room.getClockRemainingMs === 'function'
      ? room.getClockRemainingMs(color)
      : Infinity;
    const clockExpiresFirst = clockMs < turnMs;
    const timeoutMs = Math.round(Math.min(turnMs, clockMs)) + 50;
    const opponentColor = color === 'red' ? 'black' : 'red';
    const matchId = room.matchId;

    const timer = setTimeout(() => {
      this.turnTimers.delete(room.code);
      if (!room.matchState || room.matchId !== matchId) return;
      if (room.status !== 'PLAYING' || room.matchState.isPaused) return;
      if (room.matchState.currentTurn !== color) return;

      const clocks = room.matchState.remainingClocks;
      if (clocks) clocks[color] = 0;

      const sideName = color === 'red' ? 'Đỏ' : 'Đen';
      this.settleMatch(room, opponentColor, 'TIMEOUT', {
        message: clockExpiresFirst
          ? `Kỳ thủ bên ${sideName} hết đồng hồ tổng của ván cờ.`
          : `Kỳ thủ bên ${sideName} hết thời gian suy nghĩ.`,
      }).catch((err) => console.error('[settleMatch] timeout:', err));
    }, timeoutMs);

    if (typeof timer.unref === 'function') timer.unref();
    this.turnTimers.set(room.code, timer);
  }

  clearTurnTimer(roomCode) {
    const timer = this.turnTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.turnTimers.delete(roomCode);
    }
  }

  /**
   * BE-03: tính Elo từ rating thật trong DB và chỉ cộng/trừ DELTA cho cả 2 người
   * trong 1 transaction. Không có DB thì fallback tính theo dữ liệu trong RAM.
   * @returns {Promise<{winner: object, loser: object}>}
   */
  async applyEloForResult(winnerUser, loserUser) {
    const { calculateElo } = require('../../domain/services/eloCalculator');

    if (!winnerUser || !loserUser) {
      return {
        winner: { change: 0, newRating: 1000 },
        loser: { change: 0, newRating: 1000 },
      };
    }

    const repo = this.userRepository;

    let winnerRating = Number(winnerUser.eloRating);
    let loserRating = Number(loserUser.eloRating);

    if (repo && typeof repo.findById === 'function') {
      const [winnerInDb, loserInDb] = await Promise.all([
        repo.findById(winnerUser.id),
        repo.findById(loserUser.id),
      ]);
      if (winnerInDb && Number.isFinite(Number(winnerInDb.eloRating))) winnerRating = Number(winnerInDb.eloRating);
      if (loserInDb && Number.isFinite(Number(loserInDb.eloRating))) loserRating = Number(loserInDb.eloRating);
    }

    if (!Number.isFinite(winnerRating)) winnerRating = 1000;
    if (!Number.isFinite(loserRating)) loserRating = 1000;

    const winner = calculateElo(winnerRating, loserRating, 1, 32);
    const loser = calculateElo(loserRating, winnerRating, 0, 32);

    if (repo && typeof repo.addEloPair === 'function') {
      await repo.addEloPair(
        { userId: winnerUser.id, delta: winner.change },
        { userId: loserUser.id, delta: loser.change },
      );
    } else if (repo && typeof repo.updateElo === 'function') {
      await repo.updateElo(winnerUser.id, winner.newRating);
      await repo.updateElo(loserUser.id, loser.newRating);
    }

    return { winner, loser };
  }

  async handleDisconnectTimeout(room, userId, side) {
    if (!room) return;

    // Đảm bảo chỉ chốt kết quả đúng một lần
    if (room.status !== 'PLAYING' && !room.reconnectState) return;

    // REV-01: bên này có thể đã vào lại trong lúc bộ đếm vừa chạm 0 -> bỏ qua.
    // Trước đây dùng field phẳng nên xử thắng nhầm người đang vắng và đuổi người đang online.
    const timeoutSide = String(side || '').toLowerCase();
    const sideState = room.reconnectState && room.reconnectState.bySide
      ? room.reconnectState.bySide[timeoutSide]
      : null;
    if (sideState && Number(sideState.disconnectedUserId) !== Number(userId)) {
      return; // bộ đếm này không còn thuộc về người đó
    }
    if (!sideState && room.reconnectState && room.reconnectState.bySide) {
      // Bên này đã kết nối lại (bySide[side] = null) -> không xử thua
      return;
    }

    // REV-01: nếu người chơi vừa được đánh dấu timeout mà vẫn còn socket sống trong phòng -> bỏ qua
    const stillConnected = Array.from(this.userSockets.get(Number(userId)) || []).some((sock) => {
      const meta = this.clients.get(sock);
      return meta && meta.roomCode === room.code;
    });
    if (stillConnected) return;

    const redSockets = room.players.red ? (this.userSockets.get(room.players.red.id) || new Set()) : new Set();
    const blackSockets = room.players.black ? (this.userSockets.get(room.players.black.id) || new Set()) : new Set();
    const hasActiveRed = Array.from(redSockets).some((s) => {
      const m = this.clients.get(s);
      return m && m.roomCode === room.code;
    });
    const hasActiveBlack = Array.from(blackSockets).some((s) => {
      const m = this.clients.get(s);
      return m && m.roomCode === room.code;
    });

    // 1. Ngoại lệ sự cố hệ thống: Cả hai cùng mất kết nối -> không tự trao thắng, không thay đổi Elo
    if (!hasActiveRed && !hasActiveBlack) {
      // REV-07: đi qua settleMatch (không Elo, có ghi pvp_matches, clear timer) thay vì
      // tự set trạng thái rồi return như trước
      const redPlayer = room.players.red;
      const blackPlayer = room.players.black;
      try {
        await this.settleMatch(room, null, 'SYSTEM_ERROR', {
          skipElo: true,
          message: 'Trận đấu bị hủy và không ghi nhận kết quả do sự cố hệ thống khiến cả hai người chơi cùng mất kết nối.',
        });
      } catch (err) {
        console.error('[settleMatch] system error:', err);
      }

      // REV-07: cả hai đã rời -> trả ghế để phòng trống và được sweeper dọn
      if (redPlayer) room.removeParticipant(redPlayer.id);
      if (blackPlayer) room.removeParticipant(blackPlayer.id);
      room.touch();
      return;
    }

    // 2. Xử thua do mất kết nối quá 60 giây (COT-595)
    const winningSide = side === 'RED' ? 'BLACK' : 'RED';
    const winningUser = winningSide === 'BLACK' ? room.players.black : room.players.red;
    const losingUser = side === 'RED' ? room.players.red : room.players.black;
    const winnerColor = winningSide.toLowerCase();

    // Khóa bàn cờ, không nhận thêm nước đi
    room.status = 'WAITING_OPPONENT';
    if (room.matchState) {
      room.matchState.status = 'completed';
      room.matchState.winner = winnerColor;
      room.matchState.endReason = 'DISCONNECT_TIMEOUT';
      room.matchState.isPaused = false;
    }
    room.reconnectState = null;
    this.clearDisconnectTimer(room.code);

    // BE-04: dùng chung settleMatch (Elo delta + history + matchEnded + clear readyStates)
    try {
      await this.settleMatch(room, winnerColor, 'DISCONNECT_TIMEOUT', {
        message: `Kỳ thủ bên ${winningSide === 'RED' ? 'Đỏ' : 'Đen'} thắng do đối thủ mất kết nối quá thời gian quy định (60 giây).`,
      });
    } catch (err) {
      console.error('[settleMatch] disconnect:', err);
    }

    // Chuyển phòng sang trạng thái Đang chờ trận mới, chuyển quyền Chủ phòng nếu người mất mạng là Host
    room.readyStates.clear();
    const wasHost = Number(room.hostId) === Number(userId);

    room.removeParticipant(userId);

    if (wasHost) {
      const transferResult = room.transferHost();
      if (transferResult.newHostId) {
        const newHostSockets = this.userSockets.get(transferResult.newHostId);
        if (newHostSockets) {
          for (const s of newHostSockets) {
            const m = this.clients.get(s);
            if (m && m.roomCode === room.code) {
              m.role = 'PLAYER';
              m.side = 'RED';
            }
          }
        }

        this.broadcastToRoom(room.code, {
          type: 'HostTransferred',
          previousHostId: transferResult.oldHostId,
          newHostId: transferResult.newHostId,
          newHost: transferResult.newHost,
          room: room.getSummary(),
        });
      }
    }

    this.broadcastToRoom(room.code, {
      type: 'UserLeft',
      userId,
      room: room.getSummary(),
    });

    if (typeof this.onDisconnectTimeout === 'function') {
      this.onDisconnectTimeout(room, userId, side);
    }
  }

  broadcastToRoom(roomCode, message) {
    const group = this.roomGroups.get(roomCode);
    if (!group) return;

    const raw = JSON.stringify(message);
    for (const client of group) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(raw);
      }
    }
  }

  sendToUserInRoom(roomCode, userId, message) {
    const raw = JSON.stringify(message);
    const targetSockets = this.userSockets.get(Number(userId));
    if (!targetSockets) return;
    for (const socket of targetSockets) {
      const meta = this.clients.get(socket);
      if (meta && meta.roomCode === roomCode && socket.readyState === 1) {
        socket.send(raw);
      }
    }
  }

  broadcastToPlayers(room, message) {
    const raw = JSON.stringify(message);
    const playerIds = new Set();
    if (room.players.red) playerIds.add(Number(room.players.red.id));
    if (room.players.black) playerIds.add(Number(room.players.black.id));

    const group = this.roomGroups.get(room.code);
    if (!group) return;

    for (const client of group) {
      const meta = this.clients.get(client);
      if (meta && playerIds.has(meta.userId) && meta.role === 'PLAYER') {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(raw);
        }
      }
    }
  }

  send(socket, message) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }

  close() {
    if (this.turnTimers) {
      for (const timer of this.turnTimers.values()) clearTimeout(timer);
      this.turnTimers.clear();
    }
    this.stopHeartbeat();
    for (const [key, item] of Array.from(this.disconnectTimers.entries())) {
      clearInterval(item.interval);
      this.disconnectTimers.delete(key);
    }
    for (const socket of Array.from(this.clients.keys())) {
      try {
        socket.terminate();
      } catch {}
    }
    this.clients.clear();
    this.roomGroups.clear();
    this.userSockets.clear();
    this.connectionUsers.clear();
    try {
      this.wss.close();
    } catch {}
  }
}

// Singleton mặc định
const defaultRoomHub = new RoomHub();

module.exports = {
  RoomHub,
  roomHub: defaultRoomHub,
  // BE-07: export để test được phần validate signaling
  isValidSdp,
  isValidCandidate,
  isSameCall,
};
