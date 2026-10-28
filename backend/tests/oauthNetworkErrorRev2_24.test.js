require('./helpers/testEnv');
/**
 * REV2-24: lỗi mạng khi gọi Google không được lộ chi tiết nội bộ (hostname, mã lỗi hệ thống) ra client.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const OAuthVerifierService = require('../src/application/services/oauthService');

describe('REV2-24: NETWORK_ERROR của OAuth không lộ chi tiết', () => {
  const originalGet = https.get;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalError = console.error;
  let logged;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
    logged = [];
    console.error = (...args) => logged.push(args.join(' '));
  });

  afterEach(() => {
    https.get = originalGet;
    console.error = originalError;
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  test('getaddrinfo ENOTFOUND chỉ vào log phía server; client nhận thông điệp cố định', async () => {
    https.get = () => {
      const req = new EventEmitter();
      setImmediate(() => req.emit('error', new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com')));
      return req;
    };

    await assert.rejects(
      () => new OAuthVerifierService().verify('google', 'real-looking-token'),
      (err) => {
        assert.equal(err.code, 'NETWORK_ERROR');
        assert.equal(err.statusCode, 502);
        assert.doesNotMatch(err.message, /getaddrinfo|ENOTFOUND|googleapis/i);
        assert.equal(err.message, 'Không thể kết nối đến máy chủ Google. Vui lòng thử lại sau.');
        return true;
      },
    );
    assert.ok(logged.some((line) => line.includes('ENOTFOUND')), 'chi tiết phải được ghi log phía server');
  });
});
