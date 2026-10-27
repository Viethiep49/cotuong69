require('./helpers/testEnv');
/**
 * SEC-02: JWT_SECRET phải được cấu hình qua biến môi trường (>= 32 ký tự),
 * không còn secret hardcode trong source.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  generateAccessToken,
  verifyAccessToken,
  assertJwtSecretConfigured,
} = require('../src/application/services/tokenService');

const OLD_HARDCODED_SECRET = 'cotuong69-jwt-secret-key-2026';

function withEnv(value, fn) {
  const backup = process.env.JWT_SECRET;
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  try {
    return fn();
  } finally {
    if (backup === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = backup;
  }
}

describe('SEC-02: JWT_SECRET bắt buộc cấu hình', () => {
  test('thiếu JWT_SECRET → throw lỗi cấu hình rõ ràng (không dùng secret mặc định)', () => {
    withEnv(undefined, () => {
      assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET chưa được cấu hình/);
      assert.throws(() => generateAccessToken({ id: 1, username: 'a' }), /JWT_SECRET chưa được cấu hình/);
    });
  });

  test('JWT_SECRET ngắn hơn 32 ký tự cũng bị từ chối', () => {
    withEnv('qua-ngan', () => {
      assert.throws(() => assertJwtSecretConfigured(), /JWT_SECRET chưa được cấu hình/);
    });
  });

  test('token ký bằng secret hardcode cũ bị từ chối', () => {
    const forged = jwt.sign(
      { id: 999, username: 'admin', role: 'ADMIN' },
      OLD_HARDCODED_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
    assert.throws(
      () => verifyAccessToken(forged),
      (err) => err.code === 'INVALID_TOKEN',
    );
  });

  test('token alg=none bị từ chối (chỉ chấp nhận HS256)', () => {
    const noneToken = jwt.sign({ id: 1, username: 'a' }, OLD_HARDCODED_SECRET, { algorithm: 'none' });
    assert.throws(() => verifyAccessToken(noneToken), (err) => err.code === 'INVALID_TOKEN');
  });

  test('ký và xác thực thành công với JWT_SECRET hợp lệ', () => {
    const token = generateAccessToken({ id: 7, username: 'kythu' });
    const decoded = verifyAccessToken(token);
    assert.equal(decoded.id, 7);
    assert.equal(decoded.username, 'kythu');
    assert.equal(decoded.email, undefined);
  });
});
