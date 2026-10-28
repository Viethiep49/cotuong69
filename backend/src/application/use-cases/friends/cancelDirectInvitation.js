const { directInvitationManager: defaultInvitationManager } = require('../../../infrastructure/database/repositories/DirectInvitationManager');

class CancelDirectInvitationUseCase {
  constructor({ invitationManager = defaultInvitationManager } = {}) {
    this.invitationManager = invitationManager;
  }

  execute(senderId, invitationId) {
    if (!senderId) {
      const err = new Error('Yêu cầu đăng nhập.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const cancelledInv = this.invitationManager.cancel(invitationId, senderId);

    return {
      success: true,
      message: 'Đã hủy lời mời thành công.',
      invitation: cancelledInv,
    };
  }
}

module.exports = CancelDirectInvitationUseCase;
