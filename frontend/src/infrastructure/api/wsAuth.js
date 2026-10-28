/**
 * FE-06: xác thực WebSocket mà không để token trong query string.
 * Trình duyệt không gắn được header Authorization cho WebSocket nên token đi qua
 * Sec-WebSocket-Protocol: ['cotuong.v1', 'access_token.<jwt>'] (server chọn 'cotuong.v1').
 */
export const WS_SUBPROTOCOL = 'cotuong.v1';
export const WS_TOKEN_PROTOCOL_PREFIX = 'access_token.';

// Subprotocol phải là HTTP token; JWT (base64url + dấu chấm) thỏa điều kiện này.
const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;

export function buildWsProtocols(token) {
  if (typeof token === 'string' && token && SAFE_TOKEN.test(token)) {
    return [WS_SUBPROTOCOL, `${WS_TOKEN_PROTOCOL_PREFIX}${token}`];
  }
  return [WS_SUBPROTOCOL];
}

export function buildAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
