// Chạy trong tiến trình con với biến môi trường TZ khác nhau (xem tests/revocationTimezoneRev2_20.test.js).
// Luồng THẬT: tạo user -> updatePassword (ghi password_changed_at = CURRENT_TIMESTAMP) -> kiểm tra token cũ / mới.
process.env.DB_CLIENT = 'sqlite';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef0123456789abcdef';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SRC = path.resolve(__dirname, '../../src');
const db = require(path.join(SRC, 'config/db'));
const { runMigrations } = require(path.join(SRC, 'migrations/migrate'));
const PgUserRepository = require(path.join(SRC, 'infrastructure/database/repositories/PgUserRepository'));
const { ensureSessionActive } = require(path.join(SRC, 'presentation/http/middlewares/authMiddleware'));

(async () => {
  const log = console.log;
  console.log = () => {};
  db.initSqlite(new DatabaseSync(':memory:'));
  await runMigrations();
  console.log = log;

  const repo = new PgUserRepository({ db });
  const user = await repo.create({ username: 'tzuser', displayName: 'TZ', email: 'tz@x.io', passwordHash: 'h' });
  const nowSec = Math.floor(Date.now() / 1000);
  const oldIat = nowSec - 600; // token phát hành 10 phút trước khi đổi mật khẩu
  await repo.updatePassword(user.id, 'h2');

  const result = { tz: process.env.TZ, old: null, fresh: null };
  try {
    await ensureSessionActive({ id: user.id, iat: oldIat }, repo);
    result.old = 'ACCEPTED';
  } catch (err) {
    result.old = err.code;
  }
  try {
    await ensureSessionActive({ id: user.id, iat: nowSec + 2 }, repo);
    result.fresh = 'ACCEPTED';
  } catch (err) {
    result.fresh = err.code;
  }
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
  await db.closePool();
})().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
