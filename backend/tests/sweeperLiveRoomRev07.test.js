require('./helpers/testEnv');
/**
 * REV-07: sweeper không xoá phòng còn socket đang mở; phòng SYSTEM_ERROR
 * được dọn (settleMatch + trả ghế).
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');

const host = { id: 1, username: 'rev07_host', displayName: 'Host' };
const opponent = { id: 2, username: 'rev07_opp', displayName: 'Opp' };

describe('REV-07: sweeper và phòng SYSTEM_ERROR', () => {
  let hub;
  afterEach(() => {
    if (hub) hub.close();
    hub = null;
  });

  test('phòng quá hạn nhưng còn socket mở thì sweeper KHÔNG xoá', () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, enableHeartbeat: false, pvpMatchRepository: { create: async () => 1 } });
    const room = roomManager.createRoom({ hostUser: host, name: 'Cho doi thu' });
    room.addParticipant(host);

    const stale = Date.now() + 31 * 60 * 1000;
    room.lastActivityAt = new Date(Date.now() - 1000);

    // Có socket đang mở trong phòng
    hub.roomGroups.set(room.code, new Set([{ readyState: 1 }]));
    assert.equal(roomManager.sweep(stale), 0, 'phòng còn người kết nối không được dọn');
    assert.ok(roomManager.rooms.has(room.code));

    // Không còn socket -> bị dọn như cũ
    hub.roomGroups.delete(room.code);
    assert.equal(roomManager.sweep(stale), 1);
    assert.ok(!roomManager.rooms.has(room.code));
  });

  test('mỗi message WS làm mới lastActivityAt của phòng', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    hub = new RoomHub({ roomManager, enableHeartbeat: false, pvpMatchRepository: { create: async () => 1 } });
    const room = roomManager.createRoom({ hostUser: host, name: 'Phong A' });
    room.addParticipant(host);
    room.lastActivityAt = new Date(Date.now() - 40 * 60 * 1000);

    const socket = { readyState: 1, send() {}, close() {} };
    hub.clients.set(socket, { userId: host.id, roomCode: room.code, user: host, lastSeen: 0, lastPong: 0 });
    await hub.handleMessage(socket, Buffer.from(JSON.stringify({ type: 'pong' })));

    assert.ok(Date.now() - new Date(room.lastActivityAt).getTime() < 5000, 'lastActivityAt phải được làm mới');
  });

  test('cả hai cùng rớt mạng: SYSTEM_ERROR đi qua settleMatch, trả ghế và phòng được dọn', async () => {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const created = [];
    hub = new RoomHub({
      roomManager,
      enableHeartbeat: false,
      pvpMatchRepository: { create: async (record) => { created.push(record); return 1; } },
    });
    const room = roomManager.createRoom({ hostUser: host, name: 'Phong B' });
    room.addParticipant(host);
    room.addParticipant(opponent);
    room.setReady(host.id, true);
    room.setReady(opponent.id, true);
    room.startGame(host.id);

    const messages = [];
    hub.broadcastToRoom = (code, message) => messages.push(message);

    await hub.handleDisconnectTimeout(room, host.id, 'RED');

    assert.equal(messages[0].type, 'matchEnded');
    assert.equal(messages[0].reason, 'SYSTEM_ERROR');
    assert.equal(created.length, 1, 'phải ghi kết quả huỷ ván vào pvp_matches');
    assert.equal(created[0].endReason, 'SYSTEM_ERROR');
    assert.equal(room.history.length, 1);
    assert.equal(room.players.red, null, 'ghế Đỏ phải được trả');
    assert.equal(room.players.black, null, 'ghế Đen phải được trả');

    // REV2-04: phòng không còn ai bị đóng ngay (không cần chờ sweeper) -> sweeper không còn gì để dọn
    assert.equal(roomManager.findByCode(room.code), null, 'phòng trống phải được đóng');
    assert.equal(roomManager.sweep(Date.now() + 31 * 60 * 1000), 0);
  });
});
