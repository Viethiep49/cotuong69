/**
 * FE-07: cấu hình ICE server đọc từ env `VITE_ICE_SERVERS` (JSON) để hỗ trợ TURN.
 * Ví dụ:
 *   VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
 * Không đặt hoặc cấu hình sai -> dùng mặc định (STUN của Google) của WebRtcPeerConnection.
 */
function isValidUrls(urls) {
  if (typeof urls === 'string') return urls.length > 0;
  return Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string' && u.length > 0);
}

function isValidServer(server) {
  if (!server || typeof server !== 'object' || !isValidUrls(server.urls)) return false;
  if (server.username !== undefined && typeof server.username !== 'string') return false;
  if (server.credential !== undefined && typeof server.credential !== 'string') return false;
  return true;
}

/**
 * @param {string|undefined} raw chuỗi JSON từ env
 * @returns {Array|null} danh sách ICE server hợp lệ, hoặc null nếu không cấu hình/không hợp lệ
 */
export function parseIceServers(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidServer)) return parsed;
  } catch {
    /* rơi xuống cảnh báo */
  }
  console.warn('VITE_ICE_SERVERS không hợp lệ, dùng cấu hình ICE mặc định.');
  return null;
}

/** @returns {{iceServers: Array}|undefined} undefined = dùng mặc định của WebRtcPeerConnection */
export function resolveRtcConfig(raw = import.meta.env?.VITE_ICE_SERVERS) {
  const iceServers = parseIceServers(raw);
  return iceServers ? { iceServers } : undefined;
}
