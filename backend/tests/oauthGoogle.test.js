require('./helpers/testEnv');
/**
 * SEC-05: Google OAuth là tuỳ chọn — chỉ bật khi có GOOGLE_CLIENT_ID,
 * và phải kiểm tra aud/iss/email_verified/exp của ID token.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const OAuthVerifierService = require('../src/application/services/oauthService');
const { validateGoogleClaims } = require('../src/application/services/oauthService');

const CLIENT_ID = 'cotuong69.apps.googleusercontent.com';

function googleClaims(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google_sub_123',
    email: 'kythu@gmail.com',
    email_verified: 'true',
    name: 'Kỳ Thủ Google',
    picture: 'https://lh3.googleusercontent.com/a/x',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    ...overrides,
  };
}

function expectInvalid(body, clientId = CLIENT_ID) {
  assert.throws(
    () => validateGoogleClaims(body, clientId),
    (err) => err.code === 'INVALID_OAUTH_TOKEN' && err.statusCode === 401,
  );
}

describe('SEC-05: kiểm tra Google ID token', () => {
  test('claims hợp lệ → trả profile đã chuẩn hoá', () => {
    const profile = validateGoogleClaims(googleClaims({ email: 'KyThu@Gmail.com' }), CLIENT_ID);
    assert.equal(profile.providerId, 'google_sub_123');
    assert.equal(profile.email, 'kythu@gmail.com');
    assert.equal(profile.name, 'Kỳ Thủ Google');
    assert.equal(profile.avatarUrl, 'https://lh3.googleusercontent.com/a/x');
  });

  test('aud không khớp GOOGLE_CLIENT_ID → từ chối (token của app khác)', () => {
    expectInvalid(googleClaims({ aud: 'app-khac.apps.googleusercontent.com' }));
  });

  test('iss không hợp lệ → từ chối', () => {
    expectInvalid(googleClaims({ iss: 'https://evil.example.com' }));
  });

  test('email chưa xác minh → từ chối', () => {
    expectInvalid(googleClaims({ email_verified: 'false' }));
    expectInvalid(googleClaims({ email_verified: false }));
  });

  test('token hết hạn → từ chối', () => {
    expectInvalid(googleClaims({ exp: String(Math.floor(Date.now() / 1000) - 10) }));
  });

  test('thiếu sub/email hoặc có body.error → từ chối', () => {
    expectInvalid(googleClaims({ sub: undefined }));
    expectInvalid(googleClaims({ email: undefined }));
    expectInvalid({ error: 'invalid_token' });
  });

  test('thiếu GOOGLE_CLIENT_ID → verify trả OAUTH_DISABLED 503, không gọi mạng', async () => {
    const backup = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      const verifier = new OAuthVerifierService();
      await assert.rejects(
        () => verifier.verify('google', 'header.payload.signature'),
        (err) => {
          assert.equal(err.code, 'OAUTH_DISABLED');
          assert.equal(err.statusCode, 503);
          return true;
        },
      );
    } finally {
      if (backup === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = backup;
    }
  });

  test('provider facebook bị từ chối', async () => {
    const verifier = new OAuthVerifierService();
    await assert.rejects(
      () => verifier.verify('facebook', 'bat-ky-token'),
      (err) => err.code === 'UNSUPPORTED_OAUTH_PROVIDER',
    );
  });
});
