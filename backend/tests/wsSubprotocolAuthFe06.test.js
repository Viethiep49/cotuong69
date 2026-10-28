require('./helpers/testEnv');
/**
 * FE-06: token WebSocket đi qua Sec-WebSocket-Protocol (không nằm trong query string);
 * server chọn subprotocol 'cotuong.v1' và không echo lại token.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub, extractWsToken } = require('../src/presentation/websocket/roomHub');
const tokenService = require('../src/application/services/tokenService');
const { createServer } = require('../src/server');

function fakeRequest({ url = '/ws/room/ABC', headers = {} } = {}) {
  return { request: { url, headers }, urlObj: new URL(url, 'http://localhost') };
}

describe('FE-06: extractWsToken', () => {
  test('lấy token từ Sec-WebSocket-Protocol', () => {
    const { request, urlObj } = fakeRequest({
      headers: { 'sec-websocket-protocol': 'cotuong.v1, access_token.abc.def.ghi' },
    });
    assert.equal(extractWsToken(request, urlObj), 'abc.def.ghi');
  });

  test('lấy token từ header Authorization khi không có subprotocol', () => {
    const { request, urlObj } = fakeRequest({ headers: { authorization: 'Bearer tok123' } });
    assert.equal(extractWsToken(request, urlObj), 'tok123');
  });

  test('query ?token= chỉ được chấp nhận ngoài production', () => {
    const { request, urlObj } = fakeRequest({ url: '/ws/room/ABC?token=querytoken' });
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      assert.equal(extractWsToken(request, urlObj), 'querytoken');
      process.env.NODE_ENV = 'production';
      assert.equal(extractWsToken(request, urlObj), null, 'production phải bỏ qua token trong query');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('subprotocol được ưu tiên hơn query', () => {
    const { request, urlObj } = fakeRequest({
      url: '/ws/room/ABC?token=querytoken',
      headers: { 'sec-websocket-protocol': 'cotuong.v1, access_token.protocoltoken' },
    });
    assert.equal(extractWsToken(request, urlObj), 'protocoltoken');
  });
});

describe('FE-06: WebSocket nhận token qua Sec-WebSocket-Protocol', () => {
  let roomManager;
  let roomHub;
  let server;
  let port;
  let user;
  let room;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    const userRepo = new PgUserRepository({ db });
    user = await userRepo.create({
      username: 'fe06_user', displayName: 'FE06', email: 'fe06@cotuong.vn', passwordHash: 'x', eloRating: 1200,
    });
    roomManager = new RoomManager({ sweepIntervalMs: 0 });
    roomHub = new RoomHub({ roomManager, userRepository: userRepo, enableHeartbeat: false });
    room = roomManager.createRoom({ hostUser: user, name: 'FE06', isPrivate: false });
    server = createServer({ db, userRepository: userRepo, roomHub, roomOptions: { roomManager } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    }));
  });

  after(async () => {
    roomHub.close();
    await new Promise((resolve) => server.close(resolve));
    await db.closePool();
  });

  function open(url, protocols) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, protocols);
      ws.on('open', () => resolve(ws));
      ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('unexpected'), { statusCode: res.statusCode })));
      ws.on('error', reject);
    });
  }

  test('token trong subprotocol -> vào phòng, server chọn cotuong.v1 và không echo token', async () => {
    const token = tokenService.generateAccessToken({ id: user.id, username: user.username, role: 'PLAYER' });
    const ws = await open(`ws://127.0.0.1:${port}/ws/room/${room.code}`, ['cotuong.v1', `access_token.${token}`]);
    try {
      assert.equal(ws.protocol, 'cotuong.v1');
      assert.equal(String(ws.protocol).includes(token), false);
    } finally {
      ws.close();
    }
  });

  test('token sai trong subprotocol -> 401', async () => {
    await assert.rejects(
      () => open(`ws://127.0.0.1:${port}/ws/room/${room.code}`, ['cotuong.v1', 'access_token.not-a-jwt']),
      (err) => err.statusCode === 401 || /401|socket hang up|Unexpected/i.test(err.message),
    );
  });

  test('WS trận demo cũng chọn cotuong.v1 khi client gửi subprotocol', async () => {
    const ws = await open(`ws://127.0.0.1:${port}/api/matches/COT-615/ws`, ['cotuong.v1', 'access_token.whatever']);
    try {
      assert.equal(ws.protocol, 'cotuong.v1');
    } finally {
      ws.close();
    }
  });
});
