# Hướng dẫn cấu hình Google OAuth (tuỳ chọn)

> SEC-05: Facebook đã bị bỏ khỏi phạm vi. Google là **tuỳ chọn** — không cấu hình thì
> nút "Đăng nhập với Google" bị ẩn và đăng ký/đăng nhập bằng mật khẩu vẫn hoạt động bình thường.

## 1. Tạo OAuth Client ID

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo/chọn project.
2. **APIs & Services → OAuth consent screen**: chọn *External*, điền tên app + email hỗ trợ, thêm scope `email`, `profile`, `openid`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: thêm `http://localhost:3000` (dev) và domain thật khi deploy.
   - (Không cần Authorized redirect URIs vì dùng Google Identity Services trả `credential` trực tiếp.)
4. Copy **Client ID** (dạng `xxxxxxxx.apps.googleusercontent.com`).

## 2. Điền vào 2 file `.env`

`backend/.env`:

```env
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
```

`frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
```

## 3. Hành vi của backend

| Trường hợp | Kết quả |
|---|---|
| `GOOGLE_CLIENT_ID` trống | `POST /api/auth/google` → **503 `OAUTH_DISABLED`** |
| ID token có `aud` khác Client ID | **401 `INVALID_OAUTH_TOKEN`** |
| `iss` không phải `accounts.google.com` | **401 `INVALID_OAUTH_TOKEN`** |
| `email_verified` không phải true | **401 `INVALID_OAUTH_TOKEN`** |
| Token hết hạn | **401 `INVALID_OAUTH_TOKEN`** |
| Email đã tồn tại với tài khoản mật khẩu | **409 `ACCOUNT_EXISTS_LOGIN_REQUIRED`** (không tự liên kết) |
| Token `mock_...` | Chỉ chấp nhận khi `ALLOW_MOCK_OAUTH=true` **và** `NODE_ENV !== 'production'` |

## 4. Dev/demo không có Google Client ID

Đặt trong `backend/.env`:

```env
ALLOW_MOCK_OAUTH=true
NODE_ENV=development
```

Khi đó token dạng `mock_google:<id>:<email>:<name>` được chấp nhận (chỉ để demo, server log cảnh báo lúc khởi động).
