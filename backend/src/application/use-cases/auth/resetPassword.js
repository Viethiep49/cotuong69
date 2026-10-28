const { hashPassword, MAX_PASSWORD_BYTES } = require('../../services/passwordService');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../../../infrastructure/database/repositories/PgPasswordResetRepository');

const PASSWORD_HAS_LETTER = /[A-Za-z]/;
const PASSWORD_HAS_NUMBER = /\d/;

class ResetPasswordUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    resetRepository = new PgPasswordResetRepository(),
    hasher = { hashPassword },
  } = {}) {
    this.userRepository = userRepository;
    this.resetRepository = resetRepository;
    this.hasher = hasher;
  }

  async execute({ token, newPassword }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      const err = new Error('Mã token xác thực không được để trống.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    if (!newPassword || typeof newPassword !== 'string') {
      const err = new Error('Mật khẩu mới không được để trống.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    if (newPassword.length < 8) {
      const err = new Error('Mật khẩu mới phải có tối thiểu 8 ký tự.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // REV-14: bcrypt chỉ xử lý tối đa 72 byte -> báo lỗi 400 trước khi băm (không để rơi thành 500)
    if (Buffer.byteLength(newPassword, 'utf8') > MAX_PASSWORD_BYTES) {
      const err = new Error(`Mật khẩu mới không được dài quá ${MAX_PASSWORD_BYTES} byte.`);
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    if (!PASSWORD_HAS_LETTER.test(newPassword) || !PASSWORD_HAS_NUMBER.test(newPassword)) {
      const err = new Error('Mật khẩu mới phải bao gồm cả chữ cái và chữ số.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const cleanToken = token.trim();
    const tokenRecord = await this.resetRepository.findToken(cleanToken);

    if (!tokenRecord) {
      const err = new Error('Mã xác thực không hợp lệ hoặc không tồn tại.');
      err.code = 'INVALID_TOKEN';
      throw err;
    }

    // 1 token không thể dùng 2 lần
    if (Number(tokenRecord.is_used) === 1) {
      const err = new Error('Mã xác thực này đã được sử dụng. Một token không thể dùng lại lần hai.');
      err.code = 'TOKEN_ALREADY_USED';
      throw err;
    }

    // Kiểm tra thời hạn 15 phút
    const expiresAt = new Date(tokenRecord.expires_at).getTime();
    if (expiresAt < Date.now()) {
      const err = new Error('Mã xác thực đã hết hạn (chỉ có giá trị trong 15 phút). Vui lòng yêu cầu lại.');
      err.code = 'TOKEN_EXPIRED';
      throw err;
    }

    const user = await this.userRepository.findById(tokenRecord.user_id);
    if (!user) {
      const err = new Error('Tài khoản liên kết với token này không tồn tại.');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    // Băm mật khẩu mới bằng Bcrypt
    const newHash = await this.hasher.hashPassword(newPassword);

    // BE-02 + REV-14: dùng token NGUYÊN TỬ, đổi mật khẩu (set password_changed_at để
    // thu hồi JWT cũ) và vô hiệu hoá token còn lại trong MỘT transaction — chặn dùng
    // 2 lần khi có 2 request song song, và lỗi giữa chừng không đốt mất token.
    const done = await this.resetRepository.resetPasswordAtomically({
      token: cleanToken,
      userId: user.id,
      passwordHash: newHash,
    });
    if (!done) {
      const err = new Error('Mã xác thực này đã được sử dụng. Một token không thể dùng lại lần hai.');
      err.code = 'TOKEN_ALREADY_USED';
      throw err;
    }

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công. Mật khẩu cũ đã hết hiệu lực.',
    };
  }
}

module.exports = ResetPasswordUseCase;
