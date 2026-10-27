const { URL } = require('node:url');
const { sendError } = require('../utils/errorResponse');
const { authenticateRequest, authenticateRequestWithSession } = require('../middlewares/authMiddleware');
const UpdateProfileUseCase = require('../../../application/useCases/updateProfile');
const UploadAvatarUseCase = require('../../../application/useCases/uploadAvatar');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

function parseRawBody(request, limitBytes = 2 * 1024 * 1024 + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    request.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > limitBytes) {
        request.destroy();
        const err = new Error('Tệp tải lên vượt quá dung lượng tối đa cho phép (2MB).');
        err.statusCode = 400;
        err.code = 'FILE_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

/**
 * Phân tích tệp avatar từ request (hỗ trợ multipart/form-data hoặc binary stream)
 */
function extractFileData(contentType, rawBuffer) {
  if (contentType.includes('multipart/form-data')) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      throw new Error('Không tìm thấy boundary trong multipart header.');
    }
    const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
    const boundaryBuffer = Buffer.from('--' + boundary);

    const boundaryPositions = [];
    let pos = 0;
    while ((pos = rawBuffer.indexOf(boundaryBuffer, pos)) !== -1) {
      boundaryPositions.push(pos);
      pos += boundaryBuffer.length;
    }

    for (let i = 0; i < boundaryPositions.length - 1; i++) {
      const partStart = boundaryPositions[i] + boundaryBuffer.length;
      const partEnd = boundaryPositions[i + 1];
      let partBuffer = rawBuffer.slice(partStart, partEnd);

      if (partBuffer[0] === 0x0d && partBuffer[1] === 0x0a) {
        partBuffer = partBuffer.slice(2);
      } else if (partBuffer[0] === 0x0a) {
        partBuffer = partBuffer.slice(1);
      }

      let headerEndIndex = partBuffer.indexOf('\r\n\r\n');
      let headerLen = 4;
      if (headerEndIndex === -1) {
        headerEndIndex = partBuffer.indexOf('\n\n');
        headerLen = 2;
      }
      if (headerEndIndex === -1) continue;

      const headerText = partBuffer.slice(0, headerEndIndex).toString('utf-8');
      const filenameMatch = headerText.match(/filename="([^"]+)"/i);
      const mimeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

      if (filenameMatch) {
        const filename = filenameMatch[1];
        const mimeType = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
        let bodyBuffer = partBuffer.slice(headerEndIndex + headerLen);
        if (bodyBuffer.slice(-2).toString() === '\r\n') {
          bodyBuffer = bodyBuffer.slice(0, -2);
        } else if (bodyBuffer.slice(-1).toString() === '\n') {
          bodyBuffer = bodyBuffer.slice(0, -1);
        }
        return { buffer: bodyBuffer, mimeType, filename };
      }
    }
    throw new Error('Không tìm thấy file hợp lệ trong form data.');
  } else {
    const filename = 'avatar.png';
    return { buffer: rawBuffer, mimeType: contentType.split(';')[0].trim(), filename };
  }
}

function createUserHandler({
  updateProfileUseCase = new UpdateProfileUseCase(),
  uploadAvatarUseCase = new UploadAvatarUseCase(),
  userRepository = new PgUserRepository(),
  authMiddlewareOptions = {},
} = {}) {
  return async (request, response) => {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      sendJson(response, 400, { error: 'URL không hợp lệ.' });
      return;
    }

    // 1. Cập nhật thông tin cá nhân (PUT /api/users/profile) - COT-577
    if (pathname === '/api/users/profile') {
      if (request.method !== 'PUT') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận PUT.' });
        return;
      }

      let user;
      try {
        user = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
      } catch (err) {
        sendError(response, sendJson, err, { defaultStatus: 401 });
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
        const result = await updateProfileUseCase.execute(user.id, payload);
        sendJson(response, 200, result);
      } catch (err) {
        sendError(response, sendJson, err, { defaultStatus: 400 });
      }
      return;
    }

    // 2. Upload ảnh đại diện Avatar (POST /api/users/avatar) - COT-577
    if (pathname === '/api/users/avatar') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      let user;
      try {
        user = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
      } catch (err) {
        sendError(response, sendJson, err, { defaultStatus: 401 });
        return;
      }

      const contentType = request.headers['content-type'] || '';
      let rawBuffer;
      try {
        rawBuffer = await parseRawBody(request);
      } catch (err) {
        sendError(response, sendJson, err, { defaultStatus: 400 });
        return;
      }

      let fileData;
      try {
        fileData = extractFileData(contentType, rawBuffer);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
        return;
      }

      try {
        const result = await uploadAvatarUseCase.execute(user.id, fileData);
        sendJson(response, 200, result);
      } catch (err) {
        sendError(response, sendJson, err, { defaultStatus: 400 });
      }
      return;
    }

    sendJson(response, 404, { error: 'Đường dẫn người dùng không tồn tại.' });
  };
}

module.exports = { createUserHandler };
