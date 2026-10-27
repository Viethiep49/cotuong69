/**
 * CLEAN-05: CORS theo whitelist thay vì "*" cho mọi route.
 * Cấu hình: CORS_ORIGINS="http://localhost:3000,https://cotuong69.example.com"
 * Mặc định (dev) cho phép http://localhost:3000 và http://127.0.0.1:3000.
 */
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function allowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || !raw.trim()) return DEFAULT_ORIGINS;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Trả origin được phép (hoặc null nếu không nằm trong whitelist).
 * @param {object} request
 * @returns {string|null}
 */
function resolveCorsOrigin(request) {
  const origin = request && request.headers ? request.headers.origin : null;
  if (!origin) return null;
  const list = allowedOrigins();
  return list.includes(origin) ? origin : null;
}

/**
 * Sinh header CORS cho response.
 * @param {object} request
 * @returns {Record<string,string>}
 */
function corsHeaders(request) {
  const origin = resolveCorsOrigin(request);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

module.exports = { resolveCorsOrigin, corsHeaders, allowedOrigins };
