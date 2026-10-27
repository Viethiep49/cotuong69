/**
 * Cấu hình kết nối Cơ sở dữ liệu và Connection Pool
 * Hỗ trợ PostgreSQL (Production/Dev) và SQLite in-memory (Test/Standalone)
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

let pool = null;
let sqliteDb = null;

const dbClient = process.env.DB_CLIENT || 'postgres';

if (dbClient === 'postgres') {
  const { Pool } = require('pg');

  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'co_tuong_db',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
  });
}

/**
 * Thực thi câu lệnh SQL với tham số
 * @param {string} text - Câu lệnh SQL
 * @param {Array} params - Danh sách tham số
 * @returns {Promise<{ rows: Array, rowCount: number }>}
 */
async function query(text, params = []) {
  if (dbClient === 'sqlite' || sqliteDb) {
    return querySqlite(text, params);
  }

  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Lấy một client từ connection pool (dành cho transaction)
 */
async function getClient() {
  if (dbClient === 'sqlite' || sqliteDb) {
    return {
      query: (t, p) => querySqlite(t, p),
      release: () => {},
    };
  }
  return await pool.connect();
}

/**
 * Đóng connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
}

/**
 * Adapter SQLite dùng cho Unit Test hoặc môi trường không có Postgres server
 */
function initSqlite(dbInstance) {
  sqliteDb = dbInstance;
}

function querySqlite(text, params = []) {
  if (!sqliteDb) {
    const { DatabaseSync } = require('node:sqlite');
    sqliteDb = new DatabaseSync(':memory:');
  }

  // Chuyển đổi cú pháp $1, $2 của Postgres sang ? của SQLite kèm map đúng tham số
  // BE-01: node:sqlite không nhận kiểu boolean -> ép về 0/1
  const normalizeParam = (value) => (value === true ? 1 : value === false ? 0 : value);

  const expandedParams = [];
  let sqliteText = text.replace(/\$(\d+)/g, (match, num) => {
    const index = parseInt(num, 10) - 1;
    expandedParams.push(normalizeParam(params[index]));
    return '?';
  });
  // Chuyển đổi một số cú pháp DDL đặc thù nếu có
  sqliteText = sqliteText
    .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/TIMESTAMP WITH TIME ZONE/gi, 'DATETIME')
    .replace(/BOOLEAN/gi, 'INTEGER');

  try {
    // BE-02: UPDATE/INSERT ... RETURNING cũng trả về dòng -> phải dùng all()
    const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(sqliteText) || /\bRETURNING\b/i.test(sqliteText);
    const stmt = sqliteDb.prepare(sqliteText);

    if (isSelect) {
      const rows = stmt.all(...expandedParams);
      return { rows, rowCount: rows.length };
    } else {
      const result = stmt.run(...expandedParams);
      return {
        rows: [],
        rowCount: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    }
  } catch (err) {
    throw err;
  }
}

module.exports = {
  query,
  getClient,
  closePool,
  initSqlite,
  getPool: () => pool,
};
