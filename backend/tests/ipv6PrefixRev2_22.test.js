require('./helpers/testEnv');
/**
 * REV2-22: IPv6 được khoá theo tiền tố /64 để không né giới hạn bằng cách đổi địa chỉ trong dải.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { getClientIp, rateLimitKeyForIp, SlidingWindowLimiter } = require('../src/presentation/http/middlewares/rateLimiter');

const req = (remote, xff) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });

describe('REV2-22: khoá IPv6 theo /64', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  test('mọi địa chỉ trong cùng /64 cho cùng một khoá; /64 khác cho khoá khác', () => {
    const a = getClientIp(req('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
    const b = getClientIp(req('2001:db8:1:2::1'));
    const c = getClientIp(req('2001:0db8:0001:0002:0000:0000:0000:0001'));
    const other = getClientIp(req('2001:db8:1:3::1'));
    assert.equal(a, '2001:db8:1:2::/64');
    assert.equal(b, a);
    assert.equal(c, a);
    assert.notEqual(other, a);
  });

  test('"::" ở đầu / giữa / cuối và loopback', () => {
    assert.equal(rateLimitKeyForIp('::1'), '0:0:0:0::/64');
    assert.equal(rateLimitKeyForIp('2001:db8::'), '2001:db8:0:0::/64');
    assert.equal(rateLimitKeyForIp('fe80::1'), 'fe80:0:0:0::/64');
    assert.equal(rateLimitKeyForIp('2001:db8:0:5::9'), '2001:db8:0:5::/64');
  });

  test('IPv4 và IPv4-mapped IPv6 giữ nguyên là IPv4', () => {
    assert.equal(getClientIp(req('203.0.113.7')), '203.0.113.7');
    assert.equal(getClientIp(req('::ffff:203.0.113.7')), '203.0.113.7');
  });

  test('địa chỉ IPv6 hỏng giữ nguyên (không ném lỗi)', () => {
    assert.equal(rateLimitKeyForIp('1:2:3:4:5:6:7:8:9'), '1:2:3:4:5:6:7:8:9');
    assert.equal(rateLimitKeyForIp('1::2::3'), '1::2::3');
    assert.equal(rateLimitKeyForIp('zzzz::1'), 'zzzz::1');
  });

  test('IPv6 trong X-Forwarded-For (TRUST_PROXY=true) cũng theo /64', () => {
    process.env.TRUST_PROXY = 'true';
    assert.equal(getClientIp(req('10.0.0.1', '6.6.6.6, 2001:db8:9:9:1:2:3:4')), '2001:db8:9:9::/64');
  });

  test('đổi 64 bit cuối liên tục vẫn bị cùng một bộ đếm', () => {
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 60000, name: 'ipv6' });
    let blocked = false;
    for (let i = 0; i < 5; i += 1) {
      const key = `login-ip:${getClientIp(req(`2001:db8:1:2::${(i + 1).toString(16)}`))}`;
      if (!limiter.consume(key).allowed) blocked = true;
    }
    assert.equal(blocked, true);
  });
});
