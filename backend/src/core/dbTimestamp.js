/**
 * REV2-20: đọc cột thời gian từ CSDL thành Date.
 *
 * PostgreSQL (timestamptz) trả sẵn Date. SQLite (dùng cho test) lưu CURRENT_TIMESTAMP dạng chuỗi
 * 'YYYY-MM-DD HH:MM:SS' theo UTC nhưng KHÔNG có múi giờ; `new Date('2026-10-28 09:00:00')` hiểu đó
 * là giờ LOCAL nên lệch nhiều giờ ngoài UTC (máy ở UTC+7: lệch 7 giờ) -> so sánh thu hồi token
 * (iat < password_changed_at) sai. Chuỗi không có múi giờ phải được coi là UTC.
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null}
 */
const ZONELESS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function parseDbTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (ZONELESS_TIMESTAMP.test(text)) return new Date(`${text.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

module.exports = { parseDbTimestamp };
