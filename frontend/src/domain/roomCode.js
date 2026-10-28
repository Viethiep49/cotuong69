/**
 * BE-14: mã phòng có 2 dạng
 *  - Công khai: 6 chữ số (vd "102938")
 *  - Riêng tư:  10 ký tự Crockford base32 (0-9, A-Z trừ I, L, O, U)
 * Người dùng có thể gõ chữ thường / có khoảng trắng, ta chuẩn hoá về chữ hoa.
 */
const PUBLIC_ROOM_CODE = /^\d{6}$/;
const PRIVATE_ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Chuẩn hoá mã phòng người dùng gõ: bỏ khoảng trắng + dấu gạch, chuyển chữ hoa.
 * @param {string} raw
 * @returns {string}
 */
function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
function isValidRoomCode(raw) {
  const code = normalizeRoomCode(raw);
  return PUBLIC_ROOM_CODE.test(code) || PRIVATE_ROOM_CODE.test(code);
}

/**
 * Chuẩn hoá khi người dùng đang gõ: chỉ giữ chữ/số, tối đa 10 ký tự.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeRoomCodeInput(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 10);
}

/**
 * Thông báo lỗi tương ứng (rỗng nếu hợp lệ).
 * @param {string} raw
 * @returns {string}
 */
function roomCodeError(raw) {
  const code = normalizeRoomCode(raw);
  if (!code) return 'Vui lòng nhập mã phòng.';
  if (isValidRoomCode(code)) return '';
  if (/^\d+$/.test(code)) return 'Mã phòng phải gồm đúng 6 chữ số (ví dụ: 102938).';
  return 'Mã phòng riêng tư phải gồm 10 ký tự chữ và số (ví dụ: 7K3M9QX2AB).';
}

module.exports = {
  PUBLIC_ROOM_CODE,
  PRIVATE_ROOM_CODE,
  normalizeRoomCode,
  isValidRoomCode,
  sanitizeRoomCodeInput,
  roomCodeError,
};
