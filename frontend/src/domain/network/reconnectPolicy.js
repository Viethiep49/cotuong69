/**
 * FE-08: chính sách kết nối lại WebSocket (thuần, không phụ thuộc React/trình duyệt để test được).
 */

/**
 * Backoff mũ có jitter ("equal jitter"): trễ nằm trong [cap/2, cap], cap = min(max, base * 2^attempt).
 * Nhiều client rớt cùng lúc sẽ không đồng loạt kết nối lại cùng một mili-giây.
 * @param {number} attempt số lần thất bại liên tiếp trước đó (0 = lần thử đầu)
 */
export function nextRetryDelay(attempt, { baseMs = 500, maxMs = 5000, random = Math.random } = {}) {
  const safeAttempt = Math.max(0, Math.min(Number(attempt) || 0, 20));
  const cap = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  const jitter = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.round(cap / 2 + (cap / 2) * jitter);
}

/**
 * Lỗi HTTP không đáng thử lại (sai quyền/không tồn tại...). 408 và 429 vẫn thử lại.
 */
export function isFatalHttpStatus(status) {
  const code = Number(status);
  if (!Number.isInteger(code)) return false;
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
}

/**
 * Mã đóng WebSocket do server chủ động từ chối (policy 1008 hoặc mã ứng dụng 4000-4999,
 * ví dụ 4001 xác thực/phòng đầy) thì thử lại cũng vô ích.
 */
export function isFatalCloseCode(code) {
  const value = Number(code);
  return value === 1008 || (value >= 4000 && value <= 4999);
}

/**
 * Trình duyệt báo "online" chưa có nghĩa WebSocket đã sống lại: chỉ mở khóa bàn cờ
 * khi socket thực sự OPEN, còn lại phải kết nối lại ngay.
 */
export function browserOnlineAction({ socketOpen }) {
  return socketOpen ? 'MARK_CONNECTED' : 'RECONNECT_NOW';
}

/**
 * Vai trò người xem: ưu tiên trường readOnly do server gửi; thiếu thì suy từ màu
 * (không có màu đỏ/đen = khán giả). Trước đây thiếu readOnly -> undefined -> bị coi là người chơi.
 */
export function resolveReadOnly(message) {
  if (typeof message?.readOnly === 'boolean') return message.readOnly;
  return !(message?.color === 'red' || message?.color === 'black');
}
