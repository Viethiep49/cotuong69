require('./helpers/testEnv');
/**
 * FE-05: chat thật. Relay chat:send trên WS trận demo COT-615 (tới mọi người trong trận, kể cả
 * khán giả; BE-07: <= 500 ký tự, 5 tin / 3 giây) và roomHub echo `clientId` làm ack "đã gửi".
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket } = require('ws');

const { createServer } = require('../src/server');
const { DemoChatRelay, isChatMessageType } = require('../src/presentation/websocket/demoChatRelay');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(inbox, predicate, timeout = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = inbox.find(predicate);
    if (found) return found;
    await sleep(5);
  }
  throw new Error(`hết thời gian chờ, inbox=${JSON.stringify(inbox)}`);
}

describe('FE-05: DemoChatRelay (đơn vị)', () => {
  function makeRelay(extra = {}) {
    const sent = [];
    const clients = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const relay = new DemoChatRelay({
      listClients: () => clients,
      send: (client, message) => sent.push({ client, message }),
      ...extra,
    });
    return { relay, sent, clients };
  }

  test('nhận diện kiểu thông điệp chat', () => {
    assert.equal(isChatMessageType('chat:send'), true);
    assert.equal(isChatMessageType('chat'), true);
    assert.equal(isChatMessageType('move'), false);
    assert.equal(isChatMessageType(undefined), false);
  });

  test('phát cho MỌI socket, tên người gửi lấy từ phe, không tin tên client gửi', () => {
    const { relay, sent, clients } = makeRelay();
    relay.handle(clients[0], 'red', { type: 'chat:send', text: '  chào  ', senderName: 'Hacker', clientId: 'c1' });
    assert.equal(sent.length, 3);
    const message = sent[0].message;
    assert.equal(message.type, 'ChatMessage');
    assert.equal(message.text, 'chào');
    assert.equal(message.senderName, 'Đỏ');
    assert.equal(message.side, 'RED');
    assert.equal(message.clientId, 'c1');

    sent.length = 0;
    relay.handle(clients[1], 'black', { type: 'chat:send', text: 'x' });
    assert.equal(sent[0].message.senderName, 'Đen');
    assert.equal('clientId' in sent[0].message, false);

    sent.length = 0;
    relay.handle(clients[2], null, { type: 'chat:send', text: 'x' });
    assert.equal(sent[0].message.senderName, 'Khán giả');
    assert.equal(sent[0].message.side, 'SPECTATOR');
  });

  test('rỗng / chỉ khoảng trắng / không phải chuỗi -> EMPTY_MESSAGE, không phát', () => {
    const { relay, sent, clients } = makeRelay();
    for (const text of ['', '   ', 5, null, undefined]) {
      relay.handle(clients[0], 'red', { type: 'chat:send', text });
    }
    assert.equal(sent.length, 5);
    assert.ok(sent.every((s) => s.client === clients[0] && s.message.code === 'EMPTY_MESSAGE'));
  });

  test('đúng 500 ký tự (sau trim) được nhận, 501 bị MESSAGE_TOO_LONG', () => {
    const { relay, sent, clients } = makeRelay();
    relay.handle(clients[0], 'red', { type: 'chat:send', text: ` ${'a'.repeat(500)} ` });
    assert.equal(sent[0].message.type, 'ChatMessage');
    sent.length = 0;
    relay.handle(clients[0], 'red', { type: 'chat:send', text: 'a'.repeat(501) });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.code, 'MESSAGE_TOO_LONG');
  });

  test('5 tin / 3 giây / socket: tin thứ 6 bị CHAT_RATE_LIMITED, hết cửa sổ gửi lại được, socket khác không bị ảnh hưởng', () => {
    let now = 1_000_000;
    const { relay, sent, clients } = makeRelay({ now: () => now });
    for (let i = 0; i < 5; i += 1) relay.handle(clients[0], 'red', { type: 'chat:send', text: `m${i}` });
    sent.length = 0;
    relay.handle(clients[0], 'red', { type: 'chat:send', text: 'spam' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.code, 'CHAT_RATE_LIMITED');

    sent.length = 0;
    relay.handle(clients[1], 'black', { type: 'chat:send', text: 'ok' });
    assert.equal(sent[0].message.type, 'ChatMessage');

    now += 3001;
    sent.length = 0;
    relay.handle(clients[0], 'red', { type: 'chat:send', text: 'lại được' });
    assert.equal(sent[0].message.type, 'ChatMessage');
  });

  test('forget() giải phóng bộ đếm của socket đã đóng', () => {
    const { relay, clients } = makeRelay();
    relay.handle(clients[0], 'red', { type: 'chat:send', text: 'x' });
    assert.equal(relay.rate.size, 1);
    relay.forget(clients[0]);
    assert.equal(relay.rate.size, 0);
  });
});

describe('FE-05: chat qua WS trận demo (server thật)', () => {
  let server;
  let port;
  const sockets = [];

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/matches/COT-615/ws`);
      const inbox = [];
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'ChatMessage' || message.type === 'error') inbox.push(message);
        if (message.type === 'welcome') resolve({ ws, inbox });
      });
      ws.on('error', reject);
      sockets.push(ws);
    });
  }

  before(async () => {
    server = createServer({});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    }));
  });

  after(async () => {
    for (const ws of sockets) ws.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('tin của Đỏ tới Đen, khán giả và chính Đỏ (ack mang clientId)', async () => {
    const red = await connect();
    const black = await connect();
    const spectator = await connect();

    red.ws.send(JSON.stringify({ type: 'chat:send', text: 'Chào Đen', clientId: 'abc' }));
    const ownEcho = await waitFor(red.inbox, (m) => m.type === 'ChatMessage');
    const atBlack = await waitFor(black.inbox, (m) => m.type === 'ChatMessage');
    const atSpectator = await waitFor(spectator.inbox, (m) => m.type === 'ChatMessage');

    assert.equal(ownEcho.clientId, 'abc');
    assert.equal(ownEcho.senderName, 'Đỏ');
    assert.equal(atBlack.text, 'Chào Đen');
    assert.equal(atBlack.id, ownEcho.id);
    assert.equal(atSpectator.senderName, 'Đỏ');

    black.ws.send(JSON.stringify({ type: 'chat:send', text: 'Chào Đỏ' }));
    const reply = await waitFor(red.inbox, (m) => m.type === 'ChatMessage' && m.text === 'Chào Đỏ');
    assert.equal(reply.senderName, 'Đen');

    spectator.ws.send(JSON.stringify({ type: 'chat:send', text: 'Hay quá' }));
    const watch = await waitFor(red.inbox, (m) => m.type === 'ChatMessage' && m.text === 'Hay quá');
    assert.equal(watch.senderName, 'Khán giả');
  });

  test('tin quá dài / rỗng chỉ trả lỗi cho người gửi, không phát cho ai khác', async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    a.ws.send(JSON.stringify({ type: 'chat:send', text: 'z'.repeat(501) }));
    const err = await waitFor(a.inbox, (m) => m.type === 'error');
    assert.equal(err.code, 'MESSAGE_TOO_LONG');
    a.ws.send(JSON.stringify({ type: 'chat:send', text: '   ' }));
    await waitFor(a.inbox, (m) => m.type === 'error' && m.code === 'EMPTY_MESSAGE');
    await sleep(50);
    assert.equal(b.inbox.filter((m) => m.type === 'ChatMessage' && /^z+$/.test(m.text)).length, 0);
  });
});

describe('FE-05: roomHub echo clientId làm ack', () => {
  const db = require('../src/config/db');
  let hub;
  let roomHubServer;
  let roomPort;
  let hostToken;
  let oppToken;
  let room;

  before(async () => {
    process.env.DB_CLIENT = 'sqlite';
    const { runMigrations } = require('../src/migrations/migrate');
    const PgUserRepository = require('../src/infrastructure/database/repositories/PgUserRepository');
    const RegisterUserUseCase = require('../src/application/useCases/registerUser');
    const LoginUserUseCase = require('../src/application/useCases/loginUser');
    const { RoomManager } = require('../src/infrastructure/database/repositories/RoomManager');
    const { RoomHub } = require('../src/presentation/websocket/roomHub');

    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    const userRepo = new PgUserRepository({ db });
    const register = new RegisterUserUseCase({ userRepository: userRepo });
    const login = new LoginUserUseCase({ userRepository: userRepo });
    const roomManager = new RoomManager();
    hub = new RoomHub({ roomManager });

    const host = await register.execute({
      username: 'fe05_host', displayName: 'Chu Phong', email: 'fe05_host@cotuong.vn', password: 'StrongPassword123',
    });
    await register.execute({
      username: 'fe05_opp', displayName: 'Doi Thu', email: 'fe05_opp@cotuong.vn', password: 'StrongPassword123',
    });
    hostToken = (await login.execute({ username: 'fe05_host', password: 'StrongPassword123' })).token;
    oppToken = (await login.execute({ username: 'fe05_opp', password: 'StrongPassword123' })).token;
    room = roomManager.createRoom({ hostUser: host, name: 'Phong FE-05' });

    roomHubServer = createServer({ db, userRepository: userRepo, roomHub: hub, roomOptions: { roomManager } });
    await new Promise((resolve) => roomHubServer.listen(0, '127.0.0.1', () => {
      roomPort = roomHubServer.address().port;
      resolve();
    }));
  });

  after(async () => {
    hub.close();
    await new Promise((resolve) => roomHubServer.close(resolve));
    await db.closePool();
  });

  function connectRoom(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${roomPort}/ws/room?token=${token}&roomCode=${room.code}`);
      const inbox = [];
      ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
      ws.on('open', () => resolve({ ws, inbox }));
      ws.on('error', reject);
    });
  }

  test('ChatMessage gửi lại cho người gửi mang đúng clientId; clientId quá dài bị bỏ', async () => {
    const host = await connectRoom(hostToken);
    const opp = await connectRoom(oppToken);
    await waitFor(host.inbox, (m) => m.type === 'Connected');
    await waitFor(opp.inbox, (m) => m.type === 'Connected');

    host.ws.send(JSON.stringify({ type: 'chat:send', text: 'xin chào', clientId: 'cid-1' }));
    const ack = await waitFor(host.inbox, (m) => m.type === 'ChatMessage');
    assert.equal(ack.clientId, 'cid-1');
    const received = await waitFor(opp.inbox, (m) => m.type === 'ChatMessage');
    assert.equal(received.id, ack.id);

    host.ws.send(JSON.stringify({ type: 'chat:send', text: 'dài', clientId: 'x'.repeat(65) }));
    const second = await waitFor(host.inbox, (m) => m.type === 'ChatMessage' && m.text === 'dài');
    assert.equal('clientId' in second, false);

    host.ws.close();
    opp.ws.close();
  });
});
