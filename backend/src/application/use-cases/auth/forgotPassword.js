const crypto = require('node:crypto');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');
const PgPasswordResetRepository = require('../../../infrastructure/database/repositories/PgPasswordResetRepository');
const defaultEmailService = require('../../../infrastructure/mailer/emailService');

const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const TOKEN_EXPIRY_MINUTES = 15;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MINUTES = 10;

class ForgotPasswordUseCase {
  constructor({
    userRepository = new PgUserRepository(),
    resetRepository = new PgPasswordResetRepository(),
    emailService = defaultEmailService,
  } = {}) {
    this.userRepository = userRepository;
    this.resetRepository = resetRepository;
    this.emailService = emailService;
  }

  async execute({ email }) {
    if (!email || typeof email !== 'string' || !email.trim()) {
      const err = new Error('Vui lòng nhập địa chỉ email.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      const err = new Error('Địa chỉ email không đúng định dạng.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const GENERIC_RESPONSE = {
      success: true,
      message: 'Nếu email tồn tại trên hệ thống, hướng dẫn đặt lại mật khẩu và mã xác thực đã được gửi đến hòm thư của bạn.',
    };

    // Tìm kiếm user theo email
    const user = await this.userRepository.findByEmail(cleanEmail);
    if (!user) {
      // Trả response chung tránh suy đoán trạng thái tài khoản
      return GENERIC_RESPONSE;
    }

    // Kiểm tra giới hạn tần suất gửi: tối đa 3 lần / 10 phút
    const recentCount = await this.resetRepository.countRecentRequests(user.id, RATE_LIMIT_WINDOW_MINUTES);
    if (recentCount >= RATE_LIMIT_MAX) {
      // BE-02: không trả 429 riêng cho email tồn tại (lộ tài khoản) — vẫn trả response chung
      return GENERIC_RESPONSE;
    }

    // Vô hiệu hóa token cũ khi có yêu cầu mới
    await this.resetRepository.invalidateOldTokens(user.id);

    // Tạo token đặt lại mật khẩu có thời hạn 15 phút
    const token = crypto.randomBytes(32).toString('hex');
    // BE-02: OTP sinh bằng CSPRNG, không dùng Math.random
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await this.resetRepository.createResetToken({
      userId: user.id,
      token,
      expiresAt,
    });

    await this.resetRepository.createOtpCode({
      email: cleanEmail,
      code: otpCode,
      expiresAt,
      type: 'RESET_PASSWORD',
    });

    // Gửi email đặt lại mật khẩu
    await this.emailService.sendPasswordResetEmail({
      email: cleanEmail,
      token,
      code: otpCode,
      resetUrl: `/reset-password?token=${token}`,
    });

    return GENERIC_RESPONSE;
  }
}

module.exports = ForgotPasswordUseCase;
