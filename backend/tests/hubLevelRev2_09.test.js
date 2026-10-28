require('./helpers/testEnv');
/**
 * REV2-09: test cấp HUB (socket giả đi qua đúng handler `connection` / `close` / `message` của RoomHub,
 * không gọi trực tiếp Room hay handleDisconnectTimeout):
 *  - REV-01: Đỏ rớt, Đen rớt, Đỏ vào lại, hết hạn bộ đếm của Đỏ -> không ai bị xử thua, Đen hết hạn mới xử Đỏ thắng
 *  - REV-02: `start` trong lúc đang chốt ván trả MATCH_SETTLING
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, connect, send, sleep, playingRoom, RED, BLACK } = require('./helpers/hubHarness');

describe('REV2-09: hub-level', () => {
  test('REV-01 qua hub: Đỏ vào lại thì bộ đếm của Đỏ không xử thua; Đen hết hạn -> Đỏ thắng DISCONNECT_TIMEOUT', async () => {
    const { hub, roomManager } = makeHub({ countdown: 2 });
    const { room, r, b } = await playingRoom(hub, roomManager);

    r.close(); // t0: Đỏ rớt (cửa sổ tới t0+2.0)
    await sleep(400);
    b.close(); // t0+0.4: Đen rớt (cửa sổ tới t0+2.4)
    await sleep(400);
    assert.deepEqual(room.getDisconnectedSides().sort(), ['black', 'red']);

    const r2 = connect(hub, room, RED, 'red2'); // t0+0.8: Đỏ vào lại qua connection handler
    await sleep(20);
    assert.ok(r2.types().includes('reconnectState'), 'Đỏ phải được nhận diện là reconnect');
    assert.deepEqual(room.getDisconnectedSides(), ['black']);
    assert.equal(hub.disconnectTimers.has(`${room.code}:red`), false, 'timer của Đỏ phải bị huỷ khi vào lại');

    await sleep(1300); // t0+2.1: mốc cũ của Đỏ đã qua, Đen còn ~0.3s
    assert.equal(room.status, 'PLAYING');
    assert.equal(room.matchState.isPaused, true, 'ván vẫn tạm dừng chờ Đen');
    assert.equal(room.getParticipantRole(RED.id).side, 'RED');
    assert.equal(r2.types().includes('matchEnded'), false);
    assert.deepEqual(room.history || [], []);

    await sleep(600); // t0+2.7: cửa sổ của Đen hết
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'DISCONNECT_TIMEOUT');
    assert.equal(room.history[0].winner, 'red');
    assert.ok(r2.types().includes('matchEnded'));
    hub.close();
  });

  test('start trong lúc đang chốt ván trả MATCH_SETTLING (qua hub)', async () => {
    const { hub, roomManager } = makeHub({ eloDelayMs: 300 });
    const { room, r, b } = await playingRoom(hub, roomManager);

    send(b, { type: 'resign' }); // bắt đầu chốt, đang chờ Elo/DB
    await sleep(30);
    assert.equal(room.settling, true);

    send(r, { type: 'start' });
    await sleep(10);
    assert.equal(r.last('error').code, 'MATCH_SETTLING');
    assert.equal(room.status, 'WAITING_OPPONENT', 'không được bắt đầu ván mới');

    await sleep(700);
    assert.equal(room.settling, false);
    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'RESIGN');
    // sau khi chốt xong, start không còn bị chặn bởi MATCH_SETTLING (chỉ còn thiếu sẵn sàng)
    send(r, { type: 'start' });
    await sleep(10);
    assert.notEqual(r.last('error').code, 'MATCH_SETTLING');
    hub.close();
  });
});
