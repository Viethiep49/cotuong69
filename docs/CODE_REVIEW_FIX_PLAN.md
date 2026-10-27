# KẾ HOẠCH SỬA LỖI SAU CODE REVIEW — Cờ Tướng Online (cotuong69)

> Ngày review: 28/10/2026 · Commit: `b2af112` (nhánh `main`)
> Tài liệu này dùng làm **đầu vào cho AI code (DeepSeek)**. Đọc hết phần 0 trước khi sửa bất kỳ dòng nào.

---

## 0. HƯỚNG DẪN CHO AI THỰC HIỆN

### 0.1 Bối cảnh dự án
- **Backend**: Node.js ≥ 20, **không dùng Express** — `http.createServer` thuần + thư viện `ws`, `pg` (PostgreSQL), `jsonwebtoken`, `bcryptjs`, `dotenv`. Entry: `backend/src/server.js`. Test: `cd backend && npm test` (node:test, dùng SQLite in-memory qua `--experimental-sqlite`).
- **Frontend**: React 18 + Vite 5 (`frontend/src`) **chạy song song** với code JS thuần cũ (`frontend/js/*.js`, được `index.html` và `src/main.jsx` nạp). Lobby/đăng nhập/PvE do JS cũ điều khiển; React chỉ render màn hình trận đấu (`?matchId=`). Test: `cd frontend && npm test`.
- **CI**: `.github/workflows/ai-pr-test.yml`, `jira-sync.yml` + script Python trong `.github/scripts/`.
- Hiện trạng test: backend **361/361 pass**, frontend **160/160 pass**, `vite build` thành công. → **Sau mỗi task phải giữ nguyên 100% pass.**

### 0.1b Phạm vi (đồ án môn học) — các quyết định đã chốt
- **Đăng nhập chính = đăng ký/đăng nhập thường** (username + tên hiển thị + email + mật khẩu). **Giữ nguyên** trường email bắt buộc như hiện tại, nhưng **không xác minh email** (không gửi mail kích hoạt). Người chơi đăng ký xong là chơi được ngay. Không đổi schema bảng `users` cho phần này.
- **OAuth**: chỉ Google, và là tuỳ chọn (xem SEC-05). Bỏ Facebook. Token `mock_` chỉ dùng khi dev/demo (xem SEC-01).
- **Quên mật khẩu**: `emailService.js` hiện là stub, không gửi mail thật. Giữ như vậy; khi `NODE_ENV !== 'production'` thì `console.log` link reset ra terminal backend để demo được. Không cần tích hợp SMTP.
- Không đưa vào phạm vi: tách refresh token sang cookie httpOnly (FE-11 phần tuỳ chọn), TURN server thật (FE-07 chỉ cần đọc cấu hình từ env).

### 0.2 Quy tắc bắt buộc
1. Làm **theo thứ tự Phase** (P0 → P1 → P2 → P3). Không nhảy cóc.
2. Mỗi task (mã `SEC-xx`, `BE-xx`, `FE-xx`, `CI-xx`) = **một commit riêng**, message dạng: `fix(SEC-01): <mô tả ngắn>`.
3. Mỗi task phải **thêm ít nhất 1 test** chứng minh lỗi đã được sửa (test fail trước khi sửa, pass sau khi sửa), trừ khi task ghi rõ "không cần test".
4. **Giữ phong cách code hiện có**: CommonJS (`require`) ở backend, comment tiếng Việt, cấu trúc thư mục hiện tại. Không thêm framework mới (Express, Socket.IO, Prisma…) trừ khi task yêu cầu.
5. Không sửa file ngoài phạm vi task. Không xoá test có sẵn trừ khi task yêu cầu (FE-13).
6. Không đọc/in/commit nội dung `backend/.env`.
7. Số dòng ghi trong tài liệu là tại commit `b2af112`; nếu đã lệch do task trước, tìm theo đoạn code được mô tả.
8. Nếu một task cần quyết định nghiệp vụ không có trong tài liệu → dừng lại, ghi `TODO(<mã task>)` và báo lại, **không tự đoán**.

### 0.3 Lệnh kiểm tra sau mỗi task
```bash
cd backend && npm test
cd frontend && npm test && npx vite build
```

---

## PHASE 0 — BẢO MẬT NGHIÊM TRỌNG (làm ngay, chặn mọi việc khác)

### SEC-01 · Mock OAuth token được chấp nhận ở production → chiếm tài khoản bất kỳ
- **File**: `backend/src/application/services/oauthService.js:17-27`, `backend/src/application/useCases/oauthLogin.js:47-56`
- **Lỗi**: Mọi token bắt đầu bằng `mock_` được tin tưởng, không kiểm tra môi trường. Tấn công: `POST /api/auth/google {"credential":"mock_x:999:victim@mail.com:x"}` → nhận JWT của nạn nhân.
- **Quyết định (đồ án)**: GIỮ token `mock_` để demo, nhưng chỉ bật khi được cho phép rõ ràng.
- **Sửa**:
  - Trong `OAuthVerifierService.verify`, nhánh `mock_` chỉ chạy khi `process.env.ALLOW_MOCK_OAUTH === 'true'` **và** `process.env.NODE_ENV !== 'production'`. Ngược lại token `mock_` bị xử lý như token thật (→ xác thực thất bại, 401).
  - Thêm `ALLOW_MOCK_OAUTH=false` và `NODE_ENV=development` vào `backend/.env.example`, kèm comment: "Chỉ bật true khi demo/dev, KHÔNG bật khi deploy".
  - Test `backend/tests/oauth.test.js`: set `process.env.ALLOW_MOCK_OAUTH = 'true'` trong setup; thêm test: khi biến này không bật → token `mock_` bị từ chối.
  - Log cảnh báo 1 lần khi server khởi động với mock OAuth đang bật: `console.warn('[OAuth] MOCK OAUTH ĐANG BẬT — chỉ dùng cho dev/demo')`.
