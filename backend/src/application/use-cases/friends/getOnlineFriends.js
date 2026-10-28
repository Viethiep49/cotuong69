const PgFriendRepository = require('../../../infrastructure/database/repositories/PgFriendRepository');
const { onlineUserManager: defaultOnlineUserManager } = require('../../../infrastructure/database/repositories/OnlineUserManager');

class GetOnlineFriendsUseCase {
  constructor({
    friendRepository = new PgFriendRepository(),
    onlineUserManager = defaultOnlineUserManager,
  } = {}) {
    this.friendRepository = friendRepository;
    this.onlineUserManager = onlineUserManager;
  }

  async execute(userId) {
    if (!userId) {
      const err = new Error('Yêu cầu đăng nhập.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const friends = await this.friendRepository.listAcceptedFriends(userId);
    // Lọc và bổ sung trạng thái trực tuyến
    const onlineFriends = friends
      .filter((friend) => this.onlineUserManager.isOnline(friend.id))
      .map((friend) => ({
        ...friend,
        onlineStatus: this.onlineUserManager.getUserStatus(friend.id),
      }));

    return {
      success: true,
      count: onlineFriends.length,
      friends: onlineFriends,
    };
  }
}

module.exports = GetOnlineFriendsUseCase;
