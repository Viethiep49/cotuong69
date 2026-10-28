require('./helpers/testEnv');
/**
 * BE-09: trạng thái online phải được set khi kết nối WS (mời bạn bè mới hoạt động).
 * BE-10: ghế giữ qua HTTP phải tự giải phóng nếu không có socket kết nối.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../src/application/use-cases/auth/loginUser');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { OnlineUserManager } = require('../src/infrastructure/database/repositories/OnlineUserManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { createServer } = require('../src/server');

describe('BE-09/BE-10: online status và ghế giữ qua HTTP', () => {
  describe('BE-10: ghế tự giải phóng', () => {
    let roomManager;
    let host;
    let guest;

    before(() => {
      roomManager = new RoomManager();
      host = { id: 1, username: 'host', displayName: 'Host' };
      guest = { id: 2, username: 'guest', displayName: 'Guest' };
    });

    test('ghế BLACK được trả lại sau TTL nếu không có socket', async () => {
      const room = roomManager.createRoom({ hostUser: host, name: 'Phòng TTL', isPrivate: false });
      assert.equal(room.players.black, null);

      const result = roomManager.joinRoom(room.code, guest, { seatTtlMs: 1000 });
      assert.equal(result.role, 'PLAYER');
      assert.equal(result.side, 'BLACK');
      assert.ok(room.players.black, 'ghế phải được giữ ngay');

      await new Promise((resolve) => setTimeout(resolve, 1400));
      assert.equal(room.players.black, null, 'ghế phải được giải phóng khi không có socket');
    });

    test('confirmSeat huỷ hẹn giải phóng (người chơi đã vào bàn cờ)', async () => {
      const room = roomManager.createRoom({ hostUser: host, name: 'Phòng Confirm', isPrivate: false });
      roomManager.joinRoom(room.code, guest, { seatTtlMs: 1000 });

      assert.equal(roomManager.confirmSeat(room.code, guest.id), true);
      await new Promise((resolve) => setTimeout(resolve, 1400));
      assert.ok(room.players.black, 'ghế phải còn vì đã có socket');
    });
  });

  describe('BE-09: trạng thái online qua WS', () => {
    let server;
    let port;
    let hub;
    let onlineUsers;
    let room;
    let token;
    let userId;

    before(async () => {
      db.initSqlite(new DatabaseSync(':memory:'));
      await runMigrations();
      const userRepo = new PgUserRepository({ db });

      const user = await new RegisterUserUseCase({ userRepository: userRepo }).execute({
        username: 'be09_user', displayName: 'User BE09', email: 'be09@cotuong.vn', password: 'StrongPassword123',
      });
      userId = Number(user.id);
      token = (await new LoginUserUseCase({ userRepository: userRepo }).execute({
        username: 'be09_user', password: 'StrongPassword123',
      })).token;

      onlineUsers = new OnlineUserManager();
      const roomManager = new RoomManager();
      hub = new RoomHub({ roomManager, userRepository: userRepo, onlineUserManager: onlineUsers });
      room = roomManager.createRoom({ hostUser: user, name: 'Phòng BE09', isPrivate: false });

      server = createServer({ db, userRepository: userRepo, roomHub: hub, roomOptions: { roomManager } });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (hub && typeof hub.close === 'function') hub.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.closePool();
    });

    test('kết nối WS -> online IN_GAME; đóng WS -> offline', async () => {
      assert.equal(onlineUsers.isOnline(userId), false);

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room?token=${token}&roomCode=${room.code}`);
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal(onlineUsers.isOnline(userId), true);
      assert.equal(onlineUsers.getUserStatus(userId), 'IN_GAME');

      const closed = new Promise((resolve) => ws.on('close', resolve));
      ws.close();
      await closed;
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(onlineUsers.isOnline(userId), false, 'phải set offline khi socket đóng');
    });
  });
});
