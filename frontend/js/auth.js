/**
 * Kỳ Đạo Online - Authentication, OAuth & Profile Service (COT-579, COT-580, COT-581, COT-583, COT-585)
 * Cung cấp toàn bộ validation client-side, quản lý lưu trữ Token an toàn,
 * điều khiển phiên đăng nhập/đăng xuất, OAuth Google/Facebook, và cập nhật hồ sơ/Avatar.
 */

const AUTH_ERROR_CODES = {
  EMAIL_EMPTY: 'EMAIL_EMPTY',
  EMAIL_INVALID: 'EMAIL_INVALID',
  PASSWORD_EMPTY: 'PASSWORD_EMPTY',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_MISSING_ALPHA_OR_NUM: 'PASSWORD_MISSING_ALPHA_OR_NUM',
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  USERNAME_EMPTY: 'USERNAME_EMPTY',
  USERNAME_TOO_SHORT: 'USERNAME_TOO_SHORT',
  USERNAME_INVALID: 'USERNAME_INVALID',
  DISPLAY_NAME_EMPTY: 'DISPLAY_NAME_EMPTY',
  DISPLAY_NAME_TOO_SHORT: 'DISPLAY_NAME_TOO_SHORT',
  DISPLAY_NAME_TOO_LONG: 'DISPLAY_NAME_TOO_LONG',
  FILE_EMPTY: 'FILE_EMPTY',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  NETWORK_ERROR: 'NETWORK_ERROR',
  POPUP_CLOSED_BY_USER: 'POPUP_CLOSED_BY_USER',
  OAUTH_FAILED: 'OAUTH_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_MISSING: 'TOKEN_MISSING',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_ALREADY_USED: 'TOKEN_ALREADY_USED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};

const SAFE_FORGOT_PASSWORD_MESSAGE =
  'Nếu email tồn tại trong hệ thống, hướng dẫn và liên kết đặt lại mật khẩu đã được gửi đến hộp thư của bạn. Vui lòng kiểm tra hòm thư (kể cả mục Spam).';

/**
 * =========================================================================
 * VALIDATION FUNCTIONS (CLIENT-SIDE)
 * =========================================================================
 */

function validateEmail(email) {
  if (email === undefined || email === null) {
    return { isValid: false, error: 'Email không được để trống.', code: AUTH_ERROR_CODES.EMAIL_EMPTY };
  }
  const trimmed = String(email).trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Email không được để trống.', code: AUTH_ERROR_CODES.EMAIL_EMPTY };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Định dạng email không hợp lệ (Ví dụ: kythu@cotuong.com).', code: AUTH_ERROR_CODES.EMAIL_INVALID };
  }
  return { isValid: true, error: null, value: trimmed };
}

function validatePassword(password) {
  if (password === undefined || password === null) {
    return { isValid: false, error: 'Mật khẩu không được để trống.', code: AUTH_ERROR_CODES.PASSWORD_EMPTY };
  }
  const str = String(password);
  if (str.length === 0) {
    return { isValid: false, error: 'Mật khẩu không được để trống.', code: AUTH_ERROR_CODES.PASSWORD_EMPTY };
  }
  if (str.length < 8) {
    return { isValid: false, error: 'Mật khẩu phải có độ dài tối thiểu 8 ký tự.', code: AUTH_ERROR_CODES.PASSWORD_TOO_SHORT };
  }
  const hasLetter = /[A-Za-z]/.test(str);
  const hasNumber = /\d/.test(str);
  if (!hasLetter || !hasNumber) {
    return { isValid: false, error: 'Mật khẩu phải bao gồm cả chữ cái và chữ số.', code: AUTH_ERROR_CODES.PASSWORD_MISSING_ALPHA_OR_NUM };
  }
  return { isValid: true, error: null, value: str };
}

function validateConfirmPassword(password, confirmPassword) {
  const passCheck = validatePassword(password);
  if (!passCheck.isValid) return passCheck;

  if (password !== confirmPassword) {
    return { isValid: false, error: 'Mật khẩu xác nhận không trùng khớp.', code: AUTH_ERROR_CODES.PASSWORD_MISMATCH };
  }
  return { isValid: true, error: null };
}