- **Chấp nhận**: mặc định (không set biến) gọi API với `credential: "mock_..."` → 401. Khi `ALLOW_MOCK_OAUTH=true` ở dev → đăng nhập mock hoạt động như cũ. Test oauth vẫn pass.

### SEC-02 · JWT secret hardcode, `.env` không có `JWT_SECRET` → ai cũng giả mạo được token
- **File**: `backend/src/application/services/tokenService.js:3`, `backend/.env.example`, `backend/src/server.js`, `backend/src/config/db.js`
- **Lỗi**: `process.env.JWT_SECRET || 'cotuong69-jwt-secret-key-2026'` — secret công khai trong source đang là secret thật. `dotenv` chỉ được nạp trong `config/db.js` → phụ thuộc thứ tự `require`.
- **Sửa**:
  - Dòng đầu tiên của `server.js`: `require('dotenv').config();`
  - `tokenService.js`: đọc secret lười (trong hàm), nếu thiếu hoặc `< 32` ký tự → `throw new Error('JWT_SECRET chưa được cấu hình (>= 32 ký tự)')`. Server phải **không khởi động** được khi thiếu.
  - `jwt.verify(token, secret, { algorithms: ['HS256'] })`; `jwt.sign(..., { algorithm: 'HS256' })`.
  - Thêm `JWT_SECRET=` (kèm ghi chú cách sinh: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) vào `.env.example`.
  - Trong test, set `process.env.JWT_SECRET` trong helper/setup.
  - Bỏ `email` khỏi payload JWT (chỉ giữ `id`, `username`).
- **Chấp nhận**: token ký bằng `'cotuong69-jwt-secret-key-2026'` bị từ chối; thiếu `JWT_SECRET` → server thoát với thông báo rõ ràng.

### SEC-03 · Server sập khi nhận input xấu (DoS không cần đăng nhập)
Không có `process.on('unhandledRejection'|'uncaughtException')`, không có `ws.on('error')`. Mỗi lỗi dưới đây **kill toàn bộ process → mọi ván cờ đang chơi mất**. Đã tái hiện được tất cả.

| # | Vector | File:dòng |
|---|--------|-----------|
| a | `GET /api/rooms/%E0` → `decodeURIComponent` throw trong async handler | `room.routes.js:109,127,152`; `friends.routes.js:140,166` |
| b | WS upgrade `GET /ws/room/%E0` | `roomHub.js:182` |
| c | Frame WS sai (không mask / UTF-8 lỗi / opcode lạ) → `'error'` không có listener | `roomHub.js:54-166`, `server.js:153-168` |
| d | Gửi tin nhắn WS là chuỗi JSON `null` → `payload.type` TypeError | `roomHub.js:240` |
| e | Nước đi toạ độ IN HOA (`{"type":"move","from":"B2","to":"E2"}`) → `movingPiece` undefined → TypeError. Nếu chỉ `to` in hoa (vd `B9`) → quân bị ăn **không bị xoá**, 2 quân cùng 1 ô | `xiangqiRules.js:4` (regex có cờ `/i`), `Room.js:382-387`, `cot615Match.js:115-119` |
| f | `GET /uploads/avatars` (thư mục) → `createReadStream` EISDIR không có handler | `server.js:55-67` |

- **Sửa**:
  1. `server.js`: bọc mọi route handler:
     ```js
     Promise.resolve(handler(req, res)).catch((err) => {
       console.error('[HTTP]', err);
       if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
       res.end(JSON.stringify({ success: false, code: 'INTERNAL_ERROR' }));
     });
     ```
     và thêm `process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));` (chỉ log, không exit).
  2. Viết helper `safeDecode(str)` trả `null` khi lỗi; route trả 400, WS upgrade gọi `socket.destroy()`.
  3. Trong **cả hai** connection handler WS: `socket.on('error', (e) => { console.warn('[WS]', e.message); socket.terminate(); });`
  4. `roomHub.handleMessage`: kiểm tra `payload && typeof payload === 'object' && typeof payload.type === 'string'`, sai → gửi `{type:'error', code:'INVALID_PAYLOAD'}`. Bọc toàn bộ thân `handleMessage` trong try/catch. Tương tự cho handler message ở `server.js`.
  5. Toạ độ: **bỏ cờ `/i`** trong `parsePosition` (chỉ chấp nhận chữ thường), đồng thời ở `Room.applyMove`, `cot615Match.applyMatchMove` và `roomHub.js:343` kiểm tra `typeof from === 'string' && typeof to === 'string'`. Thêm guard `if (!movingPiece) return { accepted:false, error:'INVALID_MOVE' }`.
  6. `/uploads/`: dùng `path.resolve` + kiểm tra `startsWith(root + path.sep)`, `fs.stat` → chỉ phục vụ `isFile()`, gắn `stream.on('error', () => res.destroy())`, thêm header `X-Content-Type-Options: nosniff`.
- **Chấp nhận**: test cho từng vector a–f: server vẫn sống và trả lỗi phù hợp (400/404/error message).

### SEC-04 · CI chạy code PR từ fork với secrets + quyền ghi + tự merge
- **File**: `.github/workflows/ai-pr-test.yml`, `.github/scripts/ai_pr_tester.py`, `.github/scripts/auto_merge_pr.py`, `.github/workflows/jira-sync.yml`, `.github/scripts/jira_sync.py`
- **Lỗi**:
  - `pull_request_target` + checkout `head.sha` (`allow-unsafe-pr-checkout: true`) + `npm install/test` + chạy `ai_pr_tester.py` **từ cây code của PR** với `JIRA_API_TOKEN`, `GEMINI_API_KEY`, `GITHUB_TOKEN (contents: write)`. PR từ fork thêm `postinstall` là đọc được token và push thẳng lên `main`.
  - Auto-merge không cần review người; merge API không truyền `sha` → commit đẩy lên sau khi test vẫn bị merge.
  - `npm test 2>&1 | tee ...` không có `pipefail`, frontend có `|| true` → **test fail vẫn coi là pass**.
  - AI gate "fail open": không có Jira key → exit 0; model `gemini-1.5-flash` đã ngừng → fallback chỉ trả PASSED/WARNING; mọi exception → pass. Tên file & mô tả Jira đưa vào prompt → prompt injection.
  - `jira-sync.yml`: PR từ fork có thể chuyển trạng thái issue Jira bất kỳ; không có `permissions:`.
