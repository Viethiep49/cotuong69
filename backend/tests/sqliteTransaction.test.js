require('./helpers/testEnv');
/**
 * BE-19: SQLite chỉ có một kết nối -> getClient() phải tuần tự hoá transaction,
 * không để 2 BEGIN/COMMIT xen kẽ nhau.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');

describe('BE-19: mutex transaction cho SQLite', () => {
  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    await db.query('CREATE TABLE IF NOT EXISTS be19_counter (id INTEGER PRIMARY KEY, value INTEGER)');
    await db.query('DELETE FROM be19_counter');
    await db.query('INSERT INTO be19_counter (id, value) VALUES (1, 0)');
  });

  after(async () => {
    await db.closePool();
  });

  async function incrementInTransaction(times) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT value FROM be19_counter WHERE id = 1');
      const value = Number(current.rows[0].value);
      // Nhường event loop để luồng khác chen vào nếu không có mutex
      await new Promise((resolve) => setTimeout(resolve, 5));
      await client.query('UPDATE be19_counter SET value = $1 WHERE id = 1', [value + times]);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  test('10 transaction song song không mất cập nhật (read-modify-write an toàn)', async () => {
    await db.query('UPDATE be19_counter SET value = 0 WHERE id = 1');

    await Promise.all(Array.from({ length: 10 }, () => incrementInTransaction(1)));

    const res = await db.query('SELECT value FROM be19_counter WHERE id = 1');
    assert.equal(Number(res.rows[0].value), 10, 'phải cộng đủ 10, không mất bản ghi nào');
  });

  test('release() 2 lần không làm treo mutex', async () => {
    const client = await db.getClient();
    client.release();
    client.release();

    const next = await db.getClient();
    const res = await next.query('SELECT 1 AS ok');
    assert.equal(res.rows.length, 1);
    next.release();
  });

  test('lỗi trong transaction không giữ khoá (release ở finally)', async () => {
    await assert.rejects(async () => {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query('THIS IS NOT SQL');
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    // Nếu khoá bị giữ, lần lấy client tiếp theo sẽ treo -> dùng timeout để phát hiện
    const client = await Promise.race([
      db.getClient(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('mutex bị treo')), 2000)),
    ]);
    client.release();
  });
});
