require('./helpers/testEnv');
/**
 * REV2-02: cả hai cùng rớt mạng. Khi cửa sổ reconnect của bên đầu hết mà bên kia
 * vẫn còn trong cửa sổ của mình thì PHẢI chờ (không SYSTEM_ERROR ngay):
 *  - bên kia quay lại kịp -> bên kia thắng DISCONNECT_TIMEOUT
 *  - bên kia cũng hết hạn -> SYSTEM_ERROR
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, connect, sleep, playingRoom, RED, BLACK } = require('./helpers/hubHarness');

describe('REV2-02: cả hai rớt mạng, cửa sổ lệch nhau', () => {
  test('Đỏ hết hạn nhưng Đen còn hạn: chưa huỷ ván; Đen quay lại -> Đen thắng DISCONNECT_TIMEOUT', async () => {
    const { hub, roomManager } = makeHub({ countdown: 2 });
    const { room, r, b } = await playingRoom(hub, roomManager);
    r.close();
    await sleep(800);
    b.close();
    await sleep(1500); // t ~ 2.3s: cửa sổ Đỏ (2s) hết, cửa sổ Đen (đến ~2.8s) còn

    assert.equal(room.status, 'PLAYING', 'chưa được chốt SYSTEM_ERROR khi Đen còn trong cửa sổ');
    assert.deepEqual(room.history || [], []);
    assert.ok(room.players.black, 'ghế Đen còn giữ');

    const b2 = connect(hub, room, BLACK, 'black2');
    await sleep(30);

    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'DISCONNECT_TIMEOUT');
    assert.equal(room.history[0].winner, 'black');
    assert.ok(b2.types().includes('matchEnded'));
    hub.close();
  });

  test('cả hai cùng hết cửa sổ -> SYSTEM_ERROR', async () => {
    const { hub, roomManager } = makeHub({ countdown: 1 });
    const { room, r, b } = await playingRoom(hub, roomManager);
    r.close();
    await sleep(300);
    b.close();
    await sleep(2000);

    assert.equal(room.history.length, 1);
    assert.equal(room.history[0].endReason, 'SYSTEM_ERROR');
    assert.equal(room.history[0].winner, null);
    hub.close();
  });
});
