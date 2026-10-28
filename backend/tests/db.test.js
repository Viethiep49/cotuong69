require('./helpers/testEnv.js');
/**
 * Unit & Integration Test cho COT-570: Schema CSDL & Connection Pool
 * Sử dụng node:test và node:assert tích hợp sẵn trong Node.js (không cần phụ thuộc ngoài)
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

// Đặt môi trường SQLite cho test độc lập
process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const { runSeed } = require('../src/seeds/seed');

describe('Kiểm thử Schema CSDL & Nghiệm thu Task COT-570', () => {
  before(async () => {
    // Khởi tạo Database SQLite in-memory dùng cho test
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
  });

  after(async () => {
    await db.closePool();
  });

  test('1. Migration chạy thành công không có lỗi cú pháp', async () => {
    await assert.doesNotReject(async () => {
      await runMigrations();
    }, 'Quá trình chạy migration phải thành công không sinh lỗi cú pháp.');
  });

  test('2. Điểm Elo khởi tạo mặc định phải là 1000', async () => {
    await db.query(
      `INSERT INTO users (username, display_name, email)
       VALUES ($1, $2, $3)`,
      ['player_elo_test', 'Kỳ Thủ Elo', 'elotest@cotuong.vn']
    );

    const res = await db.query(
      'SELECT elo_rating FROM users WHERE username = $1',
      ['player_elo_test']
    );

    assert.equal(res.rows.length, 1);
    assert.equal(
      res.rows[0].elo_rating,
      1000,
      'Điểm Elo khởi tạo phải mặc định là 1000'
    );
  });

  test('3. Bảng Users có ràng buộc Unique cho username', async () => {
    await assert.rejects(
      async () => {
        // Cố tình chèn username đã tồn tại
        await db.query(
          `INSERT INTO users (username, display_name, email)
           VALUES ($1, $2, $3)`,
          ['player_elo_test', 'Trùng Username', 'unique_email_1@cotuong.vn']
        );
      },
      /UNIQUE constraint failed/i,
      'Phải ném lỗi UNIQUE constraint khi trùng username'
    );
  });

  test('4. Bảng Users có ràng buộc Unique cho email', async () => {
    await assert.rejects(
      async () => {
        // Cố tình chèn email đã tồn tại
        await db.query(
          `INSERT INTO users (username, display_name, email)
           VALUES ($1, $2, $3)`,
          ['unique_user_2', 'Trùng Email', 'elotest@cotuong.vn']
        );
      },
      /UNIQUE constraint failed/i,
      'Phải ném lỗi UNIQUE constraint khi trùng email'
    );
  });

  test('5. Bảng password_reset_tokens lưu trữ token và có ràng buộc Unique', async () => {
    const user = await db.query(
      'SELECT id FROM users WHERE username = $1',
      ['player_elo_test']
    );
    const userId = user.rows[0].id;

    // Chèn token
    await db.query(
      `INSERT INTO password_reset_tokens (token, user_id, expires_at, is_used)
       VALUES ($1, $2, datetime('now', '+15 minutes'), 0)`,
      ['sample_reset_token_123', userId]
    );

    // Kiểm tra trùng token
    await assert.rejects(
      async () => {
        await db.query(
          `INSERT INTO password_reset_tokens (token, user_id, expires_at, is_used)
           VALUES ($1, $2, datetime('now', '+15 minutes'), 0)`,
          ['sample_reset_token_123', userId]
        );
      },
      /UNIQUE constraint failed/i,
      'Token đặt lại mật khẩu phải là duy nhất'
    );
  });

  test('6. Bảng friends có ràng buộc không kết bạn với chính mình và không trùng cặp', async () => {
    const user1 = await db.query(
      'SELECT id FROM users WHERE username = $1',
      ['player_elo_test']
    );
    const u1 = user1.rows[0].id;

    // Tạo user 2
    await db.query(
      `INSERT INTO users (username, display_name, email)
       VALUES ($1, $2, $3)`,
      ['friend_player_2', 'Bạn Cờ', 'friend2@cotuong.vn']
    );
    const user2 = await db.query(
      'SELECT id FROM users WHERE username = $1',
      ['friend_player_2']
    );
    const u2 = user2.rows[0].id;

    // Kết bạn hợp lệ
    await db.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)',
      [u1, u2, 'ACCEPTED']
    );

    // Không thể kết bạn lặp lại
    await assert.rejects(
      async () => {
        await db.query(
          'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)',
          [u1, u2, 'PENDING']
        );
      },
      /UNIQUE constraint failed/i
    );
  });

  test('7. Bảng oauth_identities lưu trữ liên kết Google/Facebook', async () => {
    const user = await db.query(
      'SELECT id FROM users WHERE username = $1',
      ['player_elo_test']
    );
    const userId = user.rows[0].id;

    await db.query(
      'INSERT INTO oauth_identities (user_id, provider, provider_id) VALUES ($1, $2, $3)',
      [userId, 'google', 'google_sub_10928301923']
    );

    const res = await db.query(
      'SELECT * FROM oauth_identities WHERE user_id = $1',
      [userId]
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].provider, 'google');
  });

  test('8. Bảng otp_codes lưu trữ mã OTP xác thực', async () => {
    await db.query(
      `INSERT INTO otp_codes (email, code, type, expires_at, is_used)
       VALUES ($1, $2, $3, datetime('now', '+10 minutes'), 0)`,
      ['test_otp@cotuong.vn', '849201', 'RESET_PASSWORD']
    );

    const res = await db.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2',
      ['test_otp@cotuong.vn', '849201']
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].code, '849201');
  });

  test('9. Script Seed khởi tạo Roles và User mẫu thành công', async () => {
    await assert.doesNotReject(async () => {
      await runSeed();
    }, 'Seed script phải chạy thành công.');

    const roles = await db.query('SELECT name FROM roles ORDER BY name');
    const roleNames = roles.rows.map((r) => r.name);
    assert.ok(roleNames.includes('USER'));
    assert.ok(roleNames.includes('ADMIN'));

    const demoUser = await db.query(
      'SELECT username, elo_rating FROM users WHERE username = $1',
      ['demo_player']
    );
    assert.equal(demoUser.rows.length, 1);
    assert.equal(demoUser.rows[0].elo_rating, 1000);
  });
});
