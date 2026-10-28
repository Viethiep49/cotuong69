const { AppError, asAppError, ERROR_CODES } = require('../../../core/errors/AppError');

/**
 * BE-12: chỉ trả message/code của lỗi nghiệp vụ cho client.
 * Lỗi hệ thống (DB, TypeError, ECONNREFUSED...) -> log nội bộ + 500 INTERNAL_ERROR,
 * không lộ chi tiết kỹ thuật ra ngoài.
 *
 * REV-03: trước đây whitelist chỉ chấp nhận mã có trong danh sách VÀ status 4xx,
 * nên lỗi nghiệp vụ hợp lệ bị biến thành 500 (OAUTH_DISABLED 503, NO_TOKEN,
 * USER_KICKED, FILE_TOO_LARGE...). Nay mọi mã thuộc ERROR_CODES đều được trả
 * nguyên văn với status 4xx/5xx của nó.
 */
const KNOWN_ERROR_CODES = new Set(Object.keys(ERROR_CODES));

/**
 * @param {Error} err
 * @param {{defaultStatus?: number}} [options]
 * @returns {{statusCode:number, body:{error:string, code:string, errors?:string[], details?:any}}}
 */
function toErrorResponse(err, { defaultStatus = 400 } = {}) {
  const status = Number(err && err.statusCode);
  const appError = err instanceof AppError ? err : asAppError(err);

  if (appError) {
    const body = {
      error: appError.message,
      code: appError.code || 'BAD_REQUEST',
    };
    if (Array.isArray(appError.errors)) body.errors = appError.errors;
    if (appError.details !== undefined) body.details = appError.details;

    let statusCode = Number(appError.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      statusCode = Number.isInteger(status) && status >= 400 && status <= 599 ? status : defaultStatus;
    }
    return { statusCode, body };
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
