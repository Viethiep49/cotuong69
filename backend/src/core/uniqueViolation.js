/**
 * REV2-25: nhận diện lỗi vi phạm ràng buộc UNIQUE của bảng users (PostgreSQL 23505 hoặc SQLite) để
 * trả lỗi nghiệp vụ 409 thay vì 500 khi hai request đăng ký/đăng nhập OAuth chạy song song và cùng
 * vượt qua bước kiểm tra "đã tồn tại chưa".
 *
 * Ràng buộc liên quan: users.username (và index LOWER(username), migration 008), users.email.
 *
 * @param {any} err
 * @returns {'USERNAME_EXISTS'|'EMAIL_EXISTS'|null}
 */
function classifyUniqueViolation(err) {
  if (!err) return null;
  const message = String(err.message || '');
  const isUnique = err.code === '23505'
    || /UNIQUE constraint failed/i.test(message)
    || err.errcode === 2067
    || err.errcode === 1555;
  if (!isUnique) return null;

  // PostgreSQL: constraint = tên ràng buộc, detail = "Key (lower(username::text))=(foo) already exists."
  const haystack = `${err.constraint || ''} ${err.detail || ''} ${message}`.toLowerCase();
  if (haystack.includes('username')) return 'USERNAME_EXISTS';
  if (haystack.includes('email')) return 'EMAIL_EXISTS';
  return null;
}

const UNIQUE_VIOLATION_MESSAGES = Object.freeze({
  USERNAME_EXISTS: 'Tên đăng nhập đã tồn tại trên hệ thống.',
  EMAIL_EXISTS: 'Email đã được sử dụng bởi một tài khoản khác.',
});

module.exports = { classifyUniqueViolation, UNIQUE_VIOLATION_MESSAGES };
