const { URL } = require('node:url');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');
const { safeDecode } = require('../../../core/safeDecode');
const { authenticateRequest, authenticateRequestWithSession } = require('../middlewares/authMiddleware');
const GetOnlineFriendsUseCase = require('../../../application/useCases/friends/getOnlineFriends');
const SendDirectInvitationUseCase = require('../../../application/useCases/friends/sendDirectInvitation');
const RespondDirectInvitationUseCase = require('../../../application/useCases/friends/respondDirectInvitation');
const CancelDirectInvitationUseCase = require('../../../application/useCases/friends/cancelDirectInvitation');
const { directInvitationManager: defaultInvitationManager } = require('../../../infrastructure/database/repositories/DirectInvitationManager');

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function createFriendsHandler({
  getOnlineFriendsUseCase = new GetOnlineFriendsUseCase(),
  sendDirectInvitationUseCase = new SendDirectInvitationUseCase(),
  respondDirectInvitationUseCase = new RespondDirectInvitationUseCase(),
  cancelDirectInvitationUseCase = new CancelDirectInvitationUseCase(),
  invitationManager = defaultInvitationManager,
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

    let user;
    try {
      user = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
    } catch (err) {
      sendJson(response, err.statusCode || 401, { error: err.message, code: err.code });
      return;
    }

    // 1. Lấy danh sách bạn bè Online (GET /api/friends/online) - COT-590
    if (pathname === '/api/friends/online') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận GET.' });
        return;
      }

      try {
        const result = await getOnlineFriendsUseCase.execute(user.id);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    // 2. Gửi lời mời trực tiếp vào phòng (POST /api/friends/invitations) - COT-590
    if (pathname === '/api/friends/invitations') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      let payload;
      try {
        payload = await parseJsonBody(request);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
        return;
      }

      try {
        const result = await sendDirectInvitationUseCase.execute(user.id, payload);
        sendJson(response, 201, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    // 3. Lấy danh sách lời mời đang chờ (GET /api/friends/invitations/pending) - COT-590
    if (pathname === '/api/friends/invitations/pending') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận GET.' });
        return;
      }

      const pending = invitationManager.listPendingForUser(user.id);
      sendJson(response, 200, {
        success: true,
        count: pending.length,
        invitations: pending,
      });
      return;
    }

    // 4. Phản hồi lời mời (POST /api/friends/invitations/:id/respond) - COT-590
    const respondMatch = pathname.match(/^\/api\/friends\/invitations\/([^/]+)\/respond$/);
    if (respondMatch) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      const invitationId = safeDecode(respondMatch[1]);
      if (invitationId === null) {
        sendJson(response, 400, { error: 'Mã lời mời không hợp lệ.', code: 'INVALID_INVITATION_ID' });
        return;
      }
      let payload;
      try {
        payload = await parseJsonBody(request);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
        return;
      }

      try {
        const result = await respondDirectInvitationUseCase.execute(user.id, invitationId, payload);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    // 5. Hủy lời mời (DELETE /api/friends/invitations/:id) - COT-590
    const cancelMatch = pathname.match(/^\/api\/friends\/invitations\/([^/]+)$/);
    if (cancelMatch) {
      if (request.method !== 'DELETE') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận DELETE.' });
        return;
      }

      const invitationId = safeDecode(cancelMatch[1]);
      if (invitationId === null) {
        sendJson(response, 400, { error: 'Mã lời mời không hợp lệ.', code: 'INVALID_INVITATION_ID' });
        return;
      }
      try {
        const result = cancelDirectInvitationUseCase.execute(user.id, invitationId);
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    sendJson(response, 404, { error: 'Đường dẫn bạn bè không tồn tại.' });
  };
}

module.exports = { createFriendsHandler };
