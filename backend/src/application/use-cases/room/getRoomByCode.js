const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');

class GetRoomByCodeUseCase {
  constructor({ roomManager = defaultRoomManager } = {}) {
    this.roomManager = roomManager;
  }

  execute(code, { baseUrl = '' } = {}) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      const err = new Error('Mã phòng không hợp lệ.');
      err.code = 'INVALID_ROOM_CODE';
      err.statusCode = 400;
      throw err;
    }

    const room = this.roomManager.findByCode(code.trim());
    if (!room) {
      const err = new Error(`Phòng cờ '${code}' không tồn tại hoặc đã kết thúc.`);
      err.code = 'ROOM_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return {
      success: true,
      room: room.getSummary(baseUrl),
      inviteLink: room.getDeepLink(baseUrl),
      isActive: room.status !== 'CLOSED' && room.status !== 'FINISHED',
    };
  }
}

module.exports = GetRoomByCodeUseCase;
