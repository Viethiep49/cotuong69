const { verifyAccessToken } = require('../../../application/services/tokenService');

function authenticateRequest(request, options = {}) {
  const authHeader = request.headers['authorization'] || request.headers['Authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    const err = new Error('Vui lòng cung cấp token xác thực qua header Authorization: Bearer <token>');
    err.code = 'UNAUTHORIZED';
    err.statusCode = 401;
    throw err;
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = verifyAccessToken(token, options);
    request.user = decoded;
    return decoded;
  } catch (err) {
    err.statusCode = 401;
    throw err;
  }
}

module.exports = {
  authenticateRequest,
  authenticateRequestWithSession,
};

/**
 * BE-02: xác thực + kiểm tra phiên còn hiệu lực trên CSDL.
 *  - User không tồn tại / status !== 'ACTIVE' → 401/403.
 *  - Token phát hành TRƯỚC lần đổi mật khẩu gần nhất (iat < password_changed_at)
 *    → 401 TOKEN_REVOKED, buộc đăng nhập lại.
 * Truyền `userRepository: null` để chỉ verify chữ ký (tương thích code cũ).
 */
async function authenticateRequestWithSession(request, options = {}) {
  const decoded = authenticateRequest(request, options);

  const provided = options.userRepository !== undefined ? options.userRepository : options.userRepo;
  const repo = provided === null ? null : (provided || new PgUserRepository());
  if (!repo || typeof repo.findById !== 'function') return decoded;

  const user = await repo.findById(decoded.id);
  if (!user) {
    const err = new Error('Người dùng không tồn tại.');
    err.code = 'UNAUTHORIZED';
    err.statusCode = 401;
    throw err;
  }
  if (user.status !== 'ACTIVE') {
    const err = new Error('Tài khoản đã bị khóa hoặc chưa được kích hoạt.');
    err.code = 'ACCOUNT_INACTIVE';
    err.statusCode = 403;
    throw err;
  }

  const changedAt = user.passwordChangedAt || user.password_changed_at;
  if (changedAt && decoded.iat) {
    const changedMs = new Date(changedAt).getTime();
    // Trừ 1 giây tolerance vì iat được làm tròn xuống giây
    if (Number.isFinite(changedMs) && decoded.iat * 1000 < changedMs - 1000) {
      const err = new Error('Phiên đăng nhập đã hết hiệu lực do mật khẩu vừa được thay đổi. Vui lòng đăng nhập lại.');
      err.code = 'TOKEN_REVOKED';
      err.statusCode = 401;
      throw err;
    }
  }

  return decoded;
}