- **Sửa**:
  1. Tách workflow test sang `on: pull_request`, `permissions: { contents: read }`, **không** truyền secrets, `actions/checkout` với `persist-credentials: false`. Dùng `shell: bash` (có `pipefail`), bỏ `|| true`.
  2. Nếu vẫn cần bước AI/Jira: workflow riêng `on: workflow_run` chỉ đọc artifact, **luôn chạy script từ nhánh base**, không checkout code PR.
  3. **Xoá auto-merge** (hoặc chỉ merge khi: có ≥1 approving review + label `ready-to-merge` do maintainer gắn + `author_association` ∈ {OWNER, MEMBER, COLLABORATOR} + truyền `"sha": head_sha`). Khuyến nghị: xoá, dùng branch protection.
  4. `ai_pr_tester.py`: fail closed (thiếu key / lỗi AI → exit 1 hoặc chỉ comment cảnh báo, không bao giờ là điều kiện merge). Gửi key qua header `x-goog-api-key` thay vì query URL. Đổi sang model Gemini hiện hành (đặt qua biến môi trường `GEMINI_MODEL`).
  5. `jira-sync.yml`: thêm `permissions: {}`/tối thiểu; chỉ xử lý khi `github.event.pull_request.head.repo.full_name == github.repository`; chỉ nhận key prefix `COT-`.
  6. Pin actions theo commit SHA; xoá `allow-unsafe-pr-checkout`.
- **Chấp nhận**: không job nào vừa checkout code PR vừa có secret/quyền ghi; test fail → job fail. (Không cần unit test.)

---

## PHASE 1 — LỖI NGHIÊM TRỌNG VỀ AUTH / DỮ LIỆU / GAME

### SEC-05 · OAuth: chỉ giữ Google (tuỳ chọn), bỏ Facebook, kiểm tra audience
- **File**: `oauthService.js:41-61` (Google), `:78-100` (Facebook), `oauthLogin.js:47-56`, `auth.routes.js` (route Facebook), frontend `js/rooms.js:~1800` (nút Google/Facebook, đang gửi token bịa `google_oauth_token_<ts>`), `index.html` (nút OAuth)
- **Lỗi**: Google `tokeninfo` không kiểm tra `aud`, `iss`, `email_verified` → token của app khác cũng được nhận. Facebook không kiểm `app_id`. Tự động link vào tài khoản mật khẩu có sẵn chỉ vì trùng email.
- **Quyết định (đồ án)**: luồng chính là đăng ký/đăng nhập thường. **Bỏ Facebook** hoàn toàn. Google là **tuỳ chọn**: chỉ hiện khi có cấu hình Client ID.
- **Sửa**:
  1. **Facebook**: xoá route `/api/auth/facebook`, `verifyFacebook` và nút Facebook ở frontend (cùng test liên quan).
  2. **Google — backend**: chỉ chấp nhận khi `process.env.GOOGLE_CLIENT_ID` có giá trị (không có → 503 `OAUTH_DISABLED`). Kiểm `aud === GOOGLE_CLIENT_ID`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `email_verified === 'true' || === true`, `exp` chưa hết. Thêm `GOOGLE_CLIENT_ID=` vào `backend/.env.example`.
  3. **Google — frontend**: dùng Google Identity Services (`<script src="https://accounts.google.com/gsi/client" async>`), `google.accounts.id.initialize({ client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID, callback })`, gửi `response.credential` (ID token) lên `POST /api/auth/google`. Xoá đoạn gửi token bịa `google_oauth_token_<ts>`. Nếu `VITE_GOOGLE_CLIENT_ID` trống → **ẩn nút Google**. Thêm `VITE_GOOGLE_CLIENT_ID=` vào `frontend/.env.example`.
  4. **Không tự link** vào tài khoản đã có mật khẩu: nếu email đã tồn tại với tài khoản thường → trả `ACCOUNT_EXISTS_LOGIN_REQUIRED` (409), frontend hiện "Email này đã đăng ký, vui lòng đăng nhập bằng mật khẩu".
  5. Tạo user + identity trong **1 transaction** (`oauthLogin.js:60-82`).
  6. Ghi vào README hướng dẫn ngắn: tạo OAuth Client ID (loại "Web application") ở Google Cloud Console, thêm `http://localhost:5173` vào "Authorized JavaScript origins", điền vào 2 file `.env`.
- **Chấp nhận**: không cấu hình Client ID → không có nút Google, đăng ký/đăng nhập thường chạy bình thường. Có Client ID → đăng nhập Google thật hoạt động; ID token của client khác bị từ chối.

### BE-01 · Quên mật khẩu luôn lỗi 500 trên PostgreSQL (test che lỗi)
- **File**: `PgPasswordResetRepository.js:31-32, 84`, schema `001_init_schema.sql:43`
- **Lỗi**: cột `is_used BOOLEAN` nhưng SQL dùng `is_used = 1` / `= 0` → Postgres báo `boolean = integer`. Test pass vì adapter SQLite (`config/db.js:102`) đổi BOOLEAN → INTEGER.
- **Sửa**: dùng `TRUE`/`FALSE` (SQLite ≥ 3.23 hiểu TRUE/FALSE). Kiểm tra toàn bộ repository khác có cùng vấn đề (`grep -rn "= 1\|= 0" backend/src/infrastructure`).

