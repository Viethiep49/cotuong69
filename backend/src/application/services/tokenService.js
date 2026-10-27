const jwt = require('jsonwebtoken');

// SEC-02: JWT_SECRET bắt buộc phải được cấu hình qua biến môi trường,
// không còn secret mặc định hardcode trong source.
const DEFAULT_EXPIRES_IN = '1h';
const ALGORITHM = 'HS256';
const MIN_SECRET_LENGTH = 32;

/**
 * Lấy secret tại thời điểm sử dụng (lazy) để không phụ thuộc thứ tự nạp dotenv.
 * Thiếu hoặc quá ngắn → throw, server không được phép chạy tiếp.
 * @param {string} [override] secret truyền tường minh (dùng cho test)
 * @returns {string}
 */
function resolveSecret(override) {
  if (override !== undefined && override !== null && override !== '') {
    return override;
  }
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('JWT_SECRET chưa được cấu hình (>= 32 ký tự)');
  }
  return secret;
}

/**
 * Cấp phát JWT Access Token
 * @param {object} payload 
 * @param {object} options 
 * @returns {string}
 */
function generateAccessToken(payload, { expiresIn = DEFAULT_EXPIRES_IN, secret } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload token không hợp lệ.');
  }
  return jwt.sign(payload, resolveSecret(secret), { expiresIn, algorithm: ALGORITHM });
}

/**
 * Xác thực và giải mã JWT Access Token
 * @param {string} token 
 * @param {object} options 
 * @returns {object}
 */
function verifyAccessToken(token, { secret } = {}) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token không được cung cấp.');
    err.code = 'NO_TOKEN';
    throw err;
  }
  // Lấy secret TRƯỚC try/catch để lỗi cấu hình không bị biến thành INVALID_TOKEN
  const key = resolveSecret(secret);
  try {
    return jwt.verify(token, key, { algorithms: [ALGORITHM] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const expErr = new Error('Token đã hết hạn.');
      expErr.code = 'TOKEN_EXPIRED';
      throw expErr;
    }
    const invErr = new Error('Token không hợp lệ hoặc chữ ký sai.');
    invErr.code = 'INVALID_TOKEN';
    throw invErr;
  }
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  assertJwtSecretConfigured: () => resolveSecret(),
};
