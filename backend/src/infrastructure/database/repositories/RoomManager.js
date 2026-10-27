const crypto = require('node:crypto');
const Room = require('../../../domain/entities/Room');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room
  }

  generateCode() {
    let code;
    do {
      code = crypto.randomInt(100000, 1000000).toString(); // Đảm bảo đúng 6 chữ số ngẫu nhiên [100000-999999]
    } while (this.rooms.has(code));
    return code;
  }

  createRoom({ hostUser, name, isPrivate = false, maxSpectators = 10 }) {
    if (!hostUser || !hostUser.id) {
      const err = new Error('Yêu cầu tài khoản hợp lệ để tạo phòng.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const code = this.generateCode();
    const room = new Room({
      code,
      name: name && name.trim() ? name.trim() : `Phòng cờ của ${hostUser.displayName || hostUser.username}`,
      hostId: hostUser.id,
      hostUser,
      isPrivate: Boolean(isPrivate),
      maxSpectators,
    });

    this.rooms.set(code, room);
    return room;
  }

  findByCode(code) {
    if (!code) return null;
    const cleanCode = code.toString().toUpperCase().trim();
    const room = this.rooms.get(cleanCode);
    if (!room || room.status === 'CLOSED') return null;
    return room;
  }

  joinRoom(code, user) {
    const room = this.findByCode(code);
    if (!room) {
      const err = new Error(`Không tìm thấy phòng cờ với mã '${code}'.`);
      err.code = 'ROOM_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return room.addParticipant(user);
  }

  /**
   * BE-10: ghế lấy qua HTTP phải được TRẢ LẠI nếu không có socket nào kết nối.
   * Trước đây ai gọi POST /join là giữ ghế BLACK vĩnh viễn dù không vào bàn cờ.
   * @param {string} code
   * @param {object} user
   * @param {{seatTtlMs?: number}} [options]
   */
  joinRoom(code, user, { seatTtlMs = 30000 } = {}) {
    const room = this.findByCode(code);
    if (!room) {
      const err = new Error(`Không tìm thấy phòng cờ với mã '${code}'.`);
      err.code = 'ROOM_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const result = room.addParticipant(user);

    // Ghế vừa được giữ nhưng chưa có socket -> hẹn giải phóng
    if (result && result.role === 'PLAYER' && result.isNew) {
      this.scheduleSeatRelease(room, user, seatTtlMs);
    }

    return result;
  }

  /** BE-10: WS đã kết nối thật -> huỷ hẹn giải phóng ghế */
  confirmSeat(code, userId) {
    if (!this.seatReleaseTimers || !code || !userId) return false;
    const key = `${String(code).toUpperCase().trim()}:${Number(userId)}`;
    const timer = this.seatReleaseTimers.get(key);
    if (!timer) return false;
    clearTimeout(timer);
    this.seatReleaseTimers.delete(key);
    return true;
  }

  scheduleSeatRelease(room, user, ttlMs) {
    if (!this.seatReleaseTimers) this.seatReleaseTimers = new Map();
    const key = `${room.code}:${Number(user.id)}`;
    const existing = this.seatReleaseTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.seatReleaseTimers.delete(key);
      const target = this.findByCode(room.code);
      if (!target) return;
      // Ván đã bắt đầu thì không giải phóng ghế nữa
      if (target.status === 'PLAYING') return;
      const role = target.getParticipantRole(Number(user.id));
      if (role && role.role === 'PLAYER') {
        target.removeParticipant(Number(user.id));
      }
    }, Math.max(1000, Number(ttlMs) || 30000));

    if (timer.unref) timer.unref();
    this.seatReleaseTimers.set(key, timer);
  }

  listPublicRooms() {
    const result = [];
    for (const room of this.rooms.values()) {
      if (!room.isPrivate && room.status !== 'CLOSED') {
        result.push(room.getSummary());
      }
    }
    return result;
  }

  closeRoom(code, userId) {
    if (!code) return false;
    const cleanCode = code.toString().toUpperCase().trim();
    const room = this.rooms.get(cleanCode);
    if (!room) return false;
    if (userId !== undefined && room.hostId !== null && Number(room.hostId) !== Number(userId)) {
      const err = new Error('Chỉ chủ phòng mới có quyền đóng phòng.');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }
    room.status = 'CLOSED';
    this.rooms.delete(cleanCode);
    return true;
  }

  clear() {
    this.rooms.clear();
  }
}

// Singleton mặc định cho server
const defaultRoomManager = new RoomManager();

module.exports = {
  RoomManager,
  roomManager: defaultRoomManager,
};
