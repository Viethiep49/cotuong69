// Bộ dụng cụ test cấp hub: socket giả đi qua đúng `wss.on('connection')` và `socket.on('close')` của RoomHub.
const { EventEmitter } = require('node:events');
const { RoomHub } = require('../../src/presentation/websocket/roomHub');
const { RoomManager } = require('../../src/infrastructure/database/repositories/RoomManager');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeSocket extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.readyState = 1;
    this.inbox = [];
  }

  send(raw) { this.inbox.push(JSON.parse(raw)); }

  close(code, reason) {
    if (this.readyState !== 1) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    setImmediate(() => this.emit('close'));
  }

  terminate() { this.close(); }

  ping() {}

  types() { return this.inbox.map((m) => m.type); }

  last(type) {
    for (let i = this.inbox.length - 1; i >= 0; i -= 1) if (this.inbox[i].type === type) return this.inbox[i];
    return null;
  }
}

function makeHub({ countdown = 2, eloDelayMs = 0, pvpMatchRepository, ...rest } = {}) {
  const roomManager = new RoomManager({ sweepIntervalMs: 0 });
  const userRepository = {
    findById: async (id) => {
      if (eloDelayMs) await sleep(eloDelayMs);
      return { id, status: 'ACTIVE', eloRating: 1500 };
    },
    addEloPair: async () => { if (eloDelayMs) await sleep(eloDelayMs); },
  };
  const hub = new RoomHub({
    roomManager,
    userRepository,
    enableHeartbeat: false,
    reconnectCountdownSeconds: countdown,
    pvpMatchRepository: pvpMatchRepository || { create: async () => 1 },
    ...rest,
  });
  return { hub, roomManager };
}

function connect(hub, room, user, name) {
  const s = new FakeSocket(name || user.username);
  hub.wss.emit('connection', s, {}, user, room);
  return s;
}

function send(s, msg) { s.emit('message', Buffer.from(JSON.stringify(msg))); }

const RED = { id: 1, username: 'red' };
const BLACK = { id: 2, username: 'black' };
const SPEC = { id: 3, username: 'spec' };

async function playingRoom(hub, roomManager, { withSpectator = false } = {}) {
  const room = roomManager.createRoom({ hostUser: RED, name: 'x' });
  const r = connect(hub, room, RED, 'red');
  const b = connect(hub, room, BLACK, 'black');
  const sp = withSpectator ? connect(hub, room, SPEC, 'spec') : null;
  send(r, { type: 'ready', isReady: true });
  send(b, { type: 'ready', isReady: true });
  await sleep(5);
  send(r, { type: 'start' });
  await sleep(5);
  if (room.status !== 'PLAYING') throw new Error(`not playing ${room.status}`);
  return { room, r, b, sp };
}

module.exports = { FakeSocket, makeHub, connect, send, sleep, playingRoom, RED, BLACK, SPEC };
