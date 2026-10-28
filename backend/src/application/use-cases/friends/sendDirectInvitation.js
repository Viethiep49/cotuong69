const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');
const PgFriendRepository = require('../../../infrastructure/database/repositories/PgFriendRepository');
const { onlineUserManager: defaultOnlineUserManager } = require('../../../infrastructure/database/repositories/OnlineUserManager');
const { directInvitationManager: defaultInvitationManager } = require('../../../infrastructure/database/repositories/DirectInvitationManager');
const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');

class SendDirectInvitationUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    friendRepository = new PgFriendRepository(),
    onlineUserManager = defaultOnlineUserManager,
    invitationManager = defaultInvitationManager,
    roomManager = defaultRoomManager,
  } = {}) {
    this.userRepository = userRepository;
    this.friendRepository = friendRepository;
    this.onlineUserManager = onlineUserManager;
    this.invitationManager = invitationManager;
    this.roomManager = roomManager;
  }

  async execute(senderId, { friendId, roomCode, timeoutSeconds = 60 }) {
    if (!senderId) {
      const err = new Error('Yêu cầu đăng nhập.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    if (!friendId) {
      const err = new Error('Vui lòng chọn bạn bè để mời.');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    if (Number(senderId) === Number(friendId)) {
      const err = new Error('Không thể tự gửi lời mời cho chính mình.');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    if (!roomCode || typeof roomCode !== 'string' || !roomCode.trim()) {
      const err = new Error('Vui lòng cung cấp mã phòng cờ.');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // 1. Kiểm tra phòng cờ có tồn tại và còn mở không
    const room = this.roomManager.findByCode(roomCode.trim());
    if (!room || room.status === 'CLOSED' || room.status === 'FINISHED') {
      const err = new Error('Phòng cờ không tồn tại hoặc đã bị đóng.');
      err.code = 'ROOM_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // BE-08: người gửi phải đang ở trong phòng thì mới được mời người khác
    const senderRole = typeof room.getParticipantRole === 'function'
      ? room.getParticipantRole(Number(senderId))
      : null;
    if (!senderRole) {
      const err = new Error('Bạn phải ở trong phòng mới có thể mời bạn bè.');
      err.code = 'NOT_IN_ROOM';
      err.statusCode = 403;
      throw err;
    }

    // 2. Kiểm tra mối quan hệ bạn bè
    const areFriends = await this.friendRepository.areFriends(senderId, friendId);
    if (!areFriends) {
      const err = new Error('Người nhận không có trong danh sách bạn bè của bạn.');
      err.code = 'NOT_FRIENDS';
      err.statusCode = 403;
      throw err;
    }

    // 3. Kiểm tra bạn bè có đang Online không
    if (!this.onlineUserManager.isOnline(friendId)) {
      const err = new Error('Bạn bè hiện đang ngoại tuyến (Offline), không thể nhận lời mời trực tiếp.');
      err.code = 'FRIEND_OFFLINE';
      err.statusCode = 400;
      throw err;
    }

    const [sender, receiver] = await Promise.all([
      this.userRepository.findById(senderId),
      this.userRepository.findById(friendId),
    ]);

    // 4. Tạo lời mời với thời hạn đếm ngược (BE-08: ép số nguyên và clamp 10-120 giây;
    // trước đây nhận chuỗi -> NaN -> Invalid Date -> lời mời không bao giờ hết hạn)
    const parsedTimeout = Number.parseInt(timeoutSeconds, 10);
    const safeTimeoutSeconds = Number.isFinite(parsedTimeout)
      ? Math.min(120, Math.max(10, parsedTimeout))
      : 60;
    const timeoutMs = safeTimeoutSeconds * 1000;
    const invitation = this.invitationManager.createInvitation({
      sender,
      receiver,
      roomCode: room.code,
      timeoutMs,
    });

    return {
      success: true,
      message: `Đã gửi lời mời tới ${receiver.displayName || receiver.username}. Thời gian chờ: ${safeTimeoutSeconds} giây.`,
      invitation,
    };
  }
}

module.exports = SendDirectInvitationUseCase;