### BE-02 · Luồng reset mật khẩu: token plaintext, dùng 2 lần được, không thu hồi phiên
- **File**: `resetPassword.js:45-87`, `forgotPassword.js:43-83`, `PgPasswordResetRepository.js:17, 43-74`, `authMiddleware.js`
- **Sửa**:
  - Lưu `SHA-256(token)` thay vì token thô; tra cứu theo hash.
  - Đổi mật khẩu + đánh dấu token đã dùng trong **1 transaction**, dùng câu lệnh nguyên tử:
    `UPDATE password_reset_tokens SET is_used = TRUE WHERE token_hash = $1 AND is_used = FALSE AND expires_at > NOW() RETURNING user_id`.
  - Xoá OTP `Math.random` không dùng tới (hoặc dùng `crypto.randomInt` nếu thật sự cần).
  - Thêm cột `users.password_changed_at` (migration mới `004_...sql`); JWT có `iat`; `authMiddleware` từ chối token có `iat < password_changed_at` và user có `status !== 'ACTIVE'`.
  - Rate-limit window: thay so sánh chuỗi UTC bằng `created_at >= NOW() - make_interval(mins => $2)` (`PgPasswordResetRepository.js:17`).
  - `forgotPassword` luôn trả cùng một response 200 chung chung (kể cả email không tồn tại / bị rate limit) để không lộ tài khoản.

### BE-03 · Elo PvP bị ghi đè sai (người 1650 Elo thua → còn ~984)
- **File**: `roomHub.js:950-967`, `Room.js:105`, `PgUserRepository.js:96`, `loginUser.js:58`
- **Lỗi**: user WS lấy từ JWT không có Elo → `addParticipant` mặc định `eloRating: 1000`, `updateElo` ghi **giá trị tuyệt đối** tính từ 1000.
- **Sửa**: khi chốt trận, đọc Elo thật từ DB (`findById`) cho cả 2 người, tính delta, cập nhật nguyên tử `UPDATE users SET elo_rating = GREATEST(0, elo_rating + $1) WHERE id = $2`, cả 2 dòng trong 1 transaction.
- Kèm sửa `eloCalculator.js:5-6,13`: dùng `Number.isFinite` thay `Number(r) || 1000` (Elo 0 đang bị coi là 1000); validate `score ∈ {0, 0.5, 1}`.

### BE-04 · Chiếu bí trong phòng PvP không kết thúc trận đúng cách
- **File**: `Room.js:407-412`, `roomHub.js:353-360`
- **Lỗi**: `Room.applyMove` đặt `status='FINISHED'` nhưng hub chỉ broadcast `moveResult`: không có `matchEnded`, không cập nhật Elo, không ghi `room.history`, không xoá `readyStates`; phòng FINISHED từ chối mọi người vào (`Room.js:94`) nhưng vẫn hiện trong danh sách.
- **Sửa**: tạo hàm dùng chung `settleMatch(room, winnerColor, endReason)` trong hub (Elo theo BE-03, push history, broadcast `matchEnded`, `readyStates.clear()`, `status = 'WAITING_OPPONENT'`). Gọi nó từ: chiếu bí, hết nước (`endReason: 'NO_LEGAL_MOVES'` — sửa `Room.js:411` đang luôn ghi `'CHECKMATE'`), timeout (BE-05), xin thua (BE-05), mất kết nối (code hiện có ở `roomHub.js:950+`).

### BE-05 · Server không thực thi đồng hồ, không có xin thua → ván cờ treo vĩnh viễn
- **File**: `Room.js:241-246, 340-359`, `roomHub.js`, `cot615Match.js:106-110`
- **Lỗi**: `turnRemainingSeconds`/`remainingClocks` chỉ để hiển thị, không bao giờ trừ; không có timer kết thúc trận; không có message `resign`. Người đang thua chỉ cần không đi là treo trận. `cot615Match`: hết giờ chỉ từ chối nước đi, không xử thua; làm tròn giây mỗi nước (đi < 1s không mất giờ).
- **Sửa**: mỗi room 1 `setTimeout` theo thời gian còn lại của bên tới lượt → hết giờ gọi `settleMatch(room, opponent, 'TIMEOUT')`; clear/re-arm khi đi nước, pause/resume khi reconnect. Trừ `remainingClocks[color]` theo **mili-giây** mỗi nước. Thêm message `{type:'resign'}` → `settleMatch(room, opponent, 'RESIGN')`. Áp dụng tương tự cho `cot615Match`.

### BE-06 · Hai người cùng rớt mạng → trạng thái reconnect của người đầu bị ghi đè
- **File**: `Room.js:248-270`, `roomHub.js:865-867`
- **Lỗi**: chỉ có 1 `reconnectState` và 1 timer/phòng. Đỏ rớt lúc t0, Đen rớt lúc t0+30 → state Đỏ bị ghi đè, timer Đỏ bị huỷ; Đen vào lại thì ván tiếp tục khi Đỏ vẫn vắng, không còn timer → treo.
- **Sửa**: `reconnectState.bySide = { red: {...}|null, black: {...}|null }`, 1 timer cho mỗi bên. Chỉ resume khi cả 2 có mặt. Cả 2 cùng vắng quá hạn → kết thúc trận theo nhánh SYSTEM_ERROR hiện có.

### BE-07 · Heartbeat tắt ở production, giới hạn payload 100MB, chat/WebRTC không validate
- **File**: `roomHub.js:15, 32, 1118, 469-490, 597-662`, `server.js:18, 173`
- **Sửa**:
  - `new RoomHub({ enableHeartbeat: true })` (hoặc `ws.ping()` + cờ `isAlive`); gọi `roomHub.close()` trong `server.on('close')`.
  - `new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })` ở cả 2 chỗ.
  - Chat: `typeof text === 'string'`, trim, `1 ≤ length ≤ 500`; rate limit token-bucket mỗi socket (vd 5 tin/3 giây).
  - WebRTC relay: `typeof sdp === 'string' && sdp.length < 20000`, giới hạn kích thước candidate; chỉ relay khi `payload.callId === room.videoCall.callId`; offer/answer/candidate chỉ relay khi cuộc gọi đã được chấp nhận.
  - `roomHub.js:416-431`: chỉ `endVideoCall` **sau khi** `kickParticipant` kiểm tra quyền host thành công.

