/**
 * BE-13: rate limiter in-memory dạng sliding window cho các endpoint dễ bị brute force.
 * Không phụ thuộc thư viện ngoài (đồ án không dùng Express).
 */

class SlidingWindowLimiter {
  /**
   * @param {{limit:number, windowMs:number, name?:string}} options
   */
  constructor({ limit, windowMs, name = 'limiter', maxKeys = 10000 }) {
    this.limit = Number(limit);
    this.windowMs = Number(windowMs);
    this.name = name;
    // REV-04: chặn Map phình to do key do kẻ tấn công tự chọn
    this.maxKeys = Number(maxKeys) > 0 ? Number(maxKeys) : 10000;
    this.hits = new Map(); // key -> number[] (timestamps)
  }

  /** REV-04: đã vượt giới hạn chưa (KHÔNG ghi nhận thêm lượt) */
  isBlocked(key, now = Date.now()) {
    if (!key) return false;
    const recent = (this.hits.get(key) || []).filter((ts) => now - ts < this.windowMs);
    if (recent.length === 0) {
      this.hits.delete(key);
      return false;
    }
    this.hits.set(key, recent);
    return recent.length >= this.limit;
  }

  /**
   * REV-04: ghi nhận một lượt (dùng cho luồng "chỉ đếm lần thất bại").
   * @returns {{allowed:boolean, count:number}}
   */
  record(key, now = Date.now()) {
    if (!key) return { allowed: true, count: 0 };
    const recent = (this.hits.get(key) || []).filter((ts) => now - ts < this.windowMs);
    recent.push(now);
    if (!this.hits.has(key)) this.evictIfFull();
    this.hits.set(key, recent);
    return { allowed: recent.length < this.limit, count: recent.length };
  }

  /** Số lượt còn trong cửa sổ của key */
  countOf(key, now = Date.now()) {
    if (!key) return 0;
    return (this.hits.get(key) || []).filter((ts) => now - ts < this.windowMs).length;
  }

