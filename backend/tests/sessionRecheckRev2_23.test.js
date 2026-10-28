require('./helpers/testEnv');
/**
 * REV2-23: socket WS đang mở phải bị đóng khi tài khoản bị khoá hoặc mật khẩu bị đổi
 * (trước đây phiên chỉ được kiểm tra lúc upgrade).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { makeHub, connect, send, sleep, RED, BLACK } = require('./helpers/hubHarness');

function makeRepo(users) {
  return {
    users,
    calls: 0,
    async findById(id) {
      this.calls += 1;
      return this.users.get(Number(id)) || null;
    },
    async addEloPair() {},
  };
}

describe('REV2-23: kiểm tra lại phiên của socket đang mở', () => {
  test('tài khoản bị khoá: socket bị đóng 1008, người chơi rời phòng', async () => {
    const repo = makeRepo(new Map([
      [RED.id, { id: RED.id, status: 'ACTIVE' }],
      [BLACK.id, { id: BLACK.id, status: 'ACTIVE' }],
    ]));
    const { hub, roomManager } = makeHub({ userRepository: repo, sessionRecheckMs: 1000 });
    const room = roomManager.createRoom({ hostUser: RED, name: 'x' });
    const r = connect(hub, room, { ...RED, iat: Math.floor(Date.now() / 1000) }, 'red');
    const b = connect(hub, room, { ...BLACK, iat: Math.floor(Date.now() / 1000) }, 'black');
    await sleep(5);

    assert.equal(await hub.recheckSessions(Date.now()), 0, 'phiên còn hợp lệ -> không đóng gì');
    assert.equal(r.readyState, 1);

    repo.users.get(BLACK.id).status = 'BANNED';
    assert.equal(await hub.recheckSessions(Date.now() + 5000), 1);
    await sleep(5);

    assert.equal(b.readyState, 3);
    assert.equal(b.closeCode, 1008);
    assert.equal(r.readyState, 1, 'người khác không bị ảnh hưởng');
    assert.equal(hub.clients.has(b), false);
    assert.equal(room.getParticipantRole(BLACK.id), null);
    assert.ok(r.types().includes('UserLeft'));
    hub.close();
  });

  test('đổi mật khẩu sau khi token phát hành: socket dùng token cũ bị đóng, socket token mới giữ nguyên', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const repo = makeRepo(new Map([[RED.id, { id: RED.id, status: 'ACTIVE', passwordChangedAt: null }]]));
    const { hub, roomManager } = makeHub({ userRepository: repo, sessionRecheckMs: 1000 });
    const room = roomManager.createRoom({ hostUser: RED, name: 'x' });
    const oldTab = connect(hub, room, { ...RED, iat: nowSec - 600 }, 'old');
    const newTab = connect(hub, room, { ...RED, iat: nowSec + 5 }, 'new');
    await sleep(5);

    repo.users.get(RED.id).passwordChangedAt = new Date((nowSec - 60) * 1000);
    assert.equal(await hub.recheckSessions(Date.now() + 5000), 1);
    await sleep(5);

    assert.equal(oldTab.readyState, 3);
    assert.equal(oldTab.closeCode, 1008);
    assert.equal(newTab.readyState, 1, 'token phát hành sau khi đổi mật khẩu vẫn hợp lệ');
    hub.close();
  });

  test('lỗi tạm thời của DB không đóng socket; không kiểm tra lại quá dày', async () => {
    const repo = makeRepo(new Map([[RED.id, { id: RED.id, status: 'ACTIVE' }]]));
    const { hub, roomManager } = makeHub({ userRepository: repo, sessionRecheckMs: 30000 });
    const room = roomManager.createRoom({ hostUser: RED, name: 'x' });
    const r = connect(hub, room, { ...RED }, 'red');
    await sleep(5);
    const t0 = Date.now();

    await hub.recheckSessions(t0);
    await hub.recheckSessions(t0 + 1000);
    assert.equal(repo.calls, 1, 'trong cùng chu kỳ chỉ kiểm tra một lần');

    repo.findById = async () => { throw new Error('DB tạm thời lỗi'); };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(await hub.recheckSessions(t0 + 60000), 0);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(r.readyState, 1);
    hub.close();
  });

  test('heartbeat gọi kiểm tra lại phiên (tích hợp)', async () => {
    const repo = makeRepo(new Map([[RED.id, { id: RED.id, status: 'ACTIVE' }]]));
    const { hub, roomManager } = makeHub({ userRepository: repo, sessionRecheckMs: 0 });
    const room = roomManager.createRoom({ hostUser: RED, name: 'x' });
    const r = connect(hub, room, { ...RED }, 'red');
    send(r, { type: 'pong' });
    await sleep(5);
    repo.users.get(RED.id).status = 'BANNED';

    hub.checkHeartbeats();
    await sleep(30);
    assert.equal(r.readyState, 3);
    assert.equal(r.closeCode, 1008);
    hub.close();
  });
});
