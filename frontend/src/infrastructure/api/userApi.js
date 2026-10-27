/**
 * Clean Architecture - Infrastructure API: UserApi
 * Gọi REST API cập nhật thông tin hồ sơ và upload Avatar (COT-585).
 */

import { TokenStorage } from '../storage/tokenStorage';

// FE-09: đường dẫn tương đối, dev đi qua proxy Vite
const BASE_URL = import.meta.env?.VITE_API_URL || '/api';

export class UserApi {
  static async updateProfile({ displayName }) {
    const response = await fetch(`${BASE_URL}/users/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...TokenStorage.getAuthHeaders()
      },
      body: JSON.stringify({ displayName })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || 'Cập nhật tên hiển thị thất bại.');
      err.code = data.code || 'UPDATE_PROFILE_FAILED';
      throw err;
    }
    return data;
  }

  static async uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);

    const response = await fetch(`${BASE_URL}/users/me/avatar`, {
      method: 'POST',
      headers: TokenStorage.getAuthHeaders(),
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || 'Tải ảnh đại diện thất bại.');
      err.code = data.code || 'UPLOAD_AVATAR_FAILED';
      throw err;
    }
    return data;
  }
}
