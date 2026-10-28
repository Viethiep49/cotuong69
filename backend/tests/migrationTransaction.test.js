require('./helpers/testEnv');
/**
 * BE-17: migration phải nguyên tử (transaction) và idempotent.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations, applyMigration } = require('../src/migrations/migrate');

describe('BE-17: migration transaction + idempotent', () => {
  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
  });

  after(async () => {
    await db.closePool();
  });

  test('chạy lại toàn bộ migration không lỗi (đã có migrations_history)', async () => {
    await runMigrations();
    const rows = await db.query('SELECT name FROM migrations_history ORDER BY name');
    const names = rows.rows.map((r) => r.name);
    assert.ok(names.length >= 4, `phải có >= 4 migration, có ${names.length}`);
    assert.equal(new Set(names).size, names.length, 'không được trùng tên migration');
  });

  test('migration lỗi giữa đường thì rollback, không ghi lịch sử', async () => {
    const before = await db.query('SELECT COUNT(*) AS c FROM migrations_history');
    const badSql = `
      CREATE TABLE be17_demo (id SERIAL PRIMARY KEY, name TEXT);
      THIS IS NOT VALID SQL;
    `;

    await assert.rejects(() => applyMigration('999_be17_bad.sql', badSql));

    const after = await db.query('SELECT COUNT(*) AS c FROM migrations_history');
    assert.equal(Number(after.rows[0].c), Number(before.rows[0].c), 'không được ghi migration lỗi');

    const table = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='be17_demo'");
    assert.equal(table.rows.length, 0, 'bảng tạo trước câu lệnh lỗi phải bị rollback');
  });

  test('ADD COLUMN IF NOT EXISTS chạy được trên SQLite (adapter bỏ mệnh đề)', async () => {
    // 003/004 đã dùng IF NOT EXISTS; nếu adapter không xử lý thì runMigrations đã fail
    const cols = await db.query('PRAGMA table_info(users)');
    const names = cols.rows.map((c) => c.name);
    assert.ok(names.includes('password_changed_at'), 'thiếu cột password_changed_at');
  });

  test('migration chạy thành công thì ghi đúng 1 dòng lịch sử', async () => {
    const marker = '998_be17_ok.sql';
    await db.query('DELETE FROM migrations_history WHERE name = $1', [marker]);
    await applyMigration(marker, 'CREATE TABLE IF NOT EXISTS be17_ok (id INTEGER PRIMARY KEY);');
    const rows = await db.query('SELECT COUNT(*) AS c FROM migrations_history WHERE name = $1', [marker]);
    assert.equal(Number(rows.rows[0].c), 1);
  });
});

describe('REV-10: kiểm tra "đã chạy chưa" nằm trong lock', () => {
  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
  });

  after(async () => {
    await db.closePool();
  });

  test('instance thứ hai (đã qua kiểm tra ngoài lock) bỏ qua file vừa được chạy, không lỗi', async () => {
    const name = '997_rev10_race.sql';
    // SQL KHÔNG idempotent: chạy lần hai sẽ lỗi "table already exists" nếu không recheck
    const sql = 'CREATE TABLE rev10_race (id INTEGER PRIMARY KEY);';

    await applyMigration(name, sql); // instance A
    await applyMigration(name, sql); // instance B: vừa qua kiểm tra ngoài lock

    const rows = await db.query('SELECT COUNT(*) AS c FROM migrations_history WHERE name = $1', [name]);
    assert.equal(Number(rows.rows[0].c), 1, 'chỉ 1 dòng lịch sử');
  });

  test('trên PostgreSQL: recheck lịch sử diễn ra SAU pg_advisory_xact_lock', async () => {
    const calls = [];
    const originalGetClient = db.getClient;
    const previousClient = process.env.DB_CLIENT;
    db.getClient = async () => ({
      query: async (sql) => {
        calls.push(String(sql).trim().split(/\s+/).slice(0, 2).join(' '));
        if (/migrations_history WHERE/.test(sql)) return { rows: [{ id: 1 }] }; // đã chạy
        return { rows: [] };
      },
      release() {},
    });
    process.env.DB_CLIENT = 'postgres';
    try {
      await applyMigration('996_rev10_pg.sql', 'SELECT 1;');
    } finally {
      db.getClient = originalGetClient;
      process.env.DB_CLIENT = previousClient;
    }

    const lockIdx = calls.findIndex((c) => c.includes('pg_advisory_xact_lock'));
    const checkIdx = calls.findIndex((c) => c.startsWith('SELECT id'));
    assert.ok(lockIdx >= 0 && checkIdx > lockIdx, `recheck phải sau lock: ${calls.join(' | ')}`);
    assert.ok(calls.includes('COMMIT'), 'file đã chạy -> COMMIT rồi bỏ qua');
    assert.ok(!calls.includes('INSERT INTO'), 'không được chạy/ghi lại file đã chạy');
  });
});
