const { validateDisplayName } = require('../../../domain/validators/profileValidator');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

class UpdateProfileUseCase {
  constructor({ userRepository = new PgUserRepository() } = {}) {
    this.userRepository = userRepository;
  }

  async execute(userId, { displayName }) {
    if (!userId) {
      const err = new Error('Yêu cầu xác thực tài khoản.');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const validation = validateDisplayName(displayName);
    if (!validation.isValid) {
      const err = new Error(validation.error);
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const updatedUser = await this.userRepository.updateProfile(userId, {
      displayName: validation.cleanName,
    });

    if (!updatedUser) {
      const err = new Error('Người dùng không tồn tại.');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return {
      success: true,
      message: 'Cập nhật thông tin cá nhân thành công.',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        displayName: updatedUser.displayName,
        email: updatedUser.email,
        eloRating: updatedUser.eloRating,
        avatarUrl: updatedUser.avatarUrl,
        status: updatedUser.status,
      },
    };
  }
}

module.exports = UpdateProfileUseCase;
