const crypto = require('node:crypto');
const defaultDb = require('../../../config/db');

/**
 * BE-02: chỉ lưu SHA-256 của token; DB không bao giờ chứa token thô.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function toIsoString(val) {
  if (!val) return null;
  return val instanceof Date ? val.toISOString() : String(val);
}

class PgPasswordResetRepository {
  constructor({ db = defaultDb } = {}) {
    this.db = db;
  }

  /**
   * Đếm số lần yêu cầu reset password của email/userId trong khoảng thời gian
   */
  async countRecentRequests(userId, windowMinutes = 10) {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString().replace('T', ' ').replace(/\..+/, '');
    const res = await this.db.query(
      `SELECT COUNT(*) as count FROM password_reset_tokens
       WHERE user_id = $1 AND created_at >= $2`,
      [Number(userId), since]
    );
    return Number(res.rows[0]?.count || 0);
  }

  /**
   * Vô hiệu hóa toàn bộ token cũ chưa dùng của user
   */
  async invalidateOldTokens(userId) {
    await this.db.query(
      `UPDATE password_reset_tokens SET is_used = TRUE
       WHERE user_id = $1 AND is_used = FALSE`,
      [Number(userId)]
    );
  }

  /**
   * Lưu token đặt lại mật khẩu với thời hạn
   */
  async createResetToken({ userId, token, expiresAt }) {
    const expIso = toIsoString(expiresAt);
    const tokenHash = hashToken(token);
    await this.db.query(
      `INSERT INTO password_reset_tokens (token, user_id, expires_at, is_used)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, Number(userId), expIso, false]
    );
    const res = await this.db.query(
      `SELECT id, token, user_id, expires_at, is_used, created_at
       FROM password_reset_tokens WHERE token = $1 LIMIT 1`,
      [tokenHash]
    );
    return res.rows[0];
  }

  /**
   * Lưu mã OTP
   */
  async createOtpCode({ email, code, expiresAt, type = 'RESET_PASSWORD' }) {
    const expIso = toIsoString(expiresAt);
    await this.db.query(
      `INSERT INTO otp_codes (email, code, type, expires_at, is_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [email.trim().toLowerCase(), code, type, expIso, false]
    );
  }

  /**
   * Tìm token hợp lệ
   */
  async findToken(token) {
    const res = await this.db.query(
      `SELECT id, token, user_id, expires_at, is_used, created_at
       FROM password_reset_tokens WHERE token = $1 LIMIT 1`,
      [hashToken(token)]
    );
    return res.rows[0] || null;
  }

  /**
   * BE-02: dùng token nguyên tử — 1 câu UPDATE duy nhất, trả userId nếu token
   * còn hợp lệ (chưa dùng + chưa hết hạn). Không thể dùng 2 lần dù request song song.
   * @returns {Promise<number|null>}
   */
  async consumeToken(token) {
    const res = await this.db.query(
      `UPDATE password_reset_tokens SET is_used = TRUE
       WHERE token = $1 AND is_used = FALSE AND expires_at > $2
       RETURNING user_id`,
      [hashToken(token), new Date().toISOString()]
    );
    if (!res.rows || res.rows.length === 0) return null;
    return Number(res.rows[0].user_id);
  }

  /**
   * Đánh dấu token đã được sử dụng
   */
  async markTokenUsed(token) {
    await this.db.query(
      `UPDATE password_reset_tokens SET is_used = TRUE WHERE token = $1`,
      [hashToken(token)]
    );
  }
}

module.exports = PgPasswordResetRepository;
module.exports.hashToken = hashToken;