  /** Xoá key cũ nhất khi Map đã đầy (Map giữ thứ tự chèn) */
  evictIfFull() {
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) return;
      this.hits.delete(oldest.value);
    }
  }

  /**
   * Ghi nhận 1 lần gọi và cho biết có vượt giới hạn chưa.
   * @param {string} key
   * @param {number} [now]
   * @returns {{allowed:boolean, remaining:number, retryAfterMs:number}}
   */
  consume(key, now = Date.now()) {
    if (!key) return { allowed: true, remaining: this.limit, retryAfterMs: 0 };

    const recent = (this.hits.get(key) || []).filter((ts) => now - ts < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0];
      const retryAfterMs = Math.max(0, this.windowMs - (now - oldest));
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    recent.push(now);
    if (!this.hits.has(key)) this.evictIfFull();
    this.hits.set(key, recent);
    // REV2-16: trả lại `ts` để bên gọi hoàn lại (refund) đúng lượt này khi hoá ra không phải thất bại
    return { allowed: true, remaining: Math.max(0, this.limit - recent.length), retryAfterMs: 0, ts: now };
  }

  /**
   * REV2-16: hoàn lại MỘT lượt đã ghi nhận lúc request đến (consume/record) — dùng khi request
   * cuối cùng không phải lần thất bại (đăng nhập thành công, mã phòng tồn tại...).
   * Chỉ bỏ đúng lượt của request này, KHÔNG xoá các lần thất bại khác của cùng key.
   */
  refund(key, ts) {
    if (!key) return;
    const list = this.hits.get(key);
    if (!list) return;
    const index = list.indexOf(ts);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) this.hits.delete(key);
  }

  reset(key) {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  /** Dọn key hết hạn để Map không phình (gọi định kỳ) */
  cleanup(now = Date.now()) {
    for (const [key, timestamps] of Array.from(this.hits.entries())) {
      const recent = timestamps.filter((ts) => now - ts < this.windowMs);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

/** Chỉ nhận ký tự hợp lệ của IPv4/IPv6 (chặn key rác do attacker tự đặt) */
const IP_PATTERN = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * Chuẩn hoá IP: bỏ tiền tố ::ffff:, cắt zone id.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  let ip = value.trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);
  return IP_PATTERN.test(ip) ? ip.toLowerCase() : null;
}

/**
 * REV2-22: mở rộng địa chỉ IPv6 thành 8 nhóm số (null nếu không hợp lệ). Hỗ trợ "::" và đuôi IPv4.
 */
function expandIpv6(ip) {
  let addr = ip;
  if (addr.includes('.')) {
    const idx = addr.lastIndexOf(':');
    const v4 = addr.slice(idx + 1).split('.').map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
    if (v4.length !== 4 || v4.some((n) => !(n >= 0 && n <= 255))) return null;
    addr = `${addr.slice(0, idx + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * REV2-22: khoá giới hạn tốc độ theo tiền tố /64 cho IPv6. Mỗi máy/nhà mạng thường được cấp cả
 * dải /64 (2^64 địa chỉ) nên kẻ tấn công đổi địa chỉ trong dải để né giới hạn theo từng IP.
 * IPv4 giữ nguyên.
 * @param {string} ip địa chỉ đã normalizeIp
 * @returns {string}
 */
function rateLimitKeyForIp(ip) {
  if (typeof ip !== 'string' || !ip.includes(':')) return ip;
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}

/**
 * REV2-18: số reverse proxy TIN CẬY đứng trước app (mặc định 1). Mỗi proxy tin cậy thêm
 * địa chỉ của peer trước nó vào CUỐI X-Forwarded-For, nên IP thật của client là phần tử thứ
 * `hops` tính từ bên PHẢI. Phần tử bên trái do client tự đặt -> không được tin.
 */
function trustedProxyHops() {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
  return Number.isInteger(hops) && hops >= 1 && hops <= 10 ? hops : 1;
}

/**
 * REV-04: chỉ đọc x-forwarded-for khi TRUST_PROXY=true (chạy sau reverse proxy
 * tin cậy). Trước đây luôn tin header này nên đổi XFF mỗi request là không bao
 * giờ bị giới hạn, đồng thời làm Map key phình to.
 * REV2-18: dùng phần tử bên PHẢI (xem trustedProxyHops) thay vì phần tử đầu tiên do client tự đặt.
 * @param {object} request
 * @returns {string}
 */
function getClientIp(request) {
  const trustProxy = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';
  if (trustProxy) {
    const forwarded = request.headers && (request.headers['x-forwarded-for'] || request.headers['X-Forwarded-For']);
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    if (typeof raw === 'string' && raw.trim()) {
      const entries = raw.split(',').map((item) => item.trim()).filter(Boolean);
      const hops = trustedProxyHops();
      if (entries.length >= hops) {
        const candidate = normalizeIp(entries[entries.length - hops]);
        if (candidate) return rateLimitKeyForIp(candidate);
      }
    }
  }
  const socket = request.socket || request.connection;
  const remote = normalizeIp(socket && socket.remoteAddress);
  return remote ? rateLimitKeyForIp(remote) : 'unknown';
}

/**
 * Demo trên một máy: mọi trình duyệt chung IP loopback, nên vài lần gõ sai mật khẩu là cả máy bị
 * khoá đăng nhập 15 phút. Chỉ khi NODE_ENV=development (và không đứng sau proxy) mới bỏ giới hạn
 * theo IP cho request đến từ chính máy này. Giới hạn làm chậm theo username vẫn giữ nguyên.
 * @param {object} request
 * @returns {boolean}
 */
function isDevLoopbackExempt(request) {
  if (process.env.NODE_ENV !== 'development') return false;
  if (String(process.env.TRUST_PROXY || '').toLowerCase() === 'true') return false;
  const socket = request && (request.socket || request.connection);
  const remote = normalizeIp(socket && socket.remoteAddress);
  if (!remote) return false;
  return remote === '::1' || /^127\./.test(remote);
}

// Giới hạn theo plan BE-13
const loginLimiter = new SlidingWindowLimiter({ limit: 10, windowMs: 15 * 60 * 1000, name: 'login' });
const registerLimiter = new SlidingWindowLimiter({ limit: 5, windowMs: 60 * 60 * 1000, name: 'register' });
const roomLookupLimiter = new SlidingWindowLimiter({ limit: 30, windowMs: 60 * 1000, name: 'room-lookup' });

// REV-04: đếm theo username nhưng CHỈ dùng để làm chậm, không khoá hẳn
// (nếu khoá thì kẻ xấu có thể khoá tài khoản người khác bằng cách spam sai mật khẩu)
const loginUsernameLimiter = new SlidingWindowLimiter({
  limit: 10, windowMs: 15 * 60 * 1000, name: 'login-username',
});

const allLimiters = [loginLimiter, registerLimiter, roomLookupLimiter, loginUsernameLimiter];

/**
 * REV-04: độ trễ tăng dần theo số lần đăng nhập thất bại của username (tối đa 2s).
 * @param {string} username
 * @returns {number} ms
 */
function loginSlowdownMs(username) {
  const failures = loginUsernameLimiter.countOf(`login-user:${username}`);
  if (failures <= 0) return 0;
  return Math.min(2000, failures * 200);
}

/**
 * Kiểm tra giới hạn; trả về object mô tả lỗi 429 hoặc null nếu hợp lệ.
 * @param {SlidingWindowLimiter} limiter
 * @param {string} key
 * @returns {{statusCode:number, code:string, message:string, retryAfterSeconds:number}|null}
 */
function enforce(limiter, key) {
  const result = limiter.consume(key);
  if (result.allowed) return null;
  return {
    statusCode: 429,
    code: 'RATE_LIMITED',
    message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.',
    retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
  };
}

function resetAll() {
  for (const limiter of allLimiters) limiter.reset();
}

const cleanupTimer = setInterval(() => {
  for (const limiter of allLimiters) limiter.cleanup();
}, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = {
  SlidingWindowLimiter,
  getClientIp,
  isDevLoopbackExempt,
  normalizeIp,
  rateLimitKeyForIp,
  loginSlowdownMs,
  loginUsernameLimiter,
  enforce,
  resetAll,
  loginLimiter,
  registerLimiter,
  roomLookupLimiter,
};
