# Cờ Tướng Online

Đồ án môn học: trò chơi Cờ Tướng (Xiangqi) chơi trực tuyến giữa hai người, hoặc với máy.

## Giới thiệu

Ứng dụng cho phép người dùng:

- **Đăng ký, đăng nhập** bằng tên đăng nhập và mật khẩu. Có thể đăng nhập bằng Google (tuỳ chọn, xem [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md)).
- **Chơi PvP online** trong phòng công khai hoặc phòng riêng tư. Phòng công khai có mã 6 chữ số, phòng riêng tư có mã 10 ký tự. Nước đi được đồng bộ qua WebSocket, máy chủ là nơi kiểm tra luật.
- **Chat** trong phòng và **video call** giữa hai người chơi (WebRTC, hình và tiếng truyền trực tiếp giữa hai trình duyệt).
- **Chơi với máy** (PvE) với bot phía máy chủ.
- **Điểm Elo** được cập nhật sau mỗi ván PvP có kết quả.
- **Bạn bè và mời chơi** trực tiếp.

Chi tiết cách hệ thống hoạt động, đặc biệt khi mất mạng, xem [docs/HOAT_DONG_HE_THONG.md](docs/HOAT_DONG_HE_THONG.md).

## Công nghệ

**Backend**

- Node.js 20 trở lên. Không dùng Express: máy chủ HTTP được dựng trực tiếp bằng `http.createServer`, WebSocket dùng thư viện `ws`.
- Cơ sở dữ liệu PostgreSQL, truy cập bằng `pg`.
- Xác thực bằng JWT (`jsonwebtoken`), băm mật khẩu bằng `bcryptjs`.

**Frontend**

- React 18 và Vite 5 cho phần giao diện mới (`frontend/src`).
- Phần giao diện JavaScript thuần cũ vẫn nằm trong `frontend/js` và chạy song song với React.

## Cấu trúc thư mục

- `backend/`: máy chủ API, WebSocket, logic luật cờ, migration và seed dữ liệu.
  - `backend/src/presentation/`: HTTP route và WebSocket hub.
  - `backend/src/domain/`: thực thể (Room, PvE match), luật cờ, Elo.
  - `backend/src/application/`: các use case (đăng ký, đăng nhập, tạo phòng, PvE...).
  - `backend/src/infrastructure/`: truy cập cơ sở dữ liệu, quản lý phòng và người online trong bộ nhớ.
  - `backend/src/migrations/`: các file SQL tạo và sửa bảng.
  - `backend/tests/`: test của backend.
- `frontend/`: ứng dụng giao diện.
  - `frontend/src/`: mã React (ứng dụng mới).
  - `frontend/js/`, `frontend/css/`: giao diện JavaScript thuần cũ.
  - `frontend/tests/`: test của frontend. Test logic chạy bằng `node:test`, test React nằm trong `frontend/tests/react/` và chạy bằng Vitest.
- `docs/`: tài liệu bổ sung (cấu hình OAuth, kế hoạch sửa lỗi, giải thích hoạt động hệ thống).

## Cài đặt và chạy

### 1. Chuẩn bị

- Node.js 20 trở lên (frontend yêu cầu Node 20.19 trở lên).
- PostgreSQL đang chạy, và đã tạo sẵn một database (mặc định tên `co_tuong_db`).

### 2. Backend

```text
cd backend
npm install
```

