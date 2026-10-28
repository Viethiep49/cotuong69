import { TokenStorage } from '../storage/tokenStorage.js';
import { buildAuthHeaders, buildWsProtocols } from './wsAuth.js';

// FE-09: mặc định dùng đường dẫn tương đối (dev đi qua proxy của Vite)
const apiBaseUrl = (import.meta.env?.VITE_API_URL || '/api').replace(/\/+$/, '');

function apiOrigin() {
  if (/^https?:\/\//i.test(apiBaseUrl)) return apiBaseUrl;
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:3000';
  return `${origin}${apiBaseUrl.startsWith('/') ? '' : '/'}${apiBaseUrl}`;
}

export function matchWebSocketUrl(matchId) {
  const url = new URL(`${apiOrigin()}/matches/${encodeURIComponent(matchId)}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

// FE-06: subprotocol mang token (không đưa token vào query string)
export function matchWebSocketProtocols() {
  return buildWsProtocols(TokenStorage.getAccessToken());
}

export async function fetchMatch(matchId, { signal } = {}) {
  const response = await fetch(`${apiOrigin()}/matches/${encodeURIComponent(matchId)}`, {
    method: 'GET',
    // FE-06: gắn Bearer token nếu đã đăng nhập
    headers: { Accept: 'application/json', ...buildAuthHeaders(TokenStorage.getAccessToken()) },
    signal,
  });

  const match = await response.json();
  if (!response.ok) {
    throw new Error(match.error || `Không thể tải trận đấu (${response.status})`);
  }

  return match;
}