function validateUsername(username) {
  if (username === undefined || username === null) {
    return { isValid: false, error: 'Tên đăng nhập không được để trống.', code: AUTH_ERROR_CODES.USERNAME_EMPTY };
  }
  const str = String(username).trim();
  if (str.length === 0) {
    return { isValid: false, error: 'Tên đăng nhập không được để trống.', code: AUTH_ERROR_CODES.USERNAME_EMPTY };
  }
  if (str.length < 3) {
    return { isValid: false, error: 'Tên đăng nhập phải có tối thiểu 3 ký tự.', code: AUTH_ERROR_CODES.USERNAME_TOO_SHORT };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(str)) {
    return { isValid: false, error: 'Tên đăng nhập chỉ bao gồm chữ cái, số, dấu gạch dưới hoặc gạch nối.', code: AUTH_ERROR_CODES.USERNAME_INVALID };
  }
  return { isValid: true, error: null, value: str };
}

function validateDisplayName(displayName) {
  if (displayName === undefined || displayName === null) {
    return { isValid: false, error: 'Tên hiển thị không được để trống.', code: AUTH_ERROR_CODES.DISPLAY_NAME_EMPTY };
  }
  const str = String(displayName).trim();
  if (str.length === 0) {
    return { isValid: false, error: 'Tên hiển thị không được để trống.', code: AUTH_ERROR_CODES.DISPLAY_NAME_EMPTY };
  }
  if (str.length < 2) {
    return { isValid: false, error: 'Tên hiển thị phải có tối thiểu 2 ký tự.', code: AUTH_ERROR_CODES.DISPLAY_NAME_TOO_SHORT };
  }
  if (str.length > 50) {
    return { isValid: false, error: 'Tên hiển thị không được vượt quá 50 ký tự.', code: AUTH_ERROR_CODES.DISPLAY_NAME_TOO_LONG };
  }
  return { isValid: true, error: null, value: str };
}

/**
 * COT-579 AC 1 & 2: Validate toàn bộ form Đăng ký
 */
