require('./helpers/testEnv');
/**
 * REV-03: whitelist mã lỗi không được biến lỗi nghiệp vụ hợp lệ thành 500.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { toErrorResponse } = require('../src/presentation/http/utils/errorResponse');
const { AppError, ERROR_CODES, DEFAULT_STATUS_BY_CODE } = require('../src/core/errors/AppError');

function makeErr(code, message, statusCode) {
  const err = new Error(message);
  err.code = code;
  if (statusCode) err.statusCode = statusCode;
  return err;
}

describe('REV-03: map mã lỗi nghiệp vụ', () => {
  test('OAUTH_DISABLED (503) không còn bị biến thành 500', () => {
    const res = toErrorResponse(makeErr('OAUTH_DISABLED', 'Đăng nhập Google chưa được bật.', 503));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'OAUTH_DISABLED');
    assert.match(res.body.error, /Google/);
  });

  test('NO_TOKEN trả 401 thay vì 500', () => {
    const res = toErrorResponse(makeErr('NO_TOKEN', 'Thiếu token xác thực.', 401));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'NO_TOKEN');
  });

  test('USER_KICKED trả 403, FILE_TOO_LARGE trả 413', () => {
    assert.equal(toErrorResponse(makeErr('USER_KICKED', 'Bạn đã bị mời ra khỏi phòng.', 403)).statusCode, 403);
    assert.equal(toErrorResponse(makeErr('FILE_TOO_LARGE', 'Ảnh quá lớn.', 413)).statusCode, 413);
  });

  test('AppError tự suy ra status từ mã khi không truyền', () => {
    assert.equal(toErrorResponse(new AppError('NO_TOKEN', 'Thiếu token')).statusCode, 401);
    assert.equal(toErrorResponse(new AppError('USER_KICKED', 'Bị kick')).statusCode, 403);
    assert.equal(toErrorResponse(new AppError('OAUTH_DISABLED', 'Tắt OAuth')).statusCode, 503);
    assert.equal(toErrorResponse(new AppError('FILE_TOO_LARGE', 'Quá lớn')).statusCode, 413);
    assert.equal(toErrorResponse(new AppError('CANNOT_KICK_HOST', 'Không được kick chủ phòng')).statusCode, 403);
  });

  test('lỗi hệ thống thật vẫn là 500 INTERNAL_ERROR, không lộ chi tiết', () => {
    const dbErr = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const res = toErrorResponse(dbErr);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(res.body).includes('ECONNREFUSED'));

    const typeErr = new TypeError("Cannot read properties of undefined (reading 'id')");
    assert.equal(toErrorResponse(typeErr).statusCode, 500);
  });

  test('mã lạ không nằm trong ERROR_CODES vẫn bị coi là lỗi hệ thống', () => {
    const res = toErrorResponse(makeErr('SOME_UNKNOWN_THING', 'boom', 400));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
  });

  test('mọi err.code = "..." trong src/ đều có trong ERROR_CODES và có status 4xx/5xx', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const codes = new Set();

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const source = fs.readFileSync(full, 'utf8');
          for (const match of source.matchAll(/err\.code\s*=\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(match[1]);
          for (const match of source.matchAll(/new AppError\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(match[1]);
          // REV2-25: mã lỗi viết thẳng trong body JSON / tin WS (`code: 'METHOD_NOT_ALLOWED'`) cũng phải khai báo
          for (const match of source.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)) {
            if (match[1] !== 'INTERNAL_ERROR') codes.add(match[1]); // INTERNAL_ERROR là mã dự phòng của errorResponse
          }
        }
      }
    };
    walk(srcDir);

    assert.ok(codes.size > 20, `phải quét được nhiều mã, thực tế ${codes.size}`);

    const missing = [...codes].filter((code) => !ERROR_CODES[code]);
    assert.deepEqual(missing, [], `mã lỗi chưa khai báo trong ERROR_CODES: ${missing.join(', ')}`);

    const badStatus = [...codes].filter((code) => {
      const res = toErrorResponse(new AppError(code, 'x'));
      return !(res.statusCode >= 400 && res.statusCode <= 599) || res.body.code === 'INTERNAL_ERROR';
    });
    assert.deepEqual(badStatus, [], `mã lỗi chưa map đúng status: ${badStatus.join(', ')}`);

    // Bảng status mặc định không được chứa mã không tồn tại
    const orphanStatuses = Object.keys(DEFAULT_STATUS_BY_CODE).filter((code) => !ERROR_CODES[code]);
    assert.deepEqual(orphanStatuses, []);
  });
});
