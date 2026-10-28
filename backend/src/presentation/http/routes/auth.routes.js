const { URL } = require('node:url');
const { corsHeaders } = require('../../../core/cors');
const { sendError } = require('../utils/errorResponse');
const RegisterUserUseCase = require('../../../application/use-cases/auth/registerUser');
const LoginUserUseCase = require('../../../application/use-cases/auth/loginUser');
const ForgotPasswordUseCase = require('../../../application/use-cases/auth/forgotPassword');
const ResetPasswordUseCase = require('../../../application/use-cases/auth/resetPassword');
const OAuthLoginUseCase = require('../../../application/use-cases/auth/oauthLogin');
const { authenticateRequest, authenticateRequestWithSession } = require('../middlewares/authMiddleware');
const {
  enforce,
  getClientIp,
  isDevLoopbackExempt,
  loginLimiter,
  registerLimiter,
  loginUsernameLimiter,
  loginSlowdownMs,
} = require('../middlewares/rateLimiter');
const PgUserRepository = require('../../../infrastructure/database/repositories/PgUserRepository');

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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
    // REV-08: CORS theo whitelist (trước đây import corsHeaders nhưng không gọi)
    for (const [headerName, headerValue] of Object.entries(corsHeaders(request))) {
      response.setHeader(headerName, headerValue);
    }

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
      if (!isDevLoopbackExempt(request)
        && rejectIfRateLimited(request, response, registerLimiter, `register:${getClientIp(request)}`)) return;

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

      // BE-13 + REV-04: IP chỉ bị đếm khi đăng nhập THẤT BẠI (đăng nhập đúng không bị tính).
      // Username chỉ bị làm chậm, không khoá hẳn -> kẻ xấu không thể khoá tài khoản người khác.
      //
      // REV2-16: lượt thử phải được ĐẾM NGAY LÚC REQUEST ĐẾN (đồng bộ, trước mọi await). Trước đây
      // chỉ `isBlocked` lúc đến và `record` sau khi bcrypt xong nên 200 request song song từ một IP
      // đều được xử lý. Giờ lượt được ghi ngay và chỉ hoàn lại (refund) nếu đó không phải thất bại.
      // REV2-17: đăng nhập thành công KHÔNG xoá bộ đếm của IP (nếu xoá thì kẻ xấu xen 1 lần đăng nhập
      // vào tài khoản của mình giữa mỗi 9 lần đoán để không bao giờ bị chặn); chỉ hoàn lại lượt của
      // chính request đó.
      // Demo dev trên một máy: không đếm theo IP loopback (xem isDevLoopbackExempt)
      const ipExempt = isDevLoopbackExempt(request);
      const loginIpKey = `login-ip:${getClientIp(request)}`;
      const ipAttempt = ipExempt ? { allowed: true, ts: null } : loginLimiter.consume(loginIpKey);
      if (!ipAttempt.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(ipAttempt.retryAfterMs / 1000)) || 60;
        response.setHeader?.('Retry-After', String(retryAfterSeconds));
        sendJson(response, 429, {
          error: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.',
          code: 'RATE_LIMITED',
          retryAfterSeconds,
        });
        return;
      }
      let ipCounted = !ipExempt;
      const refundIp = () => {
        if (!ipCounted) return;
        ipCounted = false;
        loginLimiter.refund(loginIpKey, ipAttempt.ts);
      };

      let payload;
      try {
        payload = await parseJsonBody(request);
      } catch (err) {
        refundIp();
        sendJson(response, 400, { error: err.message });
        return;
      }

      const loginKey = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
      const userKey = loginKey ? `login-user:${loginKey}` : null;
      // REV2-16: độ trễ tính từ số lượt đã đếm (kể cả đang xử lý song song) rồi đếm luôn lượt này
      const slowDownMs = loginKey ? loginSlowdownMs(loginKey) : 0;
      const userTs = Date.now();
      let userCounted = false;
      if (userKey) {
        loginUsernameLimiter.record(userKey, userTs);
        userCounted = true;
      }
      const refundUser = () => {
        if (!userCounted) return;
        userCounted = false;
        loginUsernameLimiter.refund(userKey, userTs);
      };
      if (slowDownMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, slowDownMs));
      }

      try {
        const result = await loginUseCase.execute(payload);
        // Đăng nhập thành công: hoàn lượt của IP; bộ đếm của USERNAME này thì xoá hẳn (chủ tài khoản
        // đã chứng minh được mật khẩu). KHÔNG đụng bộ đếm thất bại của IP.
        refundIp();
        if (userKey) {
          loginUsernameLimiter.reset(userKey);
          userCounted = false;
        }
        sendJson(response, 200, result);
      } catch (err) {
        // Chỉ giữ lại lượt đã đếm với các lần thất bại thực sự (sai thông tin / tài khoản bị khoá)
        if (err.code !== 'INVALID_CREDENTIALS' && err.code !== 'ACCOUNT_INACTIVE') {
          refundIp();
          refundUser();
        }
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
        sendError(response, sendJson, err, { defaultStatus: 400 });
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
        sendError(response, sendJson, err, { defaultStatus: 401 });
      }
      return;
    }

    sendJson(response, 404, { error: 'Đường dẫn xác thực không tồn tại.' });
  };
}

module.exports = { createAuthHandler };
