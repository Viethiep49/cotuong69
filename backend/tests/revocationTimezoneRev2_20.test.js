require('./helpers/testEnv');
/**
 * REV2-20: SQLite lưu CURRENT_TIMESTAMP là chuỗi UTC không múi giờ. Ngoài UTC, `new Date(chuỗi)` hiểu là
 * giờ local nên token cũ vẫn được chấp nhận sau khi đổi mật khẩu (múi giờ dương) hoặc token mới bị thu hồi
 * (múi giờ âm). Chạy luồng thật (updatePassword rồi dùng lại token cũ) trong nhiều múi giờ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseDbTimestamp } = require('../src/core/dbTimestamp');

const CHILD = path.join(__dirname, 'helpers', 'revocationTzChild.js');

function runInTimezone(tz) {
  const run = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', CHILD], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(run.status, 0, `tiến trình con lỗi (TZ=${tz}): ${run.stderr}`);
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `không có kết quả (TZ=${tz}): ${run.stdout}`);
  return JSON.parse(line.slice('RESULT '.length));
}

describe('REV2-20: thu hồi token sau đổi mật khẩu không phụ thuộc múi giờ máy', () => {
  for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
    test(`TZ=${tz}: token cũ bị thu hồi, token phát hành sau đó vẫn dùng được`, () => {
      const result = runInTimezone(tz);
      assert.equal(result.old, 'TOKEN_REVOKED', `token cũ phải bị thu hồi (TZ=${tz})`);
      assert.equal(result.fresh, 'ACCEPTED', `token mới phải dùng được (TZ=${tz})`);
    });
  }

  test('parseDbTimestamp coi chuỗi không múi giờ là UTC, giữ nguyên Date và chuỗi có múi giờ', () => {
    assert.equal(parseDbTimestamp('2026-10-28 09:00:00').toISOString(), '2026-10-28T09:00:00.000Z');
    assert.equal(parseDbTimestamp('2026-10-28T09:00:00').toISOString(), '2026-10-28T09:00:00.000Z');
    assert.equal(parseDbTimestamp('2026-10-28 09:00:00.250').toISOString(), '2026-10-28T09:00:00.250Z');
    assert.equal(parseDbTimestamp('2026-10-28T09:00:00+07:00').toISOString(), '2026-10-28T02:00:00.000Z');
    assert.equal(parseDbTimestamp('2026-10-28T09:00:00Z').toISOString(), '2026-10-28T09:00:00.000Z');
    const d = new Date(0);
    assert.equal(parseDbTimestamp(d), d);
    assert.equal(parseDbTimestamp(null), null);
    assert.equal(parseDbTimestamp(''), null);
  });
});
