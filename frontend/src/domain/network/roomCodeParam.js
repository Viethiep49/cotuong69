/**
 * FE-01: đọc `?roomCode=` trên URL màn hình trận. Cùng định dạng với BE-14 (domain/roomCode.js):
 * 6 chữ số (công khai) hoặc 10 ký tự Crockford base32 (riêng tư). Giá trị lạ -> null,
 * để không mở WebSocket tới đường dẫn tuỳ tiện.
 */
const PUBLIC_ROOM_CODE = /^\d{6}$/;
const PRIVATE_ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function parseRoomCodeParam(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return PUBLIC_ROOM_CODE.test(code) || PRIVATE_ROOM_CODE.test(code) ? code : null;
}
