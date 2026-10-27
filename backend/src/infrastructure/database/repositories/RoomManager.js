const crypto = require('node:crypto');
const Room = require('../../../domain/entities/Room');

const MAX_ROOMS_PER_USER = 20;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000; // phòng không còn ai sau 30 phút
const FINISHED_ROOM_TTL_MS = 60 * 60 * 1000; // phòng đã kết thúc sau 60 phút

class RoomManager {
  constructor({ sweepIntervalMs = 60 * 1000, maxRoomsPerUser = MAX_ROOMS_PER_USER } = {}) {
    this.rooms = new Map(); // roomCode -> Room
    this.seatReleaseTimers = new Map();
    this.maxRoomsPerUser = maxRoomsPerUser;

    // BE-08: sweeper dọn phòng bỏ hoang để Map không phình vô hạn
    this.sweepIntervalMs = Number(sweepIntervalMs);
    if (this.sweepIntervalMs > 0) {
      this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs);
      if (this.sweeper.unref) this.sweeper.unref();
    }
  }

  generateCode() {
    // BE-08: giới hạn số lần thử, hết thì báo lỗi thay vì treo vô hạn
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = crypto.randomInt(100000, 1000000).toString();
      if (!this.rooms.has(code)) return code;
    }
    const err = new Error('Không sinh được mã phòng mới, vui lòng thử lại.');
    err.code = 'ROOM_CODE_EXHAUSTED';
    err.statusCode = 503;
    throw err;
  }

  /**
   * BE-14: mã phòng RIÊNG TƯ dùng 10 ký tự base32 (Crockford, bỏ I/L/O/U)
   * -> 50 bit entropy, không thể dò như mã 6 số.
   * @returns {string}
   */
  generatePrivateCode() {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const bytes = crypto.randomBytes(10);
      let code = '';
      for (let i = 0; i < 10; i += 1) {
        code += alphabet[bytes[i] % alphabet.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    const err = new Error('Không sinh được mã phòng mới, vui lòng thử lại.');
    err.code = 'ROOM_CODE_EXHAUSTED';
    err.statusCode = 503;
    throw err;
  }

  createRoom({ hostUser, name, isPrivate = false, maxSpectators = 10 }) {
    if (!hostUser || !hostUser.id) {
      const err = new Error('Yêu cầu tài khoản hợp lệ để tạo phòng.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    // BE-08: validate tên phòng
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (name !== undefined && name !== null && cleanName.length > 50) {
      const err = new Error('Tên phòng tối đa 50 ký tự.');
      err.code = 'INVALID_ROOM_NAME';
      err.statusCode = 400;
      throw err;
    }

    // BE-08: validate maxSpectators (trước đây Number('abc') = NaN -> không giới hạn)
    const spectatorLimit = maxSpectators === undefined || maxSpectators === null || maxSpectators === ''
      ? 10
      : Number(maxSpectators);
    if (!Number.isInteger(spectatorLimit) || spectatorLimit < 0 || spectatorLimit > 10) {
      const err = new Error('Số khán giả tối đa phải là số nguyên từ 0 đến 10.');
      err.code = 'INVALID_MAX_SPECTATORS';
      err.statusCode = 400;
      throw err;
    }

    // BE-08: giới hạn số phòng đang mở của một người
    const openRooms = Array.from(this.rooms.values()).filter(
      (room) => Number(room.hostId) === Number(hostUser.id) && room.status !== 'CLOSED',
    );
    if (openRooms.length >= this.maxRoomsPerUser) {
      const err = new Error(`Mỗi người chỉ được mở tối đa ${this.maxRoomsPerUser} phòng cùng lúc.`);
      err.code = 'TOO_MANY_ROOMS';
      err.statusCode = 429;
      throw err;
    }

    // BE-14: phòng riêng tư dùng mã dài, không đoán được
    const code = isPrivate ? this.generatePrivateCode() : this.generateCode();
    const room = new Room({
      code,
      name: cleanName || `Phòng cờ của ${hostUser.displayName || hostUser.username}`,
      hostId: hostUser.id,
      hostUser,
      isPrivate: Boolean(isPrivate),
      maxSpectators: spectatorLimit,
    });

    this.rooms.set(code, room);
    return room;
  }

  /**
   * BE-08: dọn phòng bỏ hoang (không còn ai / đã kết thúc quá lâu).
   * Chỉ dựa trên dữ liệu Room để không phụ thuộc tầng socket.
   */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [code, room] of Array.from(this.rooms.entries())) {
      const lastActivity = room.lastActivityAt ? new Date(room.lastActivityAt).getTime() : null;
      const isFinished = room.status === 'FINISHED' || room.status === 'CLOSED';
      const ttl = isFinished ? FINISHED_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
      const participantCount = (room.players.red ? 1 : 0) + (room.players.black ? 1 : 0);
      const isIdle = lastActivity ? now - lastActivity > ttl : true;

      // Không bao giờ dọn phòng đang thi đấu
      if (room.status === 'PLAYING') continue;

      if (isIdle && (isFinished || participantCount === 0)) {
        this.rooms.delete(code);
        removed += 1;
        continue;
      }

      // Phòng chưa kết thúc nhưng bỏ hoang quá TTL (không ai tương tác) cũng dọn
      if (isIdle && participantCount <= 1) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  stopSweeper() {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
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
