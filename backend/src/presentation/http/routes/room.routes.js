const { URL } = require('node:url');
const { safeDecode } = require('../../../core/safeDecode');
const { authenticateRequest, authenticateRequestWithSession } = require('../middlewares/authMiddleware');
const CreateRoomUseCase = require('../../../application/useCases/room/createRoom');
const GetRoomByCodeUseCase = require('../../../application/useCases/room/getRoomByCode');
const JoinRoomByLinkUseCase = require('../../../application/useCases/room/joinRoomByLink');
const { roomManager: defaultRoomManager } = require('../../../infrastructure/database/repositories/RoomManager');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  response.end(JSON.stringify(body));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        request.destroy();
        reject(new Error('Payload quá lớn.'));
      }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const err = new Error('Dữ liệu JSON không hợp lệ.');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });
    request.on('error', reject);
  });
}

function createRoomHandler({
  createRoomUseCase = new CreateRoomUseCase(),
  getRoomByCodeUseCase = new GetRoomByCodeUseCase(),
  joinRoomByLinkUseCase = new JoinRoomByLinkUseCase(),
  roomManager = defaultRoomManager,
  authMiddlewareOptions = {},
  userRepository = new PgUserRepository(),
} = {}) {
  return async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }

    let urlObj;
    try {
      urlObj = new URL(request.url, 'http://localhost');
    } catch {
      sendJson(response, 400, { error: 'URL không hợp lệ.' });
      return;
    }

    const pathname = urlObj.pathname;

    // 1. Lấy danh sách phòng công khai (GET /api/rooms)
    if (pathname === '/api/rooms') {
      if (request.method === 'GET') {
        const rooms = roomManager.listPublicRooms();
        sendJson(response, 200, { success: true, rooms });
        return;
      }

      // 2. Tạo phòng mới và sinh deep link (POST /api/rooms) - COT-589
      if (request.method === 'POST') {
        let user;
        try {
          user = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
        } catch (err) {
          sendJson(response, err.statusCode || 401, { error: err.message, code: err.code });
          return;
        }

        let body = {};
        try {
          body = await parseJsonBody(request);
        } catch (err) {
          sendJson(response, 400, { error: err.message });
          return;
        }

        try {
          const result = await createRoomUseCase.execute(user.id, body);
          sendJson(response, 201, result);
        } catch (err) {
          sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
        }
        return;
      }

      sendJson(response, 405, { error: 'Phương thức không được hỗ trợ.' });
      return;
    }

    // 3. Kiểm tra thông tin phòng qua mã / deep link (GET /api/rooms/:code) - COT-589
    const roomCodeMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomCodeMatch) {
      const code = safeDecode(roomCodeMatch[1]);
      if (code === null) {
        sendJson(response, 400, { error: 'Mã phòng không hợp lệ.', code: 'INVALID_ROOM_CODE' });
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận GET.' });
        return;
      }

      try {
        const result = getRoomByCodeUseCase.execute(code);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 404, { error: err.message, code: err.code });
      }
      return;
    }

    // 4. Lấy deep link mời (GET /api/rooms/:code/invitation) - COT-589
    const inviteMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/invitation$/);
    if (inviteMatch) {
      const code = safeDecode(inviteMatch[1]);
      if (code === null) {
        sendJson(response, 400, { error: 'Mã phòng không hợp lệ.', code: 'INVALID_ROOM_CODE' });
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận GET.' });
        return;
      }

      try {
        const result = getRoomByCodeUseCase.execute(code);
        sendJson(response, 200, {
          success: true,
          roomCode: result.room.code,
          inviteLink: result.inviteLink,
          status: result.room.status,
          playerCount: result.room.playerCount,
          spectatorCount: result.room.spectatorCount,
        });
      } catch (err) {
        sendJson(response, err.statusCode || 404, { error: err.message, code: err.code });
      }
      return;
    }

    // 5. Tham gia phòng qua link và phân vai trò Player/Spectator (POST /api/rooms/:code/join) - COT-589
    const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (joinMatch) {
      const code = safeDecode(joinMatch[1]);
      if (code === null) {
        sendJson(response, 400, { error: 'Mã phòng không hợp lệ.', code: 'INVALID_ROOM_CODE' });
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      let user;
      try {
        user = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
      } catch (err) {
        sendJson(response, err.statusCode || 401, { error: err.message, code: err.code });
        return;
      }

      try {
        const result = await joinRoomByLinkUseCase.execute(user.id, code);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    sendJson(response, 404, { error: 'Đường dẫn phòng cờ không tồn tại.' });
  };
}

module.exports = { createRoomHandler };
