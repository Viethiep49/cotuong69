require('./helpers/testEnv');
/**
 * REV-11: đồng hồ tổng được thực thi; thời gian đã dùng trước khi rớt mạng bị trừ
 * và lượt không bị reset về đầy khi kết nối lại.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');

const host = { id: 11, username: 'rev11_host', displayName: 'Host' };
const opponent = { id: 12, username: 'rev11_opp', displayName: 'Opp' };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('REV-11: đồng hồ tổng và tạm dừng do rớt mạng', () => {
  let hub;
  afterEach(() => {
    if (hub) hub.close();
    hub = null;
  });

  function setup(matchOptions) {
    const roomManager = new RoomManager({ sweepIntervalMs: 0 });
    const settled = [];
    hub = new RoomHub({
      roomManager,
      enableHeartbeat: false,
      pvpMatchRepository: { create: async (record) => { settled.push(record); return 1; } },
    });
    hub.applyEloForResult = async () => ({
      winner: { change: 0, newRating: 1000 },
      loser: { change: 0, newRating: 1000 },
    });
    hub.broadcastToRoom = () => {};
    const room = roomManager.createRoom({ hostUser: host, name: 'Phong clock' });
    room.addParticipant(host);
    room.addParticipant(opponent);
    room.setReady(host.id, true);
    room.setReady(opponent.id, true);
    room.startGame(host.id, matchOptions);
    return { room, settled };
  }

  test('đồng hồ tổng cạn trước lượt 60s -> xử thua TIMEOUT đúng lúc', async () => {
    // Đỏ chỉ còn 0.2s tổng nhưng lượt còn 60s: trước đây timer hẹn 60s
    const { room, settled } = setup({ remainingClocks: { red: 0.2, black: 300 } });
    hub.armTurnTimer(room);

    await wait(500);

    assert.equal(settled.length, 1, 'phải xử thua khi đồng hồ tổng hết');
    assert.equal(settled[0].endReason, 'TIMEOUT');
    assert.equal(settled[0].winner, 'black');
  });

  test('pause trừ ngay thời gian đã dùng vào đồng hồ tổng và giữ phần còn lại của lượt', () => {
    const { room } = setup({ remainingClocks: { red: 100, black: 300 } });
    room.matchState.turnStartedAt = Date.now() - 10000; // đỏ đã nghĩ 10s

    room.pauseMatchForDisconnect(host.id, 60);

    const clocks = room.matchState.remainingClocks;
    assert.ok(Math.abs(clocks.red - 90) < 0.5, `đồng hồ đỏ phải ~90s, có ${clocks.red}`);
    assert.equal(clocks.black, 300);
    assert.ok(Math.abs(room.matchState.turnRemainingSeconds - 50) < 0.5, 'lượt còn ~50s');

    // Người thứ hai cũng rớt: không trừ lần nữa
    room.pauseMatchForDisconnect(opponent.id, 60);
    assert.ok(Math.abs(room.matchState.remainingClocks.red - 90) < 0.5, 'không trừ hai lần');

    // Kết nối lại: lượt KHÔNG reset về 60s
    room.resumeMatchAfterReconnect(host.id);
    room.resumeMatchAfterReconnect(opponent.id);
    assert.equal(room.matchState.isPaused, false);
    assert.ok(room.getRemainingTurnSeconds() <= 51, `lượt phải còn ~50s, có ${room.getRemainingTurnSeconds()}`);
  });

  test('thời gian dùng trước khi rớt mạng được tính: vào lại thì hết đồng hồ tổng đúng hạn', async () => {
    const { room, settled } = setup({ remainingClocks: { red: 10.2, black: 300 } });
    room.matchState.turnStartedAt = Date.now() - 10000; // đỏ đã dùng 10s, tổng còn ~0.2s

    room.pauseMatchForDisconnect(host.id, 60);
    hub.clearTurnTimer(room.code);
    room.resumeMatchAfterReconnect(host.id);
    hub.armTurnTimer(room);

    await wait(600);

    assert.equal(settled.length, 1, 'đồng hồ tổng phải hết sau khi vào lại');
    assert.equal(settled[0].endReason, 'TIMEOUT');
    assert.equal(settled[0].winner, 'black');
  });
});
