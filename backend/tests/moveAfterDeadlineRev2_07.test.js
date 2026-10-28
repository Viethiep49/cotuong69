require('./helpers/testEnv');
/**
 * REV2-07: nước đi đến SAU hạn đồng hồ (timer còn độ trễ ~50ms / chưa kịp chạy) không được
 * nhận; phải chốt TIMEOUT cho đối thủ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, send, sleep, playingRoom } = require('./helpers/hubHarness');

describe('REV2-07: từ chối nước đi sau hạn', () => {
  test('hết thời gian lượt: nước đi bị từ chối, Đen thắng TIMEOUT, bàn cờ không đổi', async () => {
    const { hub, roomManager } = makeHub();
    const { room, r } = await playingRoom(hub, roomManager);
    const before = JSON.stringify(room.matchState.board);
    room.matchState.turnStartedAt = Date.now() - 61 * 1000; // quá 60s, timer chưa kịp bắn

    send(r, { type: 'move', from: 'a3', to: 'a4' });
    await sleep(30);

    assert.equal(JSON.stringify(room.matchState.board), before, 'nước đi không được áp dụng');
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'TIMEOUT');
    assert.equal(room.history[0].winner, 'black');
    hub.close();
  });

  test('hết đồng hồ tổng của người đi: nước đi bị từ chối, đối thủ thắng TIMEOUT', async () => {
    const { hub, roomManager } = makeHub();
    const { room, r } = await playingRoom(hub, roomManager);
    room.matchState.remainingClocks.red = 0.4;
    room.matchState.turnStartedAt = Date.now() - 1000;

    send(r, { type: 'move', from: 'a3', to: 'a4' });
    await sleep(30);

    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'TIMEOUT');
    assert.equal(room.history[0].winner, 'black');
    hub.close();
  });

  test('nước đi trong hạn vẫn được nhận bình thường', async () => {
    const { hub, roomManager } = makeHub();
    const { room, r } = await playingRoom(hub, roomManager);
    send(r, { type: 'move', from: 'a3', to: 'a4' });
    await sleep(30);
    assert.equal((room.history || []).length, 0);
    assert.equal(room.matchState.currentTurn, 'black');
    hub.close();
  });
});
