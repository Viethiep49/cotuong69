/**
 * Script chạy Migration CSDL
 * Tự động đọc và thực thi các file SQL trong thư mục migrations.
 *
 * BE-17: mỗi file migration chạy trong MỘT transaction trên một client riêng,
 * ghi lịch sử trong cùng transaction; trên PostgreSQL dùng advisory lock để 2
 * instance không chạy migration song song.
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/db');

const ADVISORY_LOCK_KEY = 728369; // hằng số cố định cho toàn bộ migration của app

function isPostgres() {
  return (process.env.DB_CLIENT || 'postgres') !== 'sqlite';
}

/**
 * Tách câu lệnh cho SQLite (adapter chỉ chạy được 1 statement / lần).
 * Postgres chạy cả file một lần nên không cần tách.
 */
function splitStatements(sqlContent) {
  return sqlContent
    // Tách TRƯỚC khi xoá comment để còn thấy marker "pg-only"
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    // BE-18: câu lệnh chỉ dành cho PostgreSQL được đánh dấu "pg-only"
    .filter((statement) => !/\bpg-only\b/i.test(statement))
    .map((statement) => statement.replace(/--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0)
    // SQLite không hỗ trợ ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
    .map((statement) => statement
      .replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, 'ADD COLUMN')
      .replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE INDEX'));
}

/**
 * Chạy 1 file migration nguyên tử.
 * @param {string} file
 * @param {string} sqlContent
 */
async function applyMigration(file, sqlContent) {
  const client = typeof db.getClient === 'function' ? await db.getClient() : null;
  const postgres = isPostgres();

  if (!client) {
    for (const statement of splitStatements(sqlContent)) {
      await db.query(statement);
    }
    await db.query('INSERT INTO migrations_history (name) VALUES ($1)', [file]);
    return;
  }

  try {
    await client.query('BEGIN');

    if (postgres) {
      // Chặn 2 process chạy migration cùng lúc
      await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    }

    // REV-10: kiểm tra lại "đã chạy chưa" SAU khi giữ lock. Kiểm tra ở runMigrations
    // nằm ngoài lock nên 2 instance cùng thấy "chưa chạy"; instance chờ lock phải
    // bỏ qua file mà instance kia vừa chạy xong.
    const done = await client.query('SELECT id FROM migrations_history WHERE name = $1', [file]);
    if (done.rows && done.rows.length > 0) {
      await client.query('COMMIT');
      console.log(`⏩ Bỏ qua ${file} (instance khác vừa chạy xong)`);
      return;
    }

    if (postgres) {
      // Postgres chạy được nhiều câu lệnh trong 1 lần query
      await client.query(sqlContent);
    } else {
      for (const statement of splitStatements(sqlContent)) {
        await client.query(statement);
      }
    }

    // Ghi lịch sử TRONG cùng transaction -> lỗi ở đâu rollback cả file
    await client.query('INSERT INTO migrations_history (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

async function runMigrations() {
  console.log('🔄 Bắt đầu chạy Migration CSDL...');

  // Tạo bảng theo dõi migration nếu chưa có
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations_history (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = __dirname;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await db.query(
      'SELECT id FROM migrations_history WHERE name = $1',
      [file]
    );

    if (existing.rows && existing.rows.length > 0) {
      console.log(`⏩ Bỏ qua ${file} (đã chạy trước đó)`);
      continue;
    }

    console.log(`⏳ Đang chạy migration: ${file}...`);
    const sqlPath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    await applyMigration(file, sqlContent);
    console.log(`✅ Hoàn thành migration: ${file}`);
  }

  console.log('🎉 Toàn bộ migration đã chạy thành công!');
}

if (require.main === module) {
  runMigrations()
    .then(() => db.closePool())
    .catch((err) => {
      console.error('❌ Lỗi khi chạy migration:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations, applyMigration, ADVISORY_LOCK_KEY };
