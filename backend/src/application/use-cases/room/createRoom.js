const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

// Cửa sổ chống request tạo phòng lặp
const RECENT_REQUEST_TTL_MS = 3000;

class CreateRoomUseCase {
  constructor({
    roomManager = defaultRoomManager,
    userRepository = new PgUserRepository(),
  } = {}) {
    this.roomManager = roomManager;
    this.userRepository = userRepository;
    this.recentRequests = new Map(); // key -> { timestamp, result }
  }

  /**
   * REV-17: dọn các entry chống tạo phòng lặp đã quá hạn để Map không phình mãi.
   * Được gọi mỗi lần execute nên Map chỉ giữ các entry trong cửa sổ chống lặp.
   */
  pruneRecentRequests(now = Date.now()) {
    for (const [key, entry] of this.recentRequests) {
      if (now - entry.timestamp >= RECENT_REQUEST_TTL_MS) this.recentRequests.delete(key);
    }
  }

  async execute(userId, { name, isPrivate = false, maxSpectators = 10, baseUrl = '', requestId = null } = {}) {
    if (!userId) {
      const err = new Error('Yêu cầu đăng nhập để tạo phòng.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      const err = new Error('Tên phòng là bắt buộc và không được để trống.');
      err.code = 'INVALID_ROOM_NAME';
      err.statusCode = 400;
      throw err;
    }

    // Chống request tạo Room lặp: Bấm nhiều lần chỉ sinh một phòng duy nhất
    const now = Date.now();
    this.pruneRecentRequests(now);
    // REV-17: key luôn gắn với userId — requestId do client gửi, nếu dùng trần thì
    // user B gửi trùng requestId của user A sẽ nhận lại kết quả (phòng, link mời) của A.
    const idempotencyKey = requestId
      ? `${userId}:${requestId}`
      : `${userId}:${name.trim()}:${Boolean(isPrivate)}`;
    if (this.recentRequests.has(idempotencyKey)) {
      const cached = this.recentRequests.get(idempotencyKey);
      if (now - cached.timestamp < RECENT_REQUEST_TTL_MS) {
        return cached.result;
      }
    }

    const hostUser = await this.userRepository.findById(userId);
    if (!hostUser) {
      const err = new Error('Người dùng không tồn tại.');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const room = this.roomManager.createRoom({
      hostUser,
      name: name.trim(),
      isPrivate: Boolean(isPrivate),
      maxSpectators,
    });

    const result = {
      success: true,
      message: 'Tạo phòng cờ thành công.',
      room: room.getSummary(baseUrl),
      inviteLink: room.getDeepLink(baseUrl),
    };

    this.recentRequests.set(idempotencyKey, { timestamp: now, result });
    return result;
  }
}

module.exports = CreateRoomUseCase;
