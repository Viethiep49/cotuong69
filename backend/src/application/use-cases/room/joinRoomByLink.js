const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

class JoinRoomByLinkUseCase {
  constructor({
    roomManager = defaultRoomManager,
    userRepository = new PgUserRepository(),
  } = {}) {
    this.roomManager = roomManager;
    this.userRepository = userRepository;
  }

  async execute(userId, code, { baseUrl = '' } = {}) {
    if (!userId) {
      const err = new Error('Yêu cầu đăng nhập để tham gia phòng.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    if (!code || typeof code !== 'string' || !code.trim()) {
      const err = new Error('Mã phòng không hợp lệ.');
      err.code = 'INVALID_ROOM_CODE';
      err.statusCode = 400;
      throw err;
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      const err = new Error('Người dùng không tồn tại.');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // BE-10: ghế được giữ ngay nhưng RoomManager sẽ tự giải phóng sau 30s
    // nếu người dùng không thực sự kết nối vào bàn cờ
    const result = this.roomManager.joinRoom(code.trim(), user);

    return {
      success: true,
      role: result.role, // 'PLAYER' | 'SPECTATOR'
      side: result.side, // 'RED' | 'BLACK' | null
      isNew: result.isNew,
      seatReserved: result.role === 'PLAYER',
      room: result.room,
      inviteLink: `${baseUrl}/room/${code.trim().toUpperCase()}`,
      canMove: result.role === 'PLAYER',
      message: 'Ghế sẽ được giải phóng sau 30 giây nếu bạn không kết nối vào bàn cờ.',
    };
  }
}

module.exports = JoinRoomByLinkUseCase;