### BE-08 · Rò rỉ bộ nhớ & lạm dụng tài nguyên in-memory
- **File**: `RoomManager.js:11-37`, `createRoom.js:11, 22, 31-37, 51, 61`, `DirectInvitationManager.js:6, 34`, `sendDirectInvitation.js:22, 83`, `emailService.js`
- **Sửa**:
  - Sweeper `setInterval` (vd 60s, `unref()`): đóng phòng không còn socket nào quá N phút / phòng FINISHED cũ; xoá lời mời hết hạn; xoá cache `recentRequests` cũ.
  - `generateCode`: giới hạn số lần thử, hết thì throw.
  - Validate `name` (1–50 ký tự), `maxSpectators` (số nguyên 0–10). Giới hạn mỗi user tối đa N phòng đang mở.
  - Key cache tạo phòng: `${userId}:${requestId}` (hiện tại user khác dùng chung `requestId` sẽ nhận mã phòng riêng tư của bạn).
  - `timeoutSeconds` lời mời: ép số nguyên, clamp 10–120 (hiện tại gửi chuỗi → `Invalid Date` → lời mời không bao giờ hết hạn). Yêu cầu người gửi phải ở trong phòng.
  - `respondDirectInvitation.js:24-36`: chỉ đánh dấu ACCEPTED **sau khi** kiểm tra phòng còn hợp lệ.
  - `emailService.js`: đừng giữ token reset trong mảng toàn cục mãi mãi (giới hạn kích thước hoặc chỉ khi `NODE_ENV==='test'`). Khi `NODE_ENV !== 'production'`, `console.log` link đặt lại mật khẩu để demo (xem 0.1b).

### BE-09 · Trạng thái online không bao giờ được set → mời bạn luôn báo "bạn bè offline"
- **File**: `OnlineUserManager.js` (`setOnline`/`setOffline` không được gọi ở đâu), `sendDirectInvitation.js:219`
- **Sửa**: trong connection handler của roomHub gọi `onlineUserManager.setOnline(userId, 'IN_GAME')`; trong `handleDisconnect` gọi `setOffline` khi user không còn socket nào. Dùng cùng một instance singleton với friends routes.

### BE-10 · Ghế ngồi lấy qua HTTP không bao giờ được trả lại
- **File**: `room.routes.js:150-173` → `Room.addParticipant`
- **Lỗi**: join qua HTTP giữ ghế BLACK mà không cần socket → ai cũng chiếm được ghế phòng công khai mãi mãi.
- **Sửa**: HTTP join chỉ trả "preview" vai trò; chỉ thực sự xếp ghế khi WS kết nối. (Hoặc: ghế không có socket sau 30s thì tự giải phóng.)

### BE-11 · Endpoint trận mẫu COT-615 không xác thực, luôn bật
- **File**: `server.js:130-168`, `cot615Match.js`
- **Sửa**: chỉ đăng ký route `/api/matches/*` khi `process.env.ENABLE_DEMO_MATCH === 'true'` (mặc định tắt). Nếu frontend React vẫn cần → xem FE-01/FE-05 để chuyển sang trận thật trong roomHub.

---

## PHASE 2 — FRONTEND

### FE-01 · Video call gửi signaling tới endpoint không xử lý → cuộc gọi không bao giờ kết nối
- **File**: `frontend/src/application/hooks/useWebRtcCall.js:84,113,124,145,208,219`, `useMatch.js:247-248, 346-351`; backend `server.js:100-103`
- **Lỗi**: message `call:*` gửi lên `/api/matches/:id/ws` (chỉ hiểu `move`) → server trả lỗi "Yêu cầu nước đi không hợp lệ", UI kẹt ở CALLING và hiện lỗi nước đi giả.
- **Sửa**: gửi signaling qua socket roomHub (`/ws/room/:code`) — nơi đã có xử lý `call:*`. Thêm timeout chuông phía client (60s, khớp UI `VideoCallOverlay.jsx:63`). Ở `useMatch.js:247` chỉ map `error` thành `moveError` khi đang có nước đi chờ phản hồi.

### FE-02 · Build production thiếu `/js/pve.js` và `/js/auth.js`; `auth.js` chạy 2 lần
- **File**: `frontend/index.html:945, 1127`, `frontend/src/main.jsx:5-8`
- **Lỗi**: `vite build` giữ thẻ `<script src="/js/...">` nhưng không copy file → 404 → `rooms.js:850` `new window.PveApiService()` throw → PvE hỏng ở production. Dev: `auth.js` vừa là classic script vừa được `import` → chạy 2 lần.
- **Sửa**: xoá 2 thẻ `<script>` trong `index.html`, `import '../js/pve.js'` trong `main.jsx` (giữ `auth.js` import 1 lần). Kiểm tra `dist/` sau build không còn tham chiếu file thiếu.

### FE-03 · Code JS cũ: mọi người đều "đã đăng nhập" với user hardcode
- **File**: `frontend/js/api.js:136-143`, `frontend/js/rooms.js:247-255`
- **Sửa**: `currentUser = null` mặc định; khi `restoreSession()` thất bại gọi `setCurrentUser(null)`. Các nút tạo/vào phòng yêu cầu đăng nhập.

### FE-04 · XSS qua `innerHTML` chưa escape (JS cũ)
- **File**: `frontend/js/rooms.js:1081, 1087, 1096, 1102, 1106, 1314, 1345, 2486, 2490`; hai bản `escapeHtml` trùng ở `rooms.js:1615, 2566`
- **Lỗi**: `msg.senderAvatar`, `msg.timestamp`, `room.code`, `room.status`, `friend.id`… chèn thẳng vào HTML. Avatar dạng `x" onerror="..."` → đánh cắp token trong localStorage.
- **Sửa**: gộp 1 hàm `escapeHtml` dùng chung, escape **mọi** giá trị nội suy (kể cả trong thuộc tính), hoặc tạo node bằng `textContent`/`setAttribute`. URL avatar chỉ chấp nhận `https:` hoặc đường dẫn `/uploads/...`.

