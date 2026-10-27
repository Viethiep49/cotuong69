/**
 * Clean Architecture - Infrastructure API: AuthApi
 * Gọi REST API xác thực: Register, Login, OAuth, Logout, Me (COT-579, COT-580, COT-581).
 */

import { TokenStorage } from '../storage/tokenStorage';

// FE-09: đường dẫn tương đối, dev đi qua proxy Vite
const BASE_URL = import.meta.env?.VITE_API_URL || '/api';

export class AuthApi {
  static async register({ username, displayName, email, password }) {
    const response = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, email, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || 'Đăng ký thất bại.');
      err.code = data.code || 'REGISTER_FAILED';
      throw err;
    }
    return data;
  }

  static async login({ username, password }) {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
      err.code = data.code || 'INVALID_CREDENTIALS';
      throw err;
    }
    return data;
  }

  static async loginWithOAuth(provider, credential) {
    const endpoint = `${BASE_URL}/auth/${provider}`;
    const payload = provider === 'google'
      ? { credential }
      : { accessToken: credential };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `Đăng nhập qua ${provider} thất bại.`);
      err.code = data.code || 'OAUTH_FAILED';
      throw err;
    }
    return data;
  }

  static async logout() {
    const headers = {
      'Content-Type': 'application/json',
      ...TokenStorage.getAuthHeaders()
    };
    try {
      await fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers
      });
    } catch {}
    TokenStorage.clear();
  }

  static async getCurrentUser() {
    const response = await fetch(`${BASE_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...TokenStorage.getAuthHeaders()
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        TokenStorage.clear();
      }
      throw new Error('Phiên đăng nhập hết hạn.');
    }
    return await response.json();
  }
}
