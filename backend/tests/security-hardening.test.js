require('./helpers/testEnv.js');
/**
 * SEC-03: Server không được sập khi nhận input xấu (6 vector a-f trong
 * docs/CODE_REVIEW_FIX_PLAN.md).
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
const RegisterUserUseCase = require('../src/application/useCases/registerUser');
const LoginUserUseCase = require('../src/application/useCases/loginUser');
const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
const { RoomHub } = require('../src/presentation/websocket/roomHub');
const { createServer } = require('../src/server');
const { safeDecode } = require('../src/core/safeDecode');
const Room = require('../src/domain/entities/Room');
const { applyMatchMove, createCot615Match } = require('../src/domain/entities/cot615Match');

describe('SEC-03: chống crash khi nhận input xấu', () => {
  let server;
  let serverPort;
  let roomHub;
  let roomManager;
  let hostUser;
  let hostToken;
  let room;

  before(async () => {
    const memDb = new DatabaseSync(':memory:');
    db.initSqlite(memDb);
    await runMigrations();

    const userRepo = new PgUserRepository({ db });
    const registerUseCase = new RegisterUserUseCase({ userRepository: userRepo });
    const loginUseCase = new LoginUserUseCase({ userRepository: userRepo });

    hostUser = await registerUseCase.execute({
      username: 'sec03_host',
      displayName: 'Chủ Phòng SEC03',
      email: 'sec03_host@cotuong.vn',
      password: 'StrongPassword123',
    });
    hostToken = (await loginUseCase.execute({ username: 'sec03_host', password: 'StrongPassword123' })).token;

    roomManager = new RoomManager();
    roomHub = new RoomHub({ roomManager });
    room = roomManager.createRoom({ hostUser, name: 'Phòng SEC-03', isPrivate: false });

    server = createServer({
      db,
      userRepository: userRepo,
      roomHub,
      roomOptions: { roomManager },
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    roomHub.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  });

  function request(method, path) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: serverPort, method, path },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let body = null;
            try {
              body = JSON.parse(data);
            } catch {
              body = data;
            }
            resolve({ statusCode: res.statusCode, body, headers: res.headers });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  async function assertServerAlive() {
    const res = await request('GET', '/api/rooms');
    assert.equal(res.statusCode, 200, 'server phải còn sống và phục vụ được request sau input xấu');
  }

  test('safeDecode trả null thay vì throw với URI hỏng', () => {
    assert.equal(safeDecode('%E0'), null);
    assert.equal(safeDecode('%'), null);
    assert.equal(safeDecode(undefined), null);
    assert.equal(safeDecode('abc123'), 'abc123');
  });

  // (a) HTTP route với %-escape hỏng
  test('(a) GET /api/rooms/%E0 trả 400 và server vẫn sống', async () => {
    const res = await request('GET', '/api/rooms/%E0');
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVALID_ROOM_CODE');
    await assertServerAlive();
  });

  // (b) WS upgrade với %-escape hỏng
  test('(b) WS upgrade /ws/room/%E0 bị đóng, server vẫn sống', async () => {
    const closed = await new Promise((resolve) => {
      const socket = net.connect(serverPort, '127.0.0.1', () => {
        socket.write(
          'GET /ws/room/%E0 HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${serverPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('close', () => resolve(true));
      socket.on('error', () => resolve(true));
    });

    assert.equal(closed, true, 'socket phải bị đóng');
    await assertServerAlive();
  });

  // (c) WS frame sai (không mask) → server không được chết
  test('(c) WS frame không mask không làm sập server', async () => {
    const roomC = roomManager.createRoom({ hostUser, name: 'Phòng SEC-03 (c)', isPrivate: false });
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/room?token=${hostToken}&roomCode=${roomC.code}`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Frame text "hi" nhưng KHÔNG mask (client hợp lệ bắt buộc phải mask)
    ws._socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(roomHub.clients.size >= 0, true);
    await assertServerAlive();
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  });

  // (d) WS payload JSON "null"
  test('(d) WS payload JSON null trả INVALID_PAYLOAD, socket vẫn mở', async () => {
    const roomD = roomManager.createRoom({ hostUser, name: 'Phòng SEC-03 (d)', isPrivate: false });
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/room?token=${hostToken}&roomCode=${roomD.code}`);
    const messages = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        /* ignore */
      }
    });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send('null');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const err = messages.find((m) => m.code === 'INVALID_PAYLOAD');
    assert.ok(err, `phải nhận INVALID_PAYLOAD, nhận được: ${JSON.stringify(messages)}`);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
    await assertServerAlive();
  });

  // (e) Toạ độ IN HOA trước đây crash / để lại 2 quân cùng ô
  test('(e) nước đi toạ độ in hoa bị từ chối (Room + cot615Match)', () => {
    const roomInstance = new Room({
      code: '999999',
      name: 'Phòng test',
      hostId: hostUser.id,
      hostUser,
    });
    const opponentUser = { id: hostUser.id + 1, username: 'opp', displayName: 'Opp' };
    roomInstance.addParticipant(hostUser);
    roomInstance.addParticipant(opponentUser);
    roomInstance.setReady(hostUser.id, true);
    roomInstance.setReady(opponentUser.id, true);
    roomInstance.startGame(hostUser.id);

    const result = roomInstance.applyMove('red', 'B2', 'E2');
    assert.equal(result.accepted, false);

    const match = createCot615Match(Date.now());
    match.startsAt = new Date(Date.now() - 1000).toISOString();
    const upper = applyMatchMove(match, 'red', 'B2', 'E2', Date.now());
    assert.equal(upper.accepted, false);

    const badType = applyMatchMove(match, 'red', undefined, { a: 1 }, Date.now());
    assert.equal(badType.accepted, false);

    // Bàn cờ vẫn còn đủ 32 quân
    assert.equal(match.board.length, 32);
  });

  // (f) /uploads/ phục vụ thư mục hoặc path traversal
  test('(f) /uploads/ chặn thư mục và path traversal', async () => {
    const dir = await request('GET', '/uploads/avatars');
    assert.equal(dir.statusCode, 404);

    const traversal = await request('GET', '/uploads/..%2F..%2Fsrc%2Fserver.js');
    assert.ok([403, 404].includes(traversal.statusCode), `nhận ${traversal.statusCode}`);

    const missing = await request('GET', '/uploads/khong-ton-tai.png');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['x-content-type-options'], 'nosniff');

    await assertServerAlive();
  });
});