### FE-05 · Chat là giả lập: báo "Đã gửi" nhưng đối thủ không nhận
- **File**: `frontend/src/presentation/components/chat/ChatBox.jsx:91-115`, `App.jsx:616-625`; JS cũ `chat.js:135-136, 163`, `rooms.js:2428-2455`
- **Sửa**: nối ChatBox với `chat:send`/`ChatMessage` của roomHub, trạng thái "đã gửi" lấy từ ack server. Trong JS cũ: map user thành bản sao `{ id, name: displayName || username, avatar, role }` (hiện tại `currentUser.name` undefined → TypeError), lưu hàm unsubscribe của `onChatEvent` và gọi trước khi đăng ký lại (đang render tin nhắn N lần).

### FE-06 · Trận đấu React không gửi xác thực; công cụ debug lộ ra production
- **File**: `frontend/src/infrastructure/api/matchApi.js:4-23`, `useMatch.js:123`, `App.jsx:301-337`
- **Sửa**: gắn `Authorization: Bearer` cho `fetchMatch`; xác thực WS (ticket ngắn hạn gửi trong message đầu tiên hoặc `Sec-WebSocket-Protocol`, không để token trong query string — backend `roomHub.js:185` cũng sửa tương ứng). Bọc khối nút debug/mô phỏng bằng `import.meta.env.DEV`.

### FE-07 · WebRTC: race ICE candidate, rò rỉ camera/mic, lỗi không được xử lý
- **File**: `useWebRtcCall.js:19, 63-152, 170-246`, `webRtcPeerConnection.js:13-18, 113-123`, `useMatch.js:223-225`, `VideoCallOverlay.jsx:113-130`
- **Sửa**:
  - Hàng đợi ICE candidate cho tới khi `pc.remoteDescription` có, rồi flush; tuần tự hoá `handleSignalingMessage` bằng promise chain.
  - Dùng ref trạng thái/epoch, kiểm tra lại sau mỗi `await`; dừng stream cũ trước khi thay; từ chối cuộc gọi mới khi đang có cuộc gọi; chặn double-click `startCall`.
  - `.catch` cho handler async → `cleanupCall()`; theo dõi `connectionstatechange` (`failed` → kết thúc).
  - ICE servers đọc từ env (`VITE_ICE_SERVERS` JSON), hỗ trợ TURN.
  - Unmount gửi `call:leave`; `endCall` vẫn gửi huỷ khi `callId` còn null.
  - Thẻ `<audio>` riêng cho âm thanh đối phương (đừng unmount khi cam off).

### FE-08 · Các lỗi React khác
- `useMatch.js:83-85`: sự kiện `online` mở khoá bàn cờ khi WS vẫn đóng → suy `selfDisconnected` từ trạng thái socket, `online` kích hoạt reconnect ngay; báo lỗi khi `sendMove` trả `false`.
- `useMatch.js:167-168`: `readOnly: message.readOnly ?? !isMatchColor(message.color)` (khán giả đang bị coi là người chơi khi thiếu trường).
- `useMatch.js:304`: bỏ `reconnectManager.destroy()` khỏi cleanup của effect kết nối (xoá luôn listener UI).
- `useMatch.js:269-290`: backoff có jitter, dừng khi lỗi 4xx/close code xác thực.
- `matchApi.js:17`: kiểm `response.ok`/content-type trước khi `.json()`.
- `App.jsx:180-221`: tính khay quân bị bắt từ bàn cờ (`BoardSyncManager.deriveCapturedPieces(match.board)`) thay vì cộng dồn từ `lastMove` (sai khi reload).
- `App.jsx:90-107`: dùng 1 `AudioContext` dùng chung, `resume()` ở thao tác đầu tiên của người dùng.

### FE-09 · URL API hardcode / lệch nhau giữa React và JS cũ
- **File**: `matchApi.js:1`, `authApi.js:8`, `userApi.js:8`, `js/auth.js:348, 691, 866`, `js/pve.js:73`, `vite.config.js`
- **Sửa**: dùng đường dẫn tương đối `/api` + `server.proxy` trong `vite.config.js` cho dev (`/api` và `/ws` → `http://localhost:5000`, `ws: true`). JS cũ đọc `import.meta.env.VITE_API_URL ?? '/api'` (các file đã được import dạng ESM). Bỏ biến `VITE_WS_URL` không dùng hoặc dùng nó thật.

### FE-10 · PvE: backend có use case nhưng không có route; frontend giả lập toàn bộ
- **File**: backend `application/use-cases/game/pve/*` (không được wire), frontend `js/pve.js:71-200`, `js/rooms.js:699, 754, 850-867`
- **Sửa (backend)**: thêm `presentation/http/routes/pve.routes.js`: `POST /api/pve/matches` (tạo), `POST /api/pve/matches/:id/moves` (người đi → **gọi luôn `playBotTurn`** và trả về cả nước bot), `POST /api/pve/matches/:id/resign`, `GET /api/pve/matches/:id`. Tất cả yêu cầu đăng nhập và kiểm quyền sở hữu qua `loadOwnedMatch`. Không expose `playBotTurn`/`checkPveTimeout` trực tiếp. Thêm sweeper định kỳ: trận PLAYING tới lượt bot → `playBotTurn`; còn lại → `checkPveTimeout`. Giới hạn số trận PLAYING/user.
- **Sửa (frontend)**: `pve.js` gọi API thật; dùng **một** instance `PveApiService` dùng chung (hiện tạo trận trên instance tạm, xin thua trên `pveSharedApi` → luôn lỗi rồi bịa kết quả LOSS); chỉ fallback với mã lỗi cụ thể.
- **Atomic**: `applyAndPersistMove.js:95-125` tính trạng thái ván **trước** khi lưu, truyền `{status, result, endReason, finishedAt}` vào `saveMove` để ghi trong cùng transaction.