Sao chép file `backend/.env.example` thành `backend/.env` rồi điền giá trị. Các biến quan trọng:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: thông tin kết nối PostgreSQL. Các biến `DB_POOL_*` là cấu hình pool kết nối.
- `PORT`: cổng của backend, mặc định `5000`. Máy chủ chỉ lắng nghe trên `127.0.0.1`.
- `NODE_ENV`: `development`, `test` hoặc `production`.
- `JWT_SECRET`: khoá ký token, **bắt buộc** và phải dài tối thiểu 32 ký tự. Máy chủ sẽ không khởi động nếu thiếu. Lệnh sinh khoá được ghi ngay trong `.env.example`.
- `ALLOW_MOCK_OAUTH`: chỉ bật `true` khi demo hoặc phát triển. Khi `false`, token OAuth giả bị từ chối.
- `ENABLE_DEMO_MATCH`: bật trận mẫu COT-615 không cần đăng nhập. Chỉ dùng khi demo.
- `DEMO_CLOCK_SECONDS`: thời gian đồng hồ mỗi bên của trận demo, từ 30 đến 3600 giây, mặc định 600.
- `CORS_ORIGINS`: các origin được phép gọi API khác domain, mặc định `http://localhost:3000`.
- `TRUST_PROXY` và `TRUST_PROXY_HOPS`: chỉ bật khi backend đứng sau reverse proxy tin cậy (nginx, Cloudflare...). Khi đó IP người dùng được lấy từ `X-Forwarded-For`.
- `GOOGLE_CLIENT_ID`: client ID của Google OAuth. Để trống thì tắt đăng nhập Google.

Sau đó chạy:

```text
npm run migrate
npm run seed
npm start
```

Lưu ý: máy chủ **không tự chạy migration** khi khởi động, nên cần chạy `npm run migrate` trước. `npm run seed` nạp dữ liệu mẫu.

### 3. Frontend

```text
cd frontend
npm install
```

Có file `frontend/.env.example` với các biến:

- `VITE_API_URL`: mặc định `/api`. Khi phát triển, Vite chuyển tiếp (proxy) các đường dẫn `/api`, `/ws` và `/uploads` sang backend, nên thường không cần đổi.
- `VITE_GOOGLE_CLIENT_ID`: client ID Google dùng ở giao diện. Để trống thì ẩn nút đăng nhập Google.
- `VITE_ICE_SERVERS`: cấu hình STUN/TURN cho WebRTC dạng JSON. Để trống thì dùng STUN mặc định của Google. Cần TURN khi hai người chơi ở sau NAT đối xứng.

Chạy giao diện phát triển:

```text
npm run dev
```

Vite chạy ở cổng **3000** (`http://localhost:3000`) và tự mở trình duyệt. Biến shell `VITE_BACKEND_URL` (mặc định `http://127.0.0.1:5000`) dùng để đổi địa chỉ backend mà Vite proxy tới.

## Chạy trận demo

Trận demo có mã **COT-615**, cần bật `ENABLE_DEMO_MATCH=true` trong `backend/.env` rồi khởi động lại backend.

Để thử hai bên cùng lúc, mở hai cửa sổ trình duyệt (hoặc một cửa sổ thường và một cửa sổ ẩn danh) tại:

```text
http://localhost:3000/?matchId=COT-615
```

Đồng hồ chỉ bắt đầu chạy khi cả hai bên đã kết nối. Khi ván kết thúc, ván mới tự mở sau 10 giây.

## Chạy test

Backend (dùng `node:test` và module `node:sqlite` để test trên cơ sở dữ liệu SQLite trong bộ nhớ, nên cần Node có module này, tức Node 22.5 trở lên):

```text
cd backend
npm test
```

Frontend (chạy cả hai bộ: `node:test` cho logic thuần và Vitest cho component React):

```text
cd frontend
npm test
```

Kiểm tra build production:

```text
cd frontend
npx vite build
```

## Tài liệu liên quan

- [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md): cách cấu hình đăng nhập Google.
- [docs/HOAT_DONG_HE_THONG.md](docs/HOAT_DONG_HE_THONG.md): giải thích hệ thống hoạt động thế nào, gồm xử lý khi mất mạng.
- [docs/CODE_REVIEW_FIX_PLAN.md](docs/CODE_REVIEW_FIX_PLAN.md): lịch sử các lỗi đã phát hiện qua review và cách sửa.
