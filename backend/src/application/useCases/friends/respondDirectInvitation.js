const { directInvitationManager: defaultInvitationManager } = require('../../../infrastructure/database/repositories/DirectInvitationManager');
const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

class RespondDirectInvitationUseCase {
  constructor({
    invitationManager = defaultInvitationManager,
    roomManager = defaultRoomManager,
    userRepository = new PgUserRepository(),
  } = {}) {
    this.invitationManager = invitationManager;
    this.roomManager = roomManager;
    this.userRepository = userRepository;
  }

  async execute(userId, invitationId, { action }) {
    if (!userId) {
      const err = new Error('Yêu cầu đăng nhập.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    // BE-08: kiểm tra phòng TRƯỚC khi đánh dấu ACCEPTED — trước đây phòng đã đóng
    // vẫn bị đánh dấu ACCEPTED rồi mới báo lỗi, khiến lời mời không dùng lại được
    const pending = this.invitationManager.getInvitation(invitationId);
    const wantsToAccept = String(action || '').toLowerCase() === 'accept'
      || String(action || '').toLowerCase() === 'accepted';

    let roomForAccept = null;
    if (pending && wantsToAccept) {
      roomForAccept = this.roomManager.findByCode(pending.roomCode);
      if (!roomForAccept || roomForAccept.status === 'CLOSED' || roomForAccept.status === 'FINISHED') {
        const err = new Error('Phòng cờ đã kết thúc hoặc không còn khả dụng.');
        err.code = 'ROOM_CLOSED';
        err.statusCode = 410;
        throw err;
      }
    }

    const updatedInv = this.invitationManager.respond(invitationId, userId, action);

    let joinResult = null;
    if (updatedInv.status === 'ACCEPTED') {
      const user = await this.userRepository.findById(userId);
      // Vào phòng: nếu người khác vào trước thì tự động gán khán giả hoặc thông báo
      joinResult = roomForAccept.addParticipant(user);
    }

    return {
      success: true,
      invitation: updatedInv,
      joinResult,
      message: updatedInv.status === 'ACCEPTED' ? 'Đã chấp nhận lời mời và tham gia phòng.' : 'Đã từ chối lời mời.',
    };
  }
}

module.exports = RespondDirectInvitationUseCase;
