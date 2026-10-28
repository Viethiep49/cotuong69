/**
 * FE-11: token & dữ liệu nhạy cảm phía client.
 *  - Reset token không được để lại trong URL sau khi dùng.
 *  - Token JWT không parse được phải coi là hết hạn (fail closed).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AUTH_JS = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
const ROOMS_JS = fs.readFileSync(path.join(ROOT, 'js/rooms.js'), 'utf8');

describe('FE-11: token phía client', () => {
  test('token không phải JWT (không đủ 3 phần) bị coi là hết hạn', () => {
    assert.ok(
      AUTH_JS.includes('if (parts.length !== 3) return true;'),
      'isTokenExpired phải fail-closed khi token sai định dạng',
    );
  });

  test('payload không decode được cũng bị coi là hết hạn', () => {
    assert.ok(
      /catch \{\s*\/\/ FE-11: payload hỏng -> coi như hết hạn\s*return true;/.test(AUTH_JS),
      'catch của isTokenExpired phải return true',
    );
  });

  test('xoá token reset khỏi URL bằng history.replaceState', () => {
    assert.ok(ROOMS_JS.includes('history.replaceState'), 'chưa dùng history.replaceState');
    assert.ok(ROOMS_JS.includes("searchParams.delete('token')"), 'chưa xoá ?token= khỏi URL');
  });

  test('không log token ra console', () => {
    const offenders = [];
    for (const [name, src] of [['js/auth.js', AUTH_JS], ['js/rooms.js', ROOMS_JS]]) {
      const lines = src.split('\n');
      lines.forEach((line, index) => {
        if (/console\.(log|info|warn|error)\(/.test(line) && /token/i.test(line)) {
          offenders.push(`${name}:${index + 1}`);
        }
      });
    }
    assert.deepStrictEqual(offenders, [], `log token: ${offenders.join(', ')}`);
  });
});
