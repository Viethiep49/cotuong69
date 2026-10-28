require('./helpers/testEnv');
/**
 * BE-06: hai người cùng rớt mạng — trạng thái reconnect phải tách theo từng bên,
 * không được ghi đè lên nhau; chỉ resume khi cả hai đã vào lại.
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

describe('BE-06: reconnect tách theo từng bên', () => {
  let userRepo;
  let roomManager;
  let hub;
  let red;
  let black;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    userRepo = new PgUserRepository({ db });
    roomManager = new RoomManager();
    hub = new RoomHub({ roomManager, userRepository: userRepo });

    red = await userRepo.create({
      username: 'rc_red', displayName: 'Đỏ', email: 'rc_red@cotuong.vn', passwordHash: 'x', eloRating: 1000,
    });
    black = await userRepo.create({
      username: 'rc_black', displayName: 'Đen', email: 'rc_black@cotuong.vn', passwordHash: 'x', eloRating: 1000,
    });
  });

  after(async () => {
    if (hub && typeof hub.close === 'function') hub.close();
    await db.closePool();
  });

  function makePlayingRoom() {
    const room = roomManager.createRoom({ hostUser: red, name: `RC ${Math.random()}`, isPrivate: false });
    room.addParticipant(red);
    room.addParticipant(black);
    room.setReady(red.id, true);
    room.setReady(black.id, true);
    room.startGame(red.id);
    return room;
  }

  test('Red rớt rồi Black rớt: giữ được CẢ HAI trạng thái', () => {
    const room = makePlayingRoom();

    const first = room.pauseMatchForDisconnect(red.id, 60);
    assert.ok(first);
    const second = room.pauseMatchForDisconnect(black.id, 60);
    assert.ok(second);

    assert.deepEqual(room.getDisconnectedSides().sort(), ['black', 'red']);
    assert.equal(Number(room.reconnectState.bySide.red.disconnectedUserId), Number(red.id));
    assert.equal(Number(room.reconnectState.bySide.black.disconnectedUserId), Number(black.id));
  });

  test('Black vào lại khi Red vẫn vắng: ván VẪN pause, không resume', () => {
    const room = makePlayingRoom();
    room.pauseMatchForDisconnect(red.id, 60);
    room.pauseMatchForDisconnect(black.id, 60);

    const resume = room.resumeMatchAfterReconnect(black.id);
    assert.ok(resume);
    assert.equal(resume.stillPaused, true, 'phải báo vẫn đang pause');
    assert.equal(room.matchState.isPaused, true);
    assert.deepEqual(room.getDisconnectedSides(), ['red']);
  });

  test('Cả hai vào lại: resume ván và xoá reconnectState', () => {
    const room = makePlayingRoom();
    room.pauseMatchForDisconnect(red.id, 60);
    room.pauseMatchForDisconnect(black.id, 60);

    room.resumeMatchAfterReconnect(black.id);
    const final = room.resumeMatchAfterReconnect(red.id);

    assert.equal(final.stillPaused, false);
    assert.equal(room.matchState.isPaused, false);
    assert.equal(room.reconnectState, null);
    assert.deepEqual(room.getDisconnectedSides(), []);
  });

  test('Timer disconnect tách theo bên: clear bên này không xoá bên kia', () => {
    const room = makePlayingRoom();

    hub.disconnectTimers.clear();
    hub.disconnectTimers.set(`${room.code}:red`, { interval: setInterval(() => {}, 10000), userId: red.id, side: 'RED' });
    hub.disconnectTimers.set(`${room.code}:black`, { interval: setInterval(() => {}, 10000), userId: black.id, side: 'BLACK' });

    hub.clearDisconnectTimer(room.code, 'RED');

    assert.equal(hub.disconnectTimers.has(`${room.code}:red`), false);
    assert.equal(hub.disconnectTimers.has(`${room.code}:black`), true, 'bộ đếm của Đen phải còn');

    hub.clearDisconnectTimer(room.code);
    assert.equal(hub.disconnectTimers.size, 0);
  });

  test('settleMatch xoá mọi timer disconnect của phòng', async () => {
    const room = makePlayingRoom();
    hub.broadcastToRoom = () => {};

    hub.disconnectTimers.set(`${room.code}:red`, { interval: setInterval(() => {}, 10000), userId: red.id, side: 'RED' });
    hub.disconnectTimers.set(`${room.code}:black`, { interval: setInterval(() => {}, 10000), userId: black.id, side: 'BLACK' });

    await hub.settleMatch(room, 'red', 'CHECKMATE');

    assert.equal(hub.disconnectTimers.has(`${room.code}:red`), false);
    assert.equal(hub.disconnectTimers.has(`${room.code}:black`), false);
  });
});
