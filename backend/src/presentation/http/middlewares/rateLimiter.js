/**
 * BE-13: rate limiter in-memory dạng sliding window cho các endpoint dễ bị brute force.
 * Không phụ thuộc thư viện ngoài (đồ án không dùng Express).
 */

class SlidingWindowLimiter {
  /**
   * @param {{limit:number, windowMs:number, name?:string}} options
   */
  constructor({ limit, windowMs, name = 'limiter' }) {
    this.limit = Number(limit);
    this.windowMs = Number(windowMs);
    this.name = name;
    this.hits = new Map(); // key -> number[] (timestamps)
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
    this.hits.set(key, recent);
    return { allowed: true, remaining: Math.max(0, this.limit - recent.length), retryAfterMs: 0 };
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

/**
 * Lấy IP client (chấp nhận x-forwarded-for khi chạy sau proxy).
 */
function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'] || request.headers['X-Forwarded-For'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const remote = request.socket && request.socket.remoteAddress;
  return remote || 'unknown';
}

// Giới hạn theo plan BE-13
const loginLimiter = new SlidingWindowLimiter({ limit: 10, windowMs: 15 * 60 * 1000, name: 'login' });
const registerLimiter = new SlidingWindowLimiter({ limit: 5, windowMs: 60 * 60 * 1000, name: 'register' });
const roomLookupLimiter = new SlidingWindowLimiter({ limit: 30, windowMs: 60 * 1000, name: 'room-lookup' });

const allLimiters = [loginLimiter, registerLimiter, roomLookupLimiter];

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
  enforce,
  resetAll,
  loginLimiter,
  registerLimiter,
  roomLookupLimiter,
};