### FE-11 · Token & dữ liệu nhạy cảm phía client
- **File**: `js/auth.js:253-268, 310-329, 651-660`, `src/infrastructure/storage/tokenStorage.js`, `js/rooms.js:2348-2356`
- **Sửa**: sau khi đọc `?token=` reset mật khẩu gọi `history.replaceState` xoá khỏi URL; `isTokenExpired` coi token không parse được là hết hạn. (Tuỳ chọn, cần sửa backend: refresh token trong cookie httpOnly SameSite, access token giữ trong bộ nhớ.)

---

## PHASE 3 — CHẤT LƯỢNG, DỌN DẸP, SCHEMA

### BE-12 · Trả lỗi nội bộ thô cho client
- **File**: `auth.routes.js:224, 252, 283-286`, `user.routes.js:173, 214`, `room.routes.js:97, 170`, `friends.routes.js:87, 111, 153, 171`, `oauthService.js:70, 109`, `core/errors/AppError.js`
- **Sửa**: mở rộng `AppError` với các mã auth/user/friends/room; chỉ trả `err.message` khi là `AppError` (hoặc có `statusCode` do mình đặt); còn lại log và trả 500 `INTERNAL_ERROR`. Không trả 400/401 cho lỗi DB.

### BE-13 · Không giới hạn tần suất (brute force) & lộ tài khoản
- **File**: `auth.routes.js:107-255`, `room.routes.js` (tra mã phòng), `loginUser.js:38-51`
- **Sửa**: tạo `presentation/http/middlewares/rateLimiter.js` (sliding window in-memory theo IP và theo username; vd login 10 lần/15 phút, register 5/giờ, tra mã phòng 30/phút) trả 429. Login: khi user không tồn tại vẫn `bcrypt.compare` với hash giả (chống timing); kiểm `ACCOUNT_INACTIVE` **trước** khi so mật khẩu… nhưng trả cùng thông báo chung "Sai thông tin đăng nhập". bcrypt cost 12. Giới hạn mật khẩu tối đa 72 byte.

### BE-14 · Phòng riêng tư đoán được mã
- **File**: `RoomManager.js:12`, `roomHub.js:73`
- **Sửa**: mã phòng riêng tư 10 ký tự base32 (`crypto.randomBytes`) hoặc thêm `inviteToken` riêng bắt buộc khi vào phòng riêng tư. Kết hợp rate limit BE-13.

