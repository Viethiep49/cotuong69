require('./helpers/testEnv');
/**
 * REV-05: WS phải kiểm tra phiên trong DB — token đã bị thu hồi sau khi đổi mật
 * khẩu, hoặc tài khoản bị khoá, không được vào phòng.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const tokenService = require('../src/application/services/tokenService');
const { ensureSessionActive } = require('../src/presentation/http/middlewares/authMiddleware');

function fakeSocket() {
  return {
    destroyed: false,
    written: [],
    write(chunk) { this.written.push(String(chunk)); },
    destroy() { this.destroyed = true; },
    on() {},
    setTimeout() {},
  };
}

describe('REV-05: WS kiểm tra phiên', () => {
  let userRepo;
  let hub;
  let roomManager;
  let user;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, userRepository: userRepo, tokenService });

    user = await userRepo.create({
      username: 'rev05_user', displayName: 'REV05', email: 'rev05@cotuong.vn', passwordHash: 'x', eloRating: 1200,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  async function upgradeWith(token) {
    const room = roomManager.createRoom({
      hostUser: user, name: `REV05 ${Math.random()}`, isPrivate: false,
    });
    const socket = fakeSocket();
    await hub.handleUpgrade(
      { url: `/ws/room/${room.code}?token=${token}`, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      socket,
      Buffer.alloc(0),
    );
    return socket;
  }

  test('token hợp lệ vào phòng bình thường', async () => {
    const token = tokenService.generateAccessToken({ id: user.id, username: user.username, role: 'PLAYER' });
    hub.wss = { handleUpgrade: (_req, _sock, _head, cb) => cb({ on() {}, send() {}, close() {} }), emit() {} };

    const socket = await upgradeWith(token);
    assert.equal(socket.destroyed, false);
    assert.equal(socket.written.some((w) => w.includes('401') || w.includes('403')), false);
  });

  test('token phát hành TRƯỚC lần đổi mật khẩu -> WS trả 401', async () => {
    const token = tokenService.generateAccessToken({ id: user.id, username: user.username, role: 'PLAYER' });
    // Mô phỏng đổi mật khẩu SAU khi token được phát hành
    const changedAt = new Date(Date.now() + 5000).toISOString();
    await db.query('UPDATE users SET password_changed_at = $1 WHERE id = $2', [changedAt, user.id]);

    const socket = await upgradeWith(token);
    assert.equal(socket.destroyed, true, 'socket phải bị đóng');
    assert.equal(socket.written[0].includes('401'), true, `phải trả 401, nhận: ${socket.written[0]}`);

    await db.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', [user.id]);
  });

  test('tài khoản bị khoá -> WS trả 403', async () => {
    const token = tokenService.generateAccessToken({ id: user.id, username: user.username, role: 'PLAYER' });
    await db.query("UPDATE users SET status = 'LOCKED' WHERE id = $1", [user.id]);

    const socket = await upgradeWith(token);
    assert.equal(socket.destroyed, true);
    assert.equal(socket.written[0].includes('403'), true, `phải trả 403, nhận: ${socket.written[0]}`);

    await db.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [user.id]);
  });

  test('tài khoản không tồn tại -> 401', async () => {
    const token = tokenService.generateAccessToken({ id: 999999, username: 'ghost', role: 'PLAYER' });
    const socket = await upgradeWith(token);
    assert.equal(socket.destroyed, true);
    assert.equal(socket.written[0].includes('401'), true);
  });

  test('ensureSessionActive: iat < password_changed_at -> TOKEN_REVOKED', async () => {
    const decoded = { id: user.id, iat: Math.floor(Date.now() / 1000) - 60 };
    await db.query('UPDATE users SET password_changed_at = $1 WHERE id = $2', [new Date().toISOString(), user.id]);

    await assert.rejects(
      () => ensureSessionActive(decoded, userRepo),
      (err) => err.code === 'TOKEN_REVOKED' && err.statusCode === 401,
    );

    await db.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', [user.id]);
    const ok = await ensureSessionActive(decoded, userRepo);
    assert.equal(ok.id, user.id);
  });

  test('authMiddleware không còn ReferenceError khi không truyền repository', async () => {
    const { authenticateRequestWithSession } = require('../src/presentation/http/middlewares/authMiddleware');
    const token = tokenService.generateAccessToken({ id: user.id, username: user.username, role: 'PLAYER' });
    // Không truyền userRepository -> phải tự tạo PgUserRepository (trước đây thiếu require -> ReferenceError)
    const decoded = await authenticateRequestWithSession({ headers: { authorization: `Bearer ${token}` } });
    assert.equal(Number(decoded.id), Number(user.id), 'phải trả payload token, không ném ReferenceError');
  });
});
