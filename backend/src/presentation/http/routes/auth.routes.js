const { URL } = require('node:url');
const RegisterUserUseCase = require('../../../application/useCases/registerUser');
const LoginUserUseCase = require('../../../application/useCases/loginUser');
const ForgotPasswordUseCase = require('../../../application/useCases/forgotPassword');
const ResetPasswordUseCase = require('../../../application/useCases/resetPassword');
const OAuthLoginUseCase = require('../../../application/useCases/oauthLogin');
const { authenticateRequest, authenticateRequestWithSession } = require('../middlewares/authMiddleware');
const { enforce, getClientIp, loginLimiter, registerLimiter } = require('../middlewares/rateLimiter');
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

/**
 * BE-13: trả 429 nếu vượt giới hạn.
 * @returns {boolean} true nếu đã trả response và cần dừng
 */
function rejectIfRateLimited(request, response, limiter, key) {
  const limited = enforce(limiter, key);
  if (!limited) return false;
  response.setHeader?.('Retry-After', String(limited.retryAfterSeconds));
  sendJson(response, limited.statusCode, {
    error: limited.message,
    code: limited.code,
    retryAfterSeconds: limited.retryAfterSeconds,
  });
  return true;
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
      if (!body) {
        resolve({});
        return;
      }
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

function createAuthHandler({
  registerUseCase = new RegisterUserUseCase(),
  loginUseCase = new LoginUserUseCase(),
  forgotPasswordUseCase = new ForgotPasswordUseCase(),
  resetPasswordUseCase = new ResetPasswordUseCase(),
  oauthLoginUseCase = new OAuthLoginUseCase(),
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

    // 1. Đăng ký tài khoản (COT-571)
    if (pathname === '/api/auth/register') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      // BE-13: 5 lần đăng ký / giờ / IP
      if (rejectIfRateLimited(request, response, registerLimiter, `register:${getClientIp(request)}`)) return;

      let payload;
      try {
        payload = await parseJsonBody(request);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
        return;
      }

      try {
        const user = await registerUseCase.execute(payload);
        sendJson(response, 201, {
          success: true,
          message: 'Đăng ký tài khoản thành công.',
          user,
        });
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR') {
          sendJson(response, 400, { error: err.message, errors: err.errors });
        } else if (err.code === 'USERNAME_EXISTS' || err.code === 'EMAIL_EXISTS') {
          sendJson(response, 409, { error: err.message, code: err.code });
        } else {
          console.error('Lỗi khi đăng ký:', err);
          sendJson(response, 500, { error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' });
        }
      }
      return;
    }

    // 2. Đăng nhập hệ thống (COT-572)
    if (pathname === '/api/auth/login') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận POST.' });
        return;
      }

      // BE-13: 10 lần / 15 phút / IP và / tên đăng nhập
      if (rejectIfRateLimited(request, response, loginLimiter, `login-ip:${getClientIp(request)}`)) return;

      let payload;
      try {
        payload = await parseJsonBody(request);
      } catch (err) {
        sendJson(response, 400, { error: err.message });
        return;
      }

      // BE-13: giới hạn theo username để chặn brute force nhắm 1 tài khoản
      const loginKey = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
      if (loginKey && rejectIfRateLimited(request, response, loginLimiter, `login-user:${loginKey}`)) return;

      try {
        const result = await loginUseCase.execute(payload);
        sendJson(response, 200, result);
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR') {
          sendJson(response, 400, { error: err.message });
        } else if (err.code === 'INVALID_CREDENTIALS') {
          sendJson(response, 401, { error: err.message, code: err.code });
        } else if (err.code === 'ACCOUNT_INACTIVE') {
          sendJson(response, 403, { error: err.message, code: err.code });
        } else {
          console.error('Lỗi khi đăng nhập:', err);
          sendJson(response, 500, { error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' });
        }
      }
      return;
    }

    // 3. Quên mật khẩu - gửi OTP/Token (COT-575)
    if (pathname === '/api/auth/forgot-password') {
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
        const result = await forgotPasswordUseCase.execute(payload);
        sendJson(response, 200, result);
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR') {
          sendJson(response, 400, { error: err.message });
        } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
          sendJson(response, 429, { error: err.message, code: err.code });
        } else {
          console.error('Lỗi khi quên mật khẩu:', err);
          sendJson(response, 500, { error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' });
        }
      }
      return;
    }

    // 4. Đặt lại mật khẩu (COT-576)
    if (pathname === '/api/auth/reset-password') {
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
        const result = await resetPasswordUseCase.execute(payload);
        sendJson(response, 200, result);
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR') {
          sendJson(response, 400, { error: err.message });
        } else if (err.code === 'TOKEN_ALREADY_USED' || err.code === 'TOKEN_EXPIRED' || err.code === 'INVALID_TOKEN') {
          sendJson(response, 400, { error: err.message, code: err.code });
        } else {
          console.error('Lỗi khi đặt lại mật khẩu:', err);
          sendJson(response, 500, { error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.' });
        }
      }
      return;
    }

    // 5. Đăng nhập Google OAuth (COT-573)
    if (pathname === '/api/auth/google') {
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
        const result = await oauthLoginUseCase.execute({
          provider: 'google',
          credential: payload.credential || payload.token || payload.idToken,
          redirectUrl: payload.redirectUrl,
        });
        sendJson(response, 200, result);
      } catch (err) {
        sendJson(response, err.statusCode || 400, { error: err.message, code: err.code });
      }
      return;
    }

    // 6. Lấy thông tin phiên hiện tại (Protected API - COT-572)
    if (pathname === '/api/auth/me') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Phương thức không được hỗ trợ. Chỉ chấp nhận GET.' });
        return;
      }

      try {
        const decoded = await authenticateRequestWithSession(request, { ...authMiddlewareOptions, userRepository });
        const user = await userRepository.findById(decoded.id);
        if (!user) {
          sendJson(response, 404, { error: 'Người dùng không tồn tại.' });
          return;
        }
        sendJson(response, 200, {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            eloRating: user.eloRating,
            avatarUrl: user.avatarUrl,
            status: user.status,
          },
        });
      } catch (err) {
        sendJson(response, err.statusCode || 401, {
          error: err.message,
          code: err.code || 'UNAUTHORIZED',
        });
      }
      return;
    }

    sendJson(response, 404, { error: 'Đường dẫn xác thực không tồn tại.' });
  };
}

module.exports = { createAuthHandler };