function validateRegisterForm({ username, displayName, email, password, confirmPassword } = {}) {
  const errors = {};

  const uCheck = validateUsername(username);
  if (!uCheck.isValid) errors.username = uCheck;

  const dCheck = validateDisplayName(displayName);
  if (!dCheck.isValid) errors.displayName = dCheck;

  const eCheck = validateEmail(email);
  if (!eCheck.isValid) errors.email = eCheck;

  const pCheck = validatePassword(password);
  if (!pCheck.isValid) errors.password = pCheck;

  const cCheck = validateConfirmPassword(password, confirmPassword);
  if (!cCheck.isValid) errors.confirmPassword = cCheck;

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * COT-579 AC 1 & 2: Validate toàn bộ form Đăng nhập
 */
function validateLoginForm({ username, password } = {}) {
  const errors = {};

  if (!username || !String(username).trim()) {
    errors.username = { isValid: false, error: 'Vui lòng nhập tên đăng nhập hoặc email.', code: AUTH_ERROR_CODES.USERNAME_EMPTY };
  }

  if (!password || !String(password).trim()) {
    errors.password = { isValid: false, error: 'Vui lòng nhập mật khẩu.', code: AUTH_ERROR_CODES.PASSWORD_EMPTY };
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * COT-585 AC 2: Validate File Avatar trước khi upload (Dung lượng <= 2MB, định dạng JPG/PNG/WebP)
 */
function validateAvatarFile(file) {
  if (!file) {
    return { isValid: false, error: 'Vui lòng chọn một tệp ảnh đại diện.', code: AUTH_ERROR_CODES.FILE_EMPTY };
  }

  // Dung lượng tối đa: 2MB = 2 * 1024 * 1024 = 2,097,152 bytes
  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: 'Dung lượng ảnh đại diện vượt quá 2MB. Vui lòng chọn ảnh nhỏ hơn.',
      code: AUTH_ERROR_CODES.FILE_TOO_LARGE
    };
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  const fileType = file.type ? file.type.toLowerCase() : '';
  const fileName = file.name ? file.name.toLowerCase() : '';
  const hasValidExt = /\.(jpe?g|png|webp)$/i.test(fileName);

  if (!validTypes.includes(fileType) && !hasValidExt) {
    return {
      isValid: false,
      error: 'Định dạng ảnh không được hỗ trợ. Vui lòng chọn ảnh JPG, PNG hoặc WebP.',
      code: AUTH_ERROR_CODES.FILE_INVALID_TYPE
    };
  }

  return { isValid: true, error: null, value: file };
}

function extractResetToken(input) {
  if (!input) return null;
  const str = String(input).trim();
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      const parsed = new URL(str);
      const token = parsed.searchParams.get('token');
      if (token) return token.trim();
    }
  } catch {}

  const match = str.match(/[?&#]token=([^&#\s]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]).trim();
  }

  if (/^[a-zA-Z0-9_-]{16,}$/.test(str)) {
    return str;
  }

  return null;
}

/**
 * =========================================================================
 * COT-581: TOKEN & SESSION STORAGE SERVICE
 * =========================================================================
 */
class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

class TokenStorageService {
  constructor(options = {}) {
    if (options.storage) {
      this.storage = options.storage;
    } else if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    } else {
      this.storage = new MemoryStorage();
    }
    this.TOKEN_KEY = 'cotuong_access_token';
    this.REFRESH_KEY = 'cotuong_refresh_token';
    this.USER_KEY = 'cotuong_user_session';
  }

  saveTokens({ accessToken, refreshToken, user }) {
    if (accessToken) {
      this.storage.setItem(this.TOKEN_KEY, accessToken);
    }
    if (refreshToken) {
      this.storage.setItem(this.REFRESH_KEY, refreshToken);
    }
    if (user) {
      this.storage.setItem(this.USER_KEY, JSON.stringify(user));
    }
  }

  getAccessToken() {
    return this.storage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken() {
    return this.storage.getItem(this.REFRESH_KEY);
  }

  getCurrentUser() {
    const raw = this.storage.getItem(this.USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  setCurrentUser(user) {
    if (user) {
      this.storage.setItem(this.USER_KEY, JSON.stringify(user));
    } else {
      this.storage.removeItem(this.USER_KEY);
    }
  }

  clearTokens() {
    this.storage.removeItem(this.TOKEN_KEY);
    this.storage.removeItem(this.REFRESH_KEY);
    this.storage.removeItem(this.USER_KEY);
  }

  isTokenExpired(token) {
    if (!token) return true;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      let jsonPayload;
      if (typeof atob !== 'undefined') {
        jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      } else if (typeof Buffer !== 'undefined') {
        jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
      } else {
        return false;
      }
      const payload = JSON.parse(jsonPayload);
      if (payload && payload.exp) {
        return payload.exp * 1000 < Date.now();
      }
      return false;
    } catch {
      return false;
    }
  }

  getAuthHeaders() {
    const token = this.getAccessToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }
}

/**
 * =========================================================================
 * AUTH SERVICE (COT-579, COT-580, COT-581)
 * =========================================================================
 */
class AuthService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || (typeof window !== 'undefined' && window.VITE_API_URL ? window.VITE_API_URL : '/api');
    this.tokenStorage = options.tokenStorage || new TokenStorageService();
    this.fetchImpl = options.fetchImpl !== undefined
      ? options.fetchImpl
      : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
    this.onAuthStateChanged = options.onAuthStateChanged || null;
  }

  /**
   * COT-579 AC 1, 2, 4: Đăng ký tài khoản
   * Không tự động đăng nhập sau khi đăng ký thành công
   */
  async register({ username, displayName, email, password, confirmPassword }) {
    const validation = validateRegisterForm({ username, displayName, email, password, confirmPassword });
    if (!validation.isValid) {
      return {
        success: false,
        error: Object.values(validation.errors)[0]?.error || 'Dữ liệu đăng ký không hợp lệ.',
        errors: validation.errors,
        code: Object.values(validation.errors)[0]?.code || 'VALIDATION_ERROR'
      };
    }

    if (!this.fetchImpl) {
      return {
        success: true,
        message: 'Đăng ký tài khoản thành công! Vui lòng chuyển sang Đăng nhập.',
        redirectTo: 'login',
        user: { username, displayName, email }
      };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: validation.errors.username ? username : username.trim(),
          displayName: displayName.trim(),
          email: email.trim(),
          password
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Đăng ký không thành công.',
          code: data.code || 'REGISTER_FAILED'
        };
      }

      return {
        success: true,
        message: data.message || 'Đăng ký tài khoản thành công! Vui lòng chuyển sang Đăng nhập.',
        redirectTo: 'login',
        user: data.user
      };
    } catch (err) {
      return {
        success: false,
        error: 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối mạng.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }

  /**
   * COT-579 AC 1, 2, 5: Đăng nhập hệ thống
   * Hiển thị thông báo chung phù hợp khi đăng nhập thất bại
   */
  async login({ username, password }) {
    const validation = validateLoginForm({ username, password });
    if (!validation.isValid) {
      return {
        success: false,
        error: Object.values(validation.errors)[0]?.error || 'Vui lòng điền đầy đủ thông tin đăng nhập.',
        errors: validation.errors,
        code: Object.values(validation.errors)[0]?.code || 'VALIDATION_ERROR'
      };
    }

    if (!this.fetchImpl) {
      const mockToken = 'mock_jwt_token_' + Date.now();
      const mockUser = {
        id: 'user-' + Date.now(),
        username: username.trim(),
        displayName: username.trim(),
        elo: 1000,
        avatar: username.trim().charAt(0).toUpperCase()
      };
      this.tokenStorage.saveTokens({ accessToken: mockToken, user: mockUser });
      if (this.onAuthStateChanged) this.onAuthStateChanged(mockUser);
      return {
        success: true,
        token: mockToken,
        user: mockUser
      };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // COT-579 AC 5: Đăng nhập thất bại hiển thị thông báo chung an toàn
        return {
          success: false,
          error: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
          code: AUTH_ERROR_CODES.INVALID_CREDENTIALS
        };
      }

      const token = data.token || data.accessToken;
      const user = data.user || {
        id: data.userId || 'user-default',
        username: username.trim(),
        displayName: data.displayName || username.trim(),
        elo: data.elo || data.eloRating || 1000,
        avatar: data.avatarUrl || username.trim().charAt(0).toUpperCase()
      };

      this.tokenStorage.saveTokens({ accessToken: token, refreshToken: data.refreshToken, user });
      if (this.onAuthStateChanged) this.onAuthStateChanged(user);

      return {
        success: true,
        token,
        user,
        message: 'Đăng nhập thành công!'
      };
    } catch (err) {
      return {
        success: false,
        error: 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối mạng.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }

  /**
   * COT-580 AC 2 & 3: Đăng nhập nhanh OAuth (Google / Facebook)
   */
  async loginWithOAuth(provider, { credential, accessToken } = {}) {
    const normProvider = String(provider).toLowerCase();
    if (!['google', 'facebook'].includes(normProvider)) {
      return {
        success: false,
        error: 'Nhà cung cấp OAuth không được hỗ trợ.',
        code: 'UNSUPPORTED_PROVIDER'
      };
    }

    if (!credential && !accessToken) {
      return {
        success: false,
        error: 'Bạn đã hủy quá trình đăng nhập qua ' + (normProvider === 'google' ? 'Google' : 'Facebook') + '.',
        code: AUTH_ERROR_CODES.POPUP_CLOSED_BY_USER
      };
    }

    if (!this.fetchImpl) {
      const mockToken = `mock_oauth_${normProvider}_jwt_${Date.now()}`;
      const mockUser = {
        id: `oauth-${normProvider}-${Date.now()}`,
        username: `${normProvider}_user`,
        displayName: normProvider === 'google' ? 'Kỳ Thủ Google' : 'Kỳ Thủ Facebook',
        elo: 1000,
        avatar: normProvider === 'google' ? 'G' : 'F'
      };
      this.tokenStorage.saveTokens({ accessToken: mockToken, user: mockUser });
      if (this.onAuthStateChanged) this.onAuthStateChanged(mockUser);
      return {
        success: true,
        token: mockToken,
        user: mockUser
      };
    }

    try {
      const endpoint = `${this.baseUrl}/auth/${normProvider}`;
      const payload = normProvider === 'google'
        ? { credential: credential || accessToken }
        : { accessToken: accessToken || credential };

      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `Đăng nhập bằng ${normProvider} không thành công.`,
          code: data.code || AUTH_ERROR_CODES.OAUTH_FAILED
        };
      }

      const token = data.token || data.accessToken;
      const user = data.user || {
        id: data.userId || `oauth-${normProvider}`,
        username: data.username || `${normProvider}_player`,
        displayName: data.displayName || (normProvider === 'google' ? 'Kỳ Thủ Google' : 'Kỳ Thủ Facebook'),
        elo: data.elo || data.eloRating || 1000,
        avatar: data.avatarUrl || (normProvider === 'google' ? 'G' : 'F')
      };

      this.tokenStorage.saveTokens({ accessToken: token, refreshToken: data.refreshToken, user });
      if (this.onAuthStateChanged) this.onAuthStateChanged(user);

      return {
        success: true,
        token,
        user,
        message: `Đăng nhập bằng ${normProvider === 'google' ? 'Google' : 'Facebook'} thành công!`
      };
    } catch (err) {
      return {
        success: false,
        error: 'Lỗi mạng khi kết nối cổng xác thực bên thứ ba.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }

  /**
   * COT-581 AC 2: Đăng xuất khỏi hệ thống
   */
  async logout() {
    const token = this.tokenStorage.getAccessToken();
    if (this.fetchImpl && token) {
      try {
        await this.fetchImpl(`${this.baseUrl}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        }).catch(() => {});
      } catch {}
    }

    this.tokenStorage.clearTokens();
    if (this.onAuthStateChanged) this.onAuthStateChanged(null);
    return {
      success: true,
      message: 'Đăng xuất thành công. Đã chuyển về màn hình Đăng nhập.'
    };
  }

  /**
   * COT-581 AC 1 & 4: Khôi phục phiên làm việc khi tải lại trang
   */
  async restoreSession() {
    const token = this.tokenStorage.getAccessToken();
    if (!token) {
      return { isAuthenticated: false, user: null };
    }

    if (this.tokenStorage.isTokenExpired(token)) {
      this.tokenStorage.clearTokens();
      if (this.onAuthStateChanged) this.onAuthStateChanged(null);
      return { isAuthenticated: false, user: null, reason: AUTH_ERROR_CODES.TOKEN_EXPIRED };
    }

    const cachedUser = this.tokenStorage.getCurrentUser();

    if (this.fetchImpl) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/auth/me`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        });

        if (response.status === 401) {
          // Token không còn hợp lệ trên máy chủ
          this.tokenStorage.clearTokens();
          if (this.onAuthStateChanged) this.onAuthStateChanged(null);
          return { isAuthenticated: false, user: null, reason: AUTH_ERROR_CODES.UNAUTHORIZED };
        }

        if (response.ok) {
          const data = await response.json();
          const user = data.user || cachedUser;
          this.tokenStorage.setCurrentUser(user);
          if (this.onAuthStateChanged) this.onAuthStateChanged(user);
          return { isAuthenticated: true, user };
        }
      } catch {
        // Fallback dùng cachedUser nếu mạng ngắt quãng
      }
    }

    if (cachedUser) {
      if (this.onAuthStateChanged) this.onAuthStateChanged(cachedUser);
      return { isAuthenticated: true, user: cachedUser };
    }

    return { isAuthenticated: false, user: null };
  }

  /**
   * COT-581 AC 3: Chặn nút quay lại (Back Button) truy cập vùng yêu cầu đăng nhập
   */
  handleBrowserNavigationProtection(targetPath) {
    const token = this.tokenStorage.getAccessToken();
    const isProtected = ['/profile', '/room/', '/pve', '/friends'].some(p => targetPath.includes(p));

    if (isProtected && (!token || this.tokenStorage.isTokenExpired(token))) {
      return {
        canAccess: false,
        redirectTo: '/login',
        message: 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.'
      };
    }

    return { canAccess: true };
  }
}

/**
 * =========================================================================
 * COT-585: USER PROFILE & AVATAR SERVICE
 * =========================================================================
 */
class UserProfileService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || (typeof window !== 'undefined' && window.VITE_API_URL ? window.VITE_API_URL : '/api');
    this.tokenStorage = options.tokenStorage || new TokenStorageService();
    this.fetchImpl = options.fetchImpl !== undefined
      ? options.fetchImpl
      : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
    this.onProfileUpdated = options.onProfileUpdated || null;
  }

  async getProfile() {
    const user = this.tokenStorage.getCurrentUser();
    if (!this.fetchImpl) {
      return { success: true, user: user || { username: 'kythu', displayName: 'Kỳ Thủ', elo: 1000, avatar: '棋' } };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/me`, {
        method: 'GET',
        headers: this.tokenStorage.getAuthHeaders()
      });

      if (!response.ok) {
        return { success: false, error: 'Không thể tải thông tin hồ sơ.' };
      }

      const data = await response.json();
      return { success: true, user: data.user };
    } catch {
      return { success: true, user: user };
    }
  }

  /**
   * COT-585 AC 1 & 3: Cập nhật tên hiển thị
   */
  async updateDisplayName(displayName) {
    const validation = validateDisplayName(displayName);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        code: validation.code
      };
    }

    const currentUser = this.tokenStorage.getCurrentUser() || {};
    const updatedUser = { ...currentUser, displayName: validation.value };

    if (!this.fetchImpl) {
      this.tokenStorage.setCurrentUser(updatedUser);
      if (this.onProfileUpdated) this.onProfileUpdated(updatedUser);
      return {
        success: true,
        message: 'Cập nhật tên hiển thị thành công!',
        user: updatedUser
      };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...this.tokenStorage.getAuthHeaders()
        },
        body: JSON.stringify({ displayName: validation.value })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Cập nhật tên hiển thị thất bại.',
          code: data.code || 'UPDATE_FAILED'
        };
      }

      const finalUser = data.user || updatedUser;
      this.tokenStorage.setCurrentUser(finalUser);
      if (this.onProfileUpdated) this.onProfileUpdated(finalUser);

      return {
        success: true,
        message: 'Cập nhật tên hiển thị thành công!',
        user: finalUser
      };
    } catch (err) {
      return {
        success: false,
        error: 'Lỗi mạng khi cập nhật tên hiển thị.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }

  /**
   * COT-585 AC 1, 2, 3: Cập nhật Avatar (<= 2MB, preview trước khi lưu, đồng bộ Header)
   */
  async updateAvatar(file, previewDataUrl = null) {
    const validation = validateAvatarFile(file);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        code: validation.code
      };
    }

    const currentUser = this.tokenStorage.getCurrentUser() || {};
    const newAvatar = previewDataUrl || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : 'avatar_updated');
    const updatedUser = { ...currentUser, avatar: newAvatar, avatarUrl: newAvatar };

    if (!this.fetchImpl || typeof FormData === 'undefined') {
      this.tokenStorage.setCurrentUser(updatedUser);
      if (this.onProfileUpdated) this.onProfileUpdated(updatedUser);
      return {
        success: true,
        message: 'Cập nhật ảnh đại diện thành công!',
        avatarUrl: newAvatar,
        user: updatedUser
      };
    }

    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await this.fetchImpl(`${this.baseUrl}/users/me/avatar`, {
        method: 'POST',
        headers: this.tokenStorage.getAuthHeaders(),
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Tải lên ảnh đại diện thất bại.',
          code: data.code || 'UPLOAD_FAILED'
        };
      }

      const finalUser = {
        ...currentUser,
        avatar: data.avatarUrl || newAvatar,
        avatarUrl: data.avatarUrl || newAvatar
      };

      this.tokenStorage.setCurrentUser(finalUser);
      if (this.onProfileUpdated) this.onProfileUpdated(finalUser);

      return {
        success: true,
        message: 'Cập nhật ảnh đại diện thành công!',
        avatarUrl: data.avatarUrl || newAvatar,
        user: finalUser
      };
    } catch (err) {
      return {
        success: false,
        error: 'Lỗi mạng khi tải lên ảnh đại diện.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }
}

/**
 * =========================================================================
 * COT-583: PASSWORD RESET SERVICE (PRESERVED)
 * =========================================================================
 */
class PasswordResetService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || (typeof window !== 'undefined' && window.VITE_API_URL ? window.VITE_API_URL : '/api');
    this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  }

  async requestForgotPassword(email) {
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return {
        success: false,
        error: emailValidation.error,
        code: emailValidation.code
      };
    }

    if (!this.fetchImpl) {
      return {
        success: true,
        message: SAFE_FORGOT_PASSWORD_MESSAGE
      };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value })
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 429) {
        return {
          success: false,
          error: data.error || 'Bạn đã gửi yêu cầu quá nhanh. Vui lòng chờ ít phút rồi thử lại.',
          code: AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED
        };
      }

      if (response.status === 400 && data.code === 'VALIDATION_ERROR') {
        return {
          success: false,
          error: data.error || 'Dữ liệu email không hợp lệ.',
          code: AUTH_ERROR_CODES.EMAIL_INVALID
        };
      }

      return {
        success: true,
        message: data.message || SAFE_FORGOT_PASSWORD_MESSAGE
      };
    } catch (err) {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }

  async resetPassword({ token, newPassword, confirmPassword }) {
    const validToken = extractResetToken(token);
    if (!validToken) {
      return {
        success: false,
        error: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc thiếu mã xác thực.',
        code: AUTH_ERROR_CODES.TOKEN_MISSING
      };
    }

    const passCheck = validateConfirmPassword(newPassword, confirmPassword);
    if (!passCheck.isValid) {
      return {
        success: false,
        error: passCheck.error,
        code: passCheck.code
      };
    }

    if (!this.fetchImpl) {
      return {
        success: true,
        message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập với mật khẩu mới.'
      };
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: validToken,
          newPassword,
          confirmPassword
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let code = data.code || 'RESET_FAILED';
        let errorMsg = data.error || 'Không thể đặt lại mật khẩu.';

        if (code === 'TOKEN_EXPIRED') {
          errorMsg = 'Liên kết đặt lại mật khẩu đã hết hạn (tối đa 15 phút). Vui lòng yêu cầu cấp lại mã mới.';
        } else if (code === 'TOKEN_ALREADY_USED') {
          errorMsg = 'Liên kết đặt lại mật khẩu này đã được sử dụng trước đó. Mỗi liên kết chỉ dùng được một lần.';
        } else if (code === 'INVALID_TOKEN') {
          errorMsg = 'Mã xác thực không hợp lệ hoặc không tồn tại trong hệ thống.';
        }

        return {
          success: false,
          error: errorMsg,
          code
        };
      }

      return {
        success: true,
        message: data.message || 'Đặt lại mật khẩu thành công. Đang chuyển về màn hình Đăng nhập...'
      };
    } catch (err) {
      return {
        success: false,
        error: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.',
        code: AUTH_ERROR_CODES.NETWORK_ERROR
      };
    }
  }
}

/**
 * =========================================================================
 * EXPORTS (COMMONJS & BROWSER WINDOW)
 * =========================================================================
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AUTH_ERROR_CODES,
    SAFE_FORGOT_PASSWORD_MESSAGE,
    validateEmail,
    validatePassword,
    validateConfirmPassword,
    validateUsername,
    validateDisplayName,
    validateRegisterForm,
    validateLoginForm,
    validateAvatarFile,
    extractResetToken,
    TokenStorageService,
    AuthService,
    UserProfileService,
    PasswordResetService
  };
}

if (typeof window !== 'undefined') {
  window.AUTH_ERROR_CODES = AUTH_ERROR_CODES;
  window.SAFE_FORGOT_PASSWORD_MESSAGE = SAFE_FORGOT_PASSWORD_MESSAGE;
  window.validateEmail = validateEmail;
  window.validatePassword = validatePassword;
  window.validateConfirmPassword = validateConfirmPassword;
  window.validateUsername = validateUsername;
  window.validateDisplayName = validateDisplayName;
  window.validateRegisterForm = validateRegisterForm;
  window.validateLoginForm = validateLoginForm;
  window.validateAvatarFile = validateAvatarFile;
  window.extractResetToken = extractResetToken;
  window.TokenStorageService = TokenStorageService;
  window.AuthService = AuthService;
  window.UserProfileService = UserProfileService;
  window.PasswordResetService = PasswordResetService;
}
