// SEC-02: nạp .env trước mọi require khác để JWT_SECRET/DB_* có sẵn khi module đọc cấu hình
require('dotenv').config();

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { applyMatchMove, createCot615Match, getPublicMatchState } = require('./domain/entities/cot615Match');
const { createMatchesHandler } = require('./presentation/http/routes/matches.routes');
const { createAuthHandler } = require('./presentation/http/routes/auth.routes');
const { createUserHandler } = require('./presentation/http/routes/user.routes');
const { createRoomHandler } = require('./presentation/http/routes/room.routes');
const { createFriendsHandler } = require('./presentation/http/routes/friends.routes');
const { roomHub: defaultRoomHub } = require('./presentation/websocket/roomHub');
const fs = require('node:fs');
const path = require('node:path');
const { assertJwtSecretConfigured } = require('./application/services/tokenService');

function createServer(options = {}) {
  let match = options.match || null;
  const now = options.now || (() => Date.now());
  const clients = new Map();
  const webSockets = new WebSocketServer({ noServer: true });
  const roomHub = options.roomHub || defaultRoomHub;
  const getCurrentMatch = () => {
    if (!match) match = createCot615Match(now());
    return match;
  };
  const matchesHandler = createMatchesHandler({
    getMatch: getCurrentMatch,
    now,
  });
  const authHandler = options.authHandler || createAuthHandler(options.authOptions);
  const userHandler = options.userHandler || createUserHandler(options.userOptions);
  const roomHandler = options.roomHandler || createRoomHandler(options.roomOptions);
  const friendsHandler = options.friendsHandler || createFriendsHandler(options.friendsOptions);

  const httpHandler = (req, res) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL không hợp lệ' }));
      return;
    }

    if (pathname.startsWith('/api/auth')) {
      return authHandler(req, res);
    }
    if (pathname.startsWith('/api/users')) {
      return userHandler(req, res);
    }
    if (pathname.startsWith('/api/rooms')) {
      return roomHandler(req, res);
    }
    if (pathname.startsWith('/api/friends')) {
      return friendsHandler(req, res);
    }
    if (pathname.startsWith('/uploads/')) {
      const filePath = path.resolve(__dirname, '..', pathname.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
        res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
    }
    return matchesHandler(req, res);
  };

  const server = http.createServer(httpHandler);

  function send(client, message) {
    if (client.readyState === 1) client.send(JSON.stringify(message));
  }

  function broadcastState() {
    if (!match) return;
    const state = getPublicMatchState(match, now());
    for (const [client, color] of clients) {
      send(client, { type: 'state', state, color, readOnly: color === null });
    }
  }

  function assignColor() {
    const occupied = new Set([...clients.values()].filter(Boolean));
    return ['red', 'black'].find((color) => !occupied.has(color)) || null;
  }

  function handleMessage(client, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send(client, { type: 'error', error: 'Dữ liệu gửi lên không hợp lệ.' });
      return;
    }

    if (message?.type !== 'move' || typeof message.from !== 'string' || typeof message.to !== 'string') {
      send(client, { type: 'error', error: 'Yêu cầu nước đi không hợp lệ.' });
      return;
    }

    const color = clients.get(client);
    if (!color) {
      send(client, { type: 'moveResult', accepted: false, error: 'Khán giả không thể đi quân.' });
      return;
    }

    const result = applyMatchMove(getCurrentMatch(), color, message.from, message.to, now());
    if (result.accepted) broadcastState();
    send(client, { type: 'moveResult', ...result });
  }

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname === '/ws/room' || pathname.startsWith('/ws/room/')) {
      roomHub.handleUpgrade(request, socket, head);
      return;
    }

    const matchRoute = pathname.match(/^\/api\/matches\/([^/]+)\/ws$/);
    if (!matchRoute) {
      socket.destroy();
      return;
    }

    let requestedMatchId;
    try {
      requestedMatchId = decodeURIComponent(matchRoute[1]);
    } catch {
      socket.destroy();
      return;
    }
    if (requestedMatchId !== getCurrentMatch().id) {
      socket.destroy();
      return;
    }

    webSockets.handleUpgrade(request, socket, head, (client) => {
      webSockets.emit('connection', client);
    });
  });

  webSockets.on('connection', (client) => {
    const color = assignColor();
    clients.set(client, color);
    send(client, {
      type: 'welcome',
      color,
      readOnly: color === null,
      state: getPublicMatchState(getCurrentMatch(), now()),
    });
    broadcastState();
    client.on('message', (message) => handleMessage(client, message));
    client.on('close', () => {
      clients.delete(client);
      broadcastState();
    });
  });

  const clockTimer = setInterval(broadcastState, 1000);
  clockTimer.unref();

  server.on('close', () => {
    clearInterval(clockTimer);
    for (const client of webSockets.clients) client.close();
    webSockets.close();
  });

  return server;
}

if (require.main === module) {
  // SEC-02: thiếu hoặc quá ngắn JWT_SECRET → dừng ngay, không chạy với secret không an toàn
  try {
    assertJwtSecretConfigured();
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    console.error('Sinh secret bằng: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
  }

  const port = Number(process.env.PORT || 5000);
  const server = createServer();

  // SEC-01: Cảnh báo rõ khi mock OAuth đang bật (chỉ dev/demo)
  if (process.env.ALLOW_MOCK_OAUTH === 'true' && process.env.NODE_ENV !== 'production') {
    console.warn('[OAuth] MOCK OAUTH ĐANG BẬT — chỉ dùng cho dev/demo');
  }

  server.listen(port, '127.0.0.1', () => {
    console.log(`Match API listening on http://localhost:${port}`);
    console.log('Development match: GET /api/matches/COT-615; WebSocket /api/matches/COT-615/ws');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close((error) => {
        if (error) {
          console.error('Failed to close Match API server:', error);
          process.exitCode = 1;
        }
      });
    });
  }
}

module.exports = { createServer };
