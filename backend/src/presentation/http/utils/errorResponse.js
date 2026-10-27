const { AppError } = require('../../../core/errors/AppError');

/**
 * BE-12: chỉ trả message/code của lỗi nghiệp vụ cho client.
 * Lỗi hệ thống (DB, TypeError, ECONNREFUSED...) -> log nội bộ + 500 INTERNAL_ERROR,
 * không lộ chi tiết kỹ thuật ra ngoài.
 */

// Các mã lỗi nghiệp vụ được phép trả nguyên văn cho client
const KNOWN_ERROR_CODES = new Set([
  // auth
  'VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'UNAUTHORIZED',
  'USERNAME_EXISTS', 'EMAIL_EXISTS', 'INVALID_TOKEN', 'TOKEN_EXPIRED',
  'TOKEN_ALREADY_USED', 'TOKEN_REVOKED', 'INVALID_OAUTH_TOKEN', 'OAUTH_DISABLED',
  'UNSUPPORTED_OAUTH_PROVIDER', 'OAUTH_PROVIDER_ERROR', 'ACCOUNT_EXISTS_LOGIN_REQUIRED',
  // user
  'USER_NOT_FOUND', 'INVALID_AVATAR', 'AVATAR_TOO_LARGE', 'INVALID_DISPLAY_NAME',
  // room
  'ROOM_NOT_FOUND', 'ROOM_CLOSED', 'ROOM_CODE_EXHAUSTED', 'INVALID_ROOM_CODE',
  'INVALID_ROOM_NAME', 'INVALID_MAX_SPECTATORS', 'TOO_MANY_ROOMS', 'GAME_IN_PROGRESS',
  'NO_OPPONENT', 'ROOM_FULL',
  // friends
  'NOT_FRIENDS', 'FRIEND_OFFLINE', 'NOT_IN_ROOM', 'INVITATION_NOT_FOUND',
  'INVITATION_EXPIRED', 'INVITATION_ALREADY_PROCESSED', 'INVALID_ACTION',
  'INVALID_INVITATION', 'INVALID_INVITATION_ID', 'FRIEND_REQUEST_EXISTS',
  // game / chung
  'INVALID_MOVE', 'ILLEGAL_MOVE', 'NOT_YOUR_TURN', 'MATCH_FINISHED',
  'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
]);

/**
 * @param {Error} err
 * @param {{defaultStatus?: number}} [options]
 * @returns {{statusCode:number, body:{error:string, code:string, errors?:string[], details?:any}}}
 */
function toErrorResponse(err, { defaultStatus = 400 } = {}) {
  const status = Number(err && err.statusCode);

  const isKnownBusinessError = Boolean(
    err && (
      err instanceof AppError
      || (KNOWN_ERROR_CODES.has(err.code) && Number.isInteger(status) && status >= 400 && status < 500)
    ),
  );

  if (isKnownBusinessError) {
    const body = {
      error: err.message,
      code: err.code || 'BAD_REQUEST',
    };
    if (Array.isArray(err.errors)) body.errors = err.errors;
    if (err.details !== undefined) body.details = err.details;
    return {
      statusCode: Number.isInteger(status) && status >= 400 && status < 500 ? status : defaultStatus,
      body,
    };
  }

  // Lỗi hệ thống: log đầy đủ ở server, trả về thông báo chung
  console.error('[HTTP] Lỗi không xác định:', err);
  return {
    statusCode: 500,
    body: {
      error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.',
      code: 'INTERNAL_ERROR',
    },
  };
}

/**
 * Gửi lỗi đã chuẩn hoá.
 */
function sendError(response, sendJson, err, options = {}) {
  const failure = toErrorResponse(err, options);
  sendJson(response, failure.statusCode, failure.body);
}

module.exports = {
  toErrorResponse,
  sendError,
  KNOWN_ERROR_CODES,
};
