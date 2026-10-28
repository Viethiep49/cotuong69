require('./helpers/testEnv');
/**
 * BE-01: cột is_used là BOOLEAN trên PostgreSQL — không được so sánh/gán bằng 1/0
 * (Postgres báo "operator does not exist: boolean = integer").
 * SQLite thì chấp nhận cả hai nên phải kiểm tra ở mức SQL sinh ra.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const PgPasswordResetRepository = require('../src/infrastructure/database/repositories/PgPasswordResetRepository');

function makeRecordingDb() {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text: String(text), params });
      if (/^\s*SELECT/i.test(text)) return { rows: [{ id: 1, count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
}

describe('BE-01: SQL boolean cho password_reset_tokens', () => {
  test('invalidateOldTokens dùng TRUE/FALSE, không dùng = 1/= 0', async () => {
    const db = makeRecordingDb();
    const repo = new PgPasswordResetRepository({ db });
    await repo.invalidateOldTokens(7);

    const sql = db.calls.map((c) => c.text).join('\n');
    assert.match(sql, /SET is_used = TRUE/);
    assert.match(sql, /is_used = FALSE/);
    assert.doesNotMatch(sql, /is_used = 1\b/);
    assert.doesNotMatch(sql, /is_used = 0\b/);
  });

  test('markTokenUsed dùng TRUE', async () => {
    const db = makeRecordingDb();
    const repo = new PgPasswordResetRepository({ db });
    await repo.markTokenUsed('abc');

    const sql = db.calls[0].text;
    assert.match(sql, /SET is_used = TRUE/);
    assert.doesNotMatch(sql, /is_used = 1\b/);
  });

  test('createResetToken truyền boolean thật (không phải 1)', async () => {
    const db = makeRecordingDb();
    const repo = new PgPasswordResetRepository({ db });
    await repo.createResetToken({ userId: 7, token: 'tok', expiresAt: new Date(Date.now() + 60000) });

    const insert = db.calls[0];
    assert.equal(insert.params[3], false);
    assert.equal(typeof insert.params[3], 'boolean');
  });

  test('createOtpCode truyền boolean thật cho is_used', async () => {
    const db = makeRecordingDb();
    const repo = new PgPasswordResetRepository({ db });
    await repo.createOtpCode({ email: 'a@b.com', code: '123456', expiresAt: new Date(Date.now() + 60000) });

    const insert = db.calls[0];
    assert.equal(insert.params[4], false);
    assert.equal(typeof insert.params[4], 'boolean');
  });
});
