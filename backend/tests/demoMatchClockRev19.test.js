require('./helpers/testEnv');
/**
 * REV-19: trận demo COT-615 — đồng hồ chỉ chạy khi cả Đỏ và Đen đã kết nối,
 * ván kết thúc tự reset sau 10 giây, đồng hồ cấu hình qua DEMO_CLOCK_SECONDS.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const {
  createCot615Match,
  startCot615Match,
  getPublicMatchState,
  applyMatchMove,
} = require('../src/domain/entities/cot615Match');
const { createServer } = require('../src/server');

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/matches/COT-615/ws`);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'welcome') {
        socket.off('message', onMessage);
        resolve({ socket, welcome: message });
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
  });
}

describe('REV-19: domain', () => {
  test('trận chờ người chơi: qua thời gian rất lâu vẫn chưa ai thua, đồng hồ đầy', () => {
    const t0 = 1_000_000;
    const match = createCot615Match(t0, { waitForPlayers: true, clockSeconds: 600 });
    const state = getPublicMatchState(match, t0 + 3_600_000);
    assert.equal(state.winner, null);
    assert.notEqual(state.status, 'completed');
    assert.equal(state.waitingForPlayers, true);
    assert.equal(state.countdownSeconds, null);
    assert.equal(state.clocks.red, 600);
    assert.equal(state.clocks.black, 600);
    assert.equal(state.timeControlSeconds, 600);
  });

  test('trận chờ người chơi không nhận nước đi', () => {
    const t0 = 5_000;
    const match = createCot615Match(t0, { waitForPlayers: true });
    const res = applyMatchMove(match, 'red', 'e3', 'e4', t0 + 60_000);
    assert.equal(res.accepted, false);
  });

  test('startCot615Match đặt đếm ngược 3 giây rồi đồng hồ Đỏ mới chạy', () => {
    const t0 = 10_000;
    const match = createCot615Match(t0, { waitForPlayers: true, clockSeconds: 100 });
    assert.equal(startCot615Match(match, t0 + 50_000), true);
    assert.equal(startCot615Match(match, t0 + 60_000), false, 'chỉ bắt đầu một lần');
    let state = getPublicMatchState(match, t0 + 51_000);
    assert.equal(state.status, 'starting');
    assert.equal(state.countdownSeconds, 2);
    assert.equal(state.clocks.red, 100);
    state = getPublicMatchState(match, t0 + 53_000 + 10_000);
    assert.equal(state.status, 'active');
    assert.equal(state.clocks.red, 90);
  });
});

describe('REV-19: server (ENABLE_DEMO_MATCH=true)', () => {
  let server;
  let port;
  let clock = 1_700_000_000_000;
  const sockets = [];
  const backup = { demo: process.env.ENABLE_DEMO_MATCH, clock: process.env.DEMO_CLOCK_SECONDS };

  before(async () => {
    process.env.ENABLE_DEMO_MATCH = 'true';
    process.env.DEMO_CLOCK_SECONDS = '120';
    server = createServer({ now: () => clock });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    for (const s of sockets) s.terminate();
    await new Promise((resolve) => server.close(resolve));
    if (backup.demo === undefined) delete process.env.ENABLE_DEMO_MATCH; else process.env.ENABLE_DEMO_MATCH = backup.demo;
    if (backup.clock === undefined) delete process.env.DEMO_CLOCK_SECONDS; else process.env.DEMO_CLOCK_SECONDS = backup.clock;
  });

  test('chưa ai kết nối: chờ quá đồng hồ vẫn chưa ai thua; đủ 2 người mới đếm ngược', async () => {
    let state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.timeControlSeconds, 120);
    assert.equal(state.waitingForPlayers, true);

    clock += 10 * 60 * 1000; // quá xa đồng hồ 120s
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.winner, null, 'chưa đủ người thì không ai thua do hết giờ');
    assert.notEqual(state.status, 'completed');
    assert.equal(state.clocks.red, 120);

    // Chỉ một người (Đỏ) kết nối: vẫn chờ
    const red = await connect(port);
    sockets.push(red.socket);
    assert.equal(red.welcome.color, 'red');
    clock += 10 * 60 * 1000;
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.winner, null);
    assert.equal(state.waitingForPlayers, true);

    // Người thứ hai vào -> bắt đầu đếm ngược
    const black = await connect(port);
    sockets.push(black.socket);
    assert.equal(black.welcome.color, 'black');
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.waitingForPlayers, false);
    assert.equal(state.status, 'starting');
    assert.equal(state.countdownSeconds, 3);

    // Hết giờ Đỏ sau 3s đếm ngược + 120s
    clock += 3000 + 121 * 1000;
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.status, 'completed');
    assert.equal(state.winner, 'black');

    // Chưa đủ 10 giây: vẫn là ván cũ
    clock += 5000;
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.status, 'completed');

    // Quá 10 giây: tự mở ván mới, 2 người vẫn đang kết nối nên đếm ngược luôn
    clock += 6000;
    state = await getJson(port, '/api/matches/COT-615');
    assert.equal(state.winner, null);
    assert.equal(state.status, 'starting');
    assert.equal(state.clocks.red, 120);
  });
});
