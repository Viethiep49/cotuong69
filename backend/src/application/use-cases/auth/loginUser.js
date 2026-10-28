const { comparePassword } = require('../../services/passwordService');
const { generateAccessToken } = require('../../services/tokenService');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

/**
 * BE-16: chỉ chấp nhận đường dẫn nội bộ ("/room/123"), chặn open-redirect
 * ("//evil.com", "https://evil.com").
 * @param {string} redirectUrl
 * @returns {string|null}
 */
function sanitizeRedirectUrl(redirectUrl) {
  if (!redirectUrl || typeof redirectUrl !== 'string') return null;
  const trimmed = redirectUrl.trim();
  if (!trimmed) return null;
  // REV-15: trình duyệt bỏ tab/xuống dòng khi parse URL nên "/	/evil.com" thành "//evil.com"
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
  return trimmed;
}

// BE-13: hash giả dùng cho nhánh "user không tồn tại" (sinh 1 lần, lazy)
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    const bcrypt = require('bcryptjs');
    dummyHashPromise = bcrypt.hash('dummy-password-for-timing', Number(process.env.BCRYPT_SALT_ROUNDS || 12));
  }
  return dummyHashPromise;
}

async function compareAgainstDummy(password, hasher) {
  try {
    const dummyHash = await getDummyHash();
    if (hasher && typeof hasher.comparePassword === 'function') {
      await hasher.comparePassword(password, dummyHash);
    }
  } catch {
    /* không được để lỗi timing ảnh hưởng luồng đăng nhập */
  }
}

class LoginUserUseCase {
  constructor({ userRepository = new PgUserRepository(), tokenService = { generateAccessToken }, hasher = { comparePassword } } = {}) {
    this.userRepository = userRepository;
    this.tokenService = tokenService;
    this.hasher = hasher;
  }

  async execute({ username, password, redirectUrl }) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      const err = new Error('Vui lòng nhập tên đăng nhập hoặc email.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    if (!password || typeof password !== 'string') {
      const err = new Error('Vui lòng nhập mật khẩu.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const cleanInput = username.trim();
    let user = null;

    // Cho phép đăng nhập bằng username hoặc email
    if (cleanInput.includes('@')) {
      user = await this.userRepository.findByEmail(cleanInput);
    } else {
      user = await this.userRepository.findByUsername(cleanInput);
    }

    // Trả response an toàn không làm lộ trạng thái tồn tại của username
    const GENERIC_AUTH_ERROR = 'Tên đăng nhập hoặc mật khẩu không chính xác.';

    if (!user || !user.passwordHash) {
      // BE-13: vẫn chạy bcrypt.compare với hash giả để thời gian phản hồi
      // không tiết lộ username có tồn tại hay không
      await compareAgainstDummy(password, this.hasher);
      const err = new Error(GENERIC_AUTH_ERROR);
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    const isMatch = await this.hasher.comparePassword(password, user.passwordHash);
    if (!isMatch) {
      const err = new Error(GENERIC_AUTH_ERROR);
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    // REV-15: tài khoản không ACTIVE trả CÙNG thông báo/mã với sai mật khẩu để không lộ
    // trạng thái tài khoản cho người chỉ đoán được mật khẩu.
    if (user.status !== 'ACTIVE') {
      const err = new Error(GENERIC_AUTH_ERROR);
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    // Cấp phát JWT Access Token (SEC-02: không đưa email vào payload)
    const token = this.tokenService.generateAccessToken({
      id: user.id,
      username: user.username,
    });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        eloRating: user.eloRating,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
      // Giữ thông tin đích cần quay lại nếu người dùng mở link mời Room trước khi đăng nhập
      redirectUrl: sanitizeRedirectUrl(redirectUrl),
    };
  }
}

module.exports = LoginUserUseCase;
module.exports.sanitizeRedirectUrl = sanitizeRedirectUrl;