### BE-15 · Upload avatar
- **File**: `profileValidator.js:38-48`, `user.routes.js:42-50, 121-122`, `uploadAvatar.js:33-37`
- **Sửa**: kiểm magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`) thay vì tin MIME/đuôi file; `Number.isSafeInteger(userId)` trước khi ghép vào tên file; xoá avatar cũ; dùng `fs.promises`; sửa thông báo 2MB/3MB cho khớp (`parseRawBody` cho 3MB nhưng báo 2MB).

### BE-16 · Validate input
- **File**: `authValidator.js:24-27`, `profileValidator.js:12-21`, `PgUserRepository.js`
- **Sửa**: thống nhất rule display name khi đăng ký và khi sửa hồ sơ (≤ 50 ký tự, cùng danh sách từ cấm — hiện đăng ký được tên "admin"); danh sách từ cấm so khớp theo từ, không theo chuỗi con ("vl" chặn nhầm "Vladimir"); loại ký tự điều khiển; username unique không phân biệt hoa thường (index `LOWER(username)`); `redirectUrl` (`loginUser.js:77`, `oauthLogin.js:119`) chỉ chấp nhận đường dẫn nội bộ `^/(?!/)`; `PgFriendRepository.js:25,38` không trả email của bạn bè.

### BE-17 · Migration không transaction, không idempotent
- **File**: `migrations/migrate.js:49-53, 206-210`, `003_pve_turn_started_at.sql:6`
- **Sửa**: mỗi file migration chạy trong `BEGIN … COMMIT` trên 1 client riêng, kèm `SELECT pg_advisory_xact_lock(<hằng số>)`; ghi lịch sử migration trong cùng transaction. `ADD COLUMN IF NOT EXISTS`. Không tách câu lệnh bằng `split(';')` (để Postgres chạy cả file một lần).

### BE-18 · Schema
- Migration mới (`005_...sql`):
  - `friends`: unique đối xứng `CREATE UNIQUE INDEX ... ON friends (LEAST(user_id, friend_id), GREATEST(user_id, friend_id))`.
  - Xoá `idx_users_username`, `idx_users_email` trùng với UNIQUE (`001:81-82`).
  - CHECK cho `users.status`, `friends.status`, `elo_rating >= 0`.
  - Bảng `pvp_matches` lưu kết quả trận PvP (hiện chỉ ở `room.history` trong RAM, mất khi restart) — dùng trong `settleMatch` (BE-04).

### BE-19 · SQLite adapter: transaction đè nhau khi chạy song song
- **File**: `config/db.js:55-60`, `PgPveMatchRepository.js:155-168`
- **Sửa**: mutex async quanh `getClient()` của SQLite (một transaction tại một thời điểm), hoặc ghi rõ SQLite chỉ dùng cho test và chặn khi `NODE_ENV==='production'`.

### BE-20 · Hoà cờ
- **File**: `PveMatch.js:23-26`, `002_pve_matches.sql:29`, `Room.js`
- **Cần quyết định nghiệp vụ** (đánh dấu `TODO(BE-20)` nếu chưa có): thêm kết quả `DRAW`, giới hạn số nước / số nước không ăn quân, hoà khi không đủ quân chiếu bí, phát hiện lặp nước. Tối thiểu: thêm `DRAW` vào enum + CHECK constraint và một giới hạn số ply (vd 300).

### CLEAN-01 · Hai bộ luật cờ song song
- `domain/entities/xiangqiRules.js` (PvP, dạng chuỗi "e3") và `domain/rules/*` (PvE, lưới `{row,col}`) hiện cho kết quả giống nhau (đã đối chiếu 300 ván ngẫu nhiên), chỉ khác khi thiếu Tướng (`isInCheck` trả true vs false). Chuyển PvP sang dùng `domain/rules/*` qua adapter, giữ 1 nguồn duy nhất.

### CLEAN-02 · Code chết / trùng lặp ở frontend
- Không được import ở đâu: `LobbyLayout`, `UserProfileBar`, `components/pve/*`, `authApi.js`, `userApi.js`, `tokenStorage.js`, `usePveGame.js`, `useLocalMedia.js`, `ForgotPasswordModal.jsx`, `ResetPasswordModal.jsx`; dependency `react-router-dom` không dùng. Một số file này `import { X } from '../js/pve.js'` — sẽ làm **vỡ build** ngay khi được import vì `js/*.js` không có `export`.
- Các component này trùng 49 id DOM với `index.html` → mount vào sẽ làm `rooms.js` bám sai node.
- **Quyết định**: chọn 1 hướng (khuyến nghị: giữ JS cũ đang chạy, **xoá** bản React chết; hoặc lên kế hoạch migrate dần sang React ở task riêng). Thêm `export` thật vào `js/*.js` nếu React cần dùng.

### CLEAN-03 · Thư mục trùng `useCases/` vs `use-cases/`
- `backend/src/application/use-cases/{auth,friends,room,user}` chỉ có `.gitkeep`; code thật ở `application/useCases/`, riêng PvE ở `use-cases/game/pve`. Gộp về **một** tên (`use-cases/` theo `ARCHITECTURE.md`), sửa toàn bộ `require`. Xoá các `.gitkeep` không còn cần.

### CLEAN-04 · Test frontend không test code thật
- `tests/video-call-ui.test.js` (AC 2.3, 3.2, 4.1–4.3) tự định nghĩa hàm rồi test chính hàm đó; `lobby`/`pve-*` chỉ kiểm file tồn tại/chứa chuỗi; `chat.test.js` test `js/chat.js` mà ChatBox React không dùng.
- **Sửa**: thêm Vitest + React Testing Library, viết test cho `useMatch`, `useWebRtcCall`, `XiangqiBoard`, `ChatBox`; xoá test tautology. Thêm `"engines": { "node": ">=20.19" }` vào `frontend/package.json`.

### CLEAN-05 · Linh tinh
- `.gitignore` (root, backend, frontend): thêm `.env.*` + `!.env.example`; xoá BOM UTF-8 đầu `frontend/.gitignore` (dòng 1 `node_modules/` đang không có tác dụng).
- CORS `Access-Control-Allow-Origin: *` ở mọi route → đọc whitelist từ env `CORS_ORIGINS`.
- `ARCHITECTURE_FRONTEND.md`: đoạn "Màn hình tải snapshot…" bị lặp 2 lần.

---

## PHỤ LỤC A — Những phần đã kiểm tra và ỔN (không cần sửa)
- Toàn bộ SQL dùng tham số `$n` → không có SQL injection.
- Luật cờ: cung Tướng/Sĩ, Tượng không qua sông & bị chặn mắt, Mã bị cản chân, Pháo ăn qua đúng 1 ngòi, Tốt chỉ đi ngang sau khi qua sông và không lùi, lộ mặt Tướng, cấm tự chiếu, hết nước = thua — **đều đúng**. Hệ toạ độ thống nhất (hàng 0 = hàng cuối của Đỏ, cột 0 = `a`).
- PvE trên Postgres: double-submit và race người/bot an toàn nhờ cập nhật có điều kiện theo `ply` + `UNIQUE(match_id, ply)`; timeout dùng `expectedPly`; kiểm quyền sở hữu qua `loadOwnedMatch`; bot chỉ chọn nước hợp lệ.
- Token reset dùng `crypto.randomBytes(32)`, hết hạn 15 phút. Quyền respond/cancel lời mời kết bạn đúng.
- React không dùng `dangerouslySetInnerHTML`; tên người chơi/chat được React escape. Phép lật bàn cờ (Đỏ/Đen) trong `XiangqiBoard.jsx` đúng.
- Workflow không nội suy `${{ github.event.* }}` trực tiếp trong `run:` (đã qua `env:`).

## PHỤ LỤC B — Checklist tiến độ
- [x] SEC-01 · [x] SEC-02 · [x] SEC-03 · [x] SEC-04
- [x] SEC-05 · [x] BE-01 · [x] BE-02 · [x] BE-03 · [x] BE-04 · [x] BE-05 · [x] BE-06 · [ ] BE-07 · [ ] BE-08 · [ ] BE-09 · [ ] BE-10 · [x] BE-11
- [ ] FE-01 · [ ] FE-02 · [ ] FE-03 · [ ] FE-04 · [ ] FE-05 · [ ] FE-06 · [ ] FE-07 · [ ] FE-08 · [ ] FE-09 · [ ] FE-10 · [ ] FE-11
- [ ] BE-12 · [ ] BE-13 · [ ] BE-14 · [ ] BE-15 · [ ] BE-16 · [ ] BE-17 · [ ] BE-18 · [ ] BE-19 · [ ] BE-20
- [ ] CLEAN-01 · [ ] CLEAN-02 · [ ] CLEAN-03 · [ ] CLEAN-04 · [ ] CLEAN-05

**Lưu ý vận hành**: vì secret JWT mặc định đã công khai trong source, sau khi xong SEC-02 phải đặt `JWT_SECRET` mới trên mọi môi trường (mọi token cũ sẽ mất hiệu lực — đây là điều mong muốn). Nếu repo GitHub từng public hoặc có PR từ fork chạy qua workflow `ai-pr-test.yml`, hãy **xoay vòng (rotate) `JIRA_API_TOKEN` và `GEMINI_API_KEY`**.
