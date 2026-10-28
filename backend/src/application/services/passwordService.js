const bcrypt = require('bcryptjs');

// BE-13: tăng cost lên 12 (test có thể hạ bằng BCRYPT_SALT_ROUNDS để chạy nhanh)
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
// Giới hạn cứng của bcrypt: mật khẩu dài hơn 72 byte bị cắt cụt
const MAX_PASSWORD_BYTES = 72;

/**
 * Băm mật khẩu bằng Bcrypt
 * @param {string} plainPassword 
 * @returns {Promise<string>}
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Mật khẩu không hợp lệ để băm');
  }
  if (Buffer.byteLength(plainPassword, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('Mật khẩu không được dài quá 72 byte.');
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Kiểm tra mật khẩu khớp với Bcrypt hash
 * @param {string} plainPassword 
 * @param {string} hashedPassword 
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainPassword, hashedPassword) {
  if (!plainPassword || !hashedPassword) {
    return false;
  }
  return bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = {
  hashPassword,
  comparePassword,
  SALT_ROUNDS,
  MAX_PASSWORD_BYTES,
};
