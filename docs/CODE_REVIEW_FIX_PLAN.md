# KẾ HOẠCH SỬA LỖI SAU CODE REVIEW — Cờ Tướng Online (cotuong69)

> Ngày review: 28/10/2026 · Commit: `b2af112` (nhánh `main`)
> **Review lần 2 (sau đợt sửa 1)**: commit `fec60ae` — xem **mục 0.4** và **PHASE 4** trước tiên.
> Tài liệu này dùng làm **đầu vào cho AI code (DeepSeek)**. Đọc hết phần 0 trước khi sửa bất kỳ dòng nào.

---

## 0. HƯỚNG DẪN CHO AI THỰC HIỆN

### 0.1 Bối cảnh dự án
- **Backend**: Node.js ≥ 20, **không dùng Express** — `http.createServer` thuần + thư viện `ws`, `pg` (PostgreSQL), `jsonwebtoken`, `bcryptjs`, `dotenv`. Entry: `backend/src/server.js`. Test: `cd backend && npm test` (node:test, dùng SQLite in-memory qua `--experimental-sqlite`).
- **Frontend**: React 18 + Vite 5 (`frontend/src`) **chạy song song** với code JS thuần cũ (`frontend/js/*.js`, được `index.html` và `src/main.jsx` nạp). Lobby/đăng nhập/PvE do JS cũ điều khiển; React chỉ render màn hình trận đấu (`?matchId=`). Test: `cd frontend && npm test`.
- **CI**: `.github/workflows/ai-pr-test.yml`, `jira-sync.yml` + script Python trong `.github/scripts/`.
- Hiện trạng test (tại `fec60ae` + thay đổi BE-14 chưa commit): backend **473/473 pass**, frontend **184/184 pass**, `vite build` thành công. → **Sau mỗi task phải giữ nguyên 100% pass.**

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
5. Không sửa file ngoài phạm vi task. Không xoá test có sẵn trừ khi task yêu cầu (CLEAN-04).
6. Không đọc/in/commit nội dung `backend/.env`.
7. Số dòng ghi trong tài liệu là tại commit `b2af112`; nếu đã lệch do task trước, tìm theo đoạn code được mô tả.
8. Nếu một task cần quyết định nghiệp vụ không có trong tài liệu → dừng lại, ghi `TODO(<mã task>)` và báo lại, **không tự đoán**.

### 0.3 Lệnh kiểm tra sau mỗi task
```bash
cd backend && npm test
cd frontend && npm test && npx vite build
```

### 0.4 Trạng thái sau đợt sửa 1 & thứ tự làm tiếp (review lần 2 — 28/10/2026)

**Báo cáo cuối của DeepSeek ở đợt 1 (trích nguyên văn):**

> Commit BE-14 (mình viết thêm test rồi commit) → 31/41.
>
> 1. Bỏ thay đổi dở (`git checkout -- backend/src/.../RoomManager.js`) → quay về đúng 30/41 đã commit.
> 2. Để nguyên, không làm gì thêm.
>
> Ngoài ra nếu muốn tiếp tục plan thì nói rõ, mình sẽ làm 10 task còn lại (FE-01/05/06/07/08/10, BE-14, CLEAN-01→04).

**Trả lời / quyết định:**
- **Không revert BE-14.** Phần backend trong `RoomManager.js` (đang chưa commit) đã đúng: mã 10 ký tự Crockford base32, `crypto.randomBytes`, không lệch phân phối. Nhưng chưa xong, phải làm thêm 2 việc trước khi commit:
  - Viết test cho `generatePrivateCode` / tạo phòng riêng tư.
  - Sửa frontend `frontend/src/presentation/components/lobby/LobbyNavigation.jsx:31, 98, 101`. File này đang ép mã phòng là đúng 6 chữ số (regex `/^\d{6}$/`, `maxLength={6}`, xoá ký tự không phải số), nên không ai gõ được mã riêng tư. Phải cho phép **6 chữ số HOẶC 10 ký tự base32** (không phân biệt hoa/thường, tự chuyển thành chữ hoa).
  - Xem chi tiết ở BE-14 bên dưới.
- Số task còn lại là **11**, không phải 10: FE-01, FE-05, FE-06, FE-07, FE-08, FE-10, BE-14, CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04.
- **Tiếp tục plan, nhưng theo thứ tự mới:**
  1. Hoàn thiện **BE-14** như trên và commit **trước tiên**. Đang có thay đổi chưa commit trong working tree; nếu làm task khác trước, thay đổi này dễ bị gộp nhầm vào commit khác. Trước mỗi commit chạy `git status` và chỉ `git add` đúng file của task.
  2. **PHASE 4 (REV-01 → REV-19)**: sửa các lỗi/thiếu sót phát hiện ở review lần 2. Đây là ưu tiên cao vì có lỗi xử thắng sai và có hồi quy.
  3. Các task Phase 2 còn lại: FE-06 → FE-08 → FE-07 → FE-01 → FE-05 → FE-10.
  4. CLEAN-01 → CLEAN-04.

**Kết quả review lần 2, từng task đã tick:**

| Kết quả | Task |
|---|---|
| ✅ Đạt | SEC-01, SEC-02, SEC-03 (đã tấn công thử trên server thật, cả 6 vector đều không làm sập), SEC-04, BE-01, BE-03, BE-09/BE-10, BE-11, BE-15, BE-19, FE-02, FE-09, FE-11 |
| ⚠️ Thiếu một phần (phần còn thiếu nằm trong PHASE 4) | SEC-05, BE-02, BE-04/BE-05, BE-07, BE-08, BE-13, BE-16, BE-17, BE-18, BE-20, FE-03, FE-04, CLEAN-05 |
| ❌ Sai / gây lỗi mới | BE-06 (→ REV-01), BE-12 (→ REV-03) |

Không phát hiện test nào bị xoá hoặc làm yếu sai quy định.

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
- **Cập nhật sau review lần 2 — phụ thuộc**:
  - Lobby JS cũ vẫn là giả lập, nên màn hình trận React hiện chỉ có `matchId` (trận demo `COT-615`), không có mã phòng roomHub. Chủ dự án demo trên **1 máy, 2 trình duyệt** qua `http://localhost:3000/?matchId=COT-615`.
  - Cách làm:
    - Nếu URL có `roomCode`: dùng socket roomHub.
    - Nếu chỉ có `matchId` (demo): thêm relay `call:*` vào **WS trận demo** trong `server.js`. Chỉ relay giữa 2 người cầm Đỏ/Đen, không gửi cho khán giả. Áp dụng cùng giới hạn như BE-07: SDP < 20000 ký tự, khớp `callId`, chỉ relay offer/answer/candidate sau khi cuộc gọi đã được chấp nhận.
  - Lưu ý khi test trên 1 máy: hai trình duyệt dùng chung một webcam, bên thứ hai có thể không mở được camera. UI phải hiện lỗi rõ ràng và vẫn cho gọi chỉ bằng mic.

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
- **Cập nhật sau review lần 2**:
  - Cùng phụ thuộc như FE-01: có `roomCode` thì dùng roomHub; chỉ có `matchId` (demo) thì thêm relay `chat:send` vào WS trận demo trong `server.js`, gửi cho mọi người trong trận kể cả khán giả.
  - Áp dụng cùng validate như BE-07: tối đa 500 ký tự, giới hạn 5 tin/3 giây.
  - Tên người gửi lấy từ phe (Đỏ/Đen/Khán giả), **không** dùng user hardcode "Nguyễn Tấn Sang" (`ChatBox.jsx:7`, `chat.js:25-27`).
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
- **Trạng thái (review lần 2)**: phần backend đã làm, **chưa commit**. Việc còn thiếu:
  1. Test: tạo phòng riêng tư → mã khớp `/^[0-9A-HJKMNP-TV-Z]{10}$/`; tra cứu bằng chữ thường vẫn tìm được; phòng công khai vẫn là 6 chữ số.
  2. `LobbyNavigation.jsx:31, 98, 101`: chấp nhận 6 chữ số hoặc 10 ký tự base32, `maxLength={10}`, tự chuyển thành chữ hoa, không xoá chữ cái.
  3. Rate limit cho mọi đường tra mã phòng: xem REV-04.

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

## PHASE 4 — SỬA LẠI SAU REVIEW LẦN 2 (làm TRƯỚC các task còn lại)

> Mỗi REV là **một commit riêng**: `fix(REV-xx): ...`. Mỗi REV phải có test tái hiện đúng kịch bản lỗi.
> Số dòng ghi ở đây là tại commit `fec60ae`.

### REV-01 · [HIGH] Hai người cùng rớt mạng → xử thắng sai người, đuổi nhầm người đang online (hồi quy BE-06)
- **File**: `backend/src/presentation/websocket/roomHub.js:100-104`, `backend/src/domain/entities/Room.js:285-297`
- **Lỗi**: dữ liệu reconnect đã được tách theo từng bên (`reconnectState.bySide`), nhưng hub vẫn nhận diện người kết nối lại bằng field phẳng `reconnectState.disconnectedUserId`. Field này bị ghi đè bởi người rớt **sau cùng**.
- **Kịch bản**:
  1. t0: Đỏ rớt mạng.
  2. t0+30: Đen rớt mạng.
  3. t0+40: Đỏ vào lại → `isReconnectingPlayer` = false, nên timer của Đỏ vẫn chạy.
  4. t0+60: `handleDisconnectTimeout(RED)` xử **Đen (đang vắng) thắng**, cộng Elo cho Đen, rồi `removeParticipant` Đỏ đang online.
- **Sửa**:
  - Xác định người kết nối lại bằng `bySide.red?.userId === userId || bySide.black?.userId === userId`.
  - Khi một bên vào lại: chỉ xoá `bySide[side]` và timer của bên đó. Chỉ resume ván khi `bySide.red` và `bySide.black` đều null.
  - `handleDisconnectTimeout(side)` phải kiểm tra lại `bySide[side]` vẫn còn. Nếu bên đó đã vào lại thì bỏ qua.
  - Bỏ hẳn hoặc chỉ đọc (không dùng để quyết định) các field phẳng `disconnectedUserId/disconnectedSide`.
- **Test** (mức hub, không chỉ gọi method của Room): đúng thứ tự Đỏ rớt → Đen rớt → Đỏ vào lại → hết hạn của Đỏ. Kết quả mong đợi: không ai bị xử thua do Đỏ; ván vẫn tạm dừng chờ Đen.

### REV-02 · [MEDIUM] `settleMatch` bị race → ván mới bị chốt nhầm kết quả ván cũ
- **File**: `roomHub.js:1137-1200`
- **Lỗi**: `settledMatchId` và `readyStates.clear()` chỉ được set **sau** các lệnh `await` (ghi Elo, ghi DB). Nếu trong lúc chờ có người gửi `start` thì ván mới bắt đầu, sau đó kết quả ván cũ bị ghi và broadcast dưới `matchId` mới. Ván mới khi kết thúc sẽ bị `return` sớm: không có Elo, không có `matchEnded`, phòng kẹt ở FINISHED.
- **Sửa**: ngay đầu hàm, **trước mọi `await`**:
  - lưu `const matchId = room.matchId`;
  - set `room.settledMatchId = matchId`, `room.matchState.status = 'completed'`;
  - gọi `room.readyStates.clear()`;
  - huỷ turn timer.

  Sau đó mọi bước ghi DB, history, broadcast đều dùng biến `matchId` đã lưu. Chặn `start` khi `room.settling === true`.
- **Test**: gọi `settleMatch` với repo giả có `await` chậm, gửi `start` giữa chừng. Ván mới phải có `matchId` khác và kết quả ván cũ không bị gắn vào nó.

### REV-03 · [MEDIUM] Whitelist mã lỗi biến lỗi nghiệp vụ hợp lệ thành 500 (hồi quy BE-12)
- **File**: `backend/src/presentation/http/errorResponse.js:39-44`
- **Lỗi**: lỗi chỉ được trả về client khi mã có trong whitelist **và** status là 4xx. Các trường hợp đã kiểm chứng bị biến thành 500:
  - `OAUTH_DISABLED` (503)
  - header `Authorization: Bearer ` rỗng (`NO_TOKEN` → lẽ ra 401)
  - `USER_KICKED` khi join (lẽ ra 403)
  - `FILE_TOO_LARGE`

  Các mã đang được throw nhưng thiếu trong whitelist: `CALL_ALREADY_EXISTS, CALL_NOT_FOUND, CANNOT_KICK_HOST, FILE_TOO_LARGE, INVALID_USER, NO_TOKEN, NOT_ALL_READY, OPPONENT_NOT_FOUND, USER_KICKED, USER_NOT_IN_ROOM`.
- **Sửa** (đúng như plan gốc BE-12):
  - Mở rộng `core/errors/AppError.js` để có các mã auth/user/room/friends. Lỗi nghiệp vụ throw bằng `AppError`.
  - `errorResponse` trả nguyên lỗi khi `err instanceof AppError` (cho phép cả 4xx và 503).
  - Lỗi khác thì log và trả 500 `INTERNAL_ERROR`.
  - Thêm 1 test duyệt mọi `err.code = '...'` trong `src/` (grep) và khẳng định từng mã đều được map đúng.
- **Test**: 4 trường hợp đã kiểm chứng ở trên trả đúng status.

### REV-04 · [MEDIUM-HIGH] Rate limit bị vượt qua bằng `X-Forwarded-For`; tra mã phòng chưa được giới hạn hết
- **File**: `backend/src/presentation/http/middlewares/rateLimiter.js:170-177`, `room.routes.js:142` (`/invitation`), `/join`, `roomHub.js:288-293` (WS upgrade)
- **Lỗi**:
  - `getClientIp` luôn tin header XFF. Đổi XFF mỗi request là không bao giờ bị 429; đã thử 15 lần login và 40 lần tra phòng, không có 429 nào.
  - Key do attacker tự chọn làm map phình ra, ăn bộ nhớ.
  - Ba đường `/invitation`, `/join` và WS upgrade (trả 404 khác với 101) vẫn dò mã phòng được không giới hạn.
- **Sửa**:
  - Chỉ đọc XFF khi `process.env.TRUST_PROXY === 'true'`, còn lại dùng `req.socket.remoteAddress`. Thêm `TRUST_PROXY=false` vào `.env.example`.
  - Giới hạn số key trong map (vd 10.000). Khi đầy, xoá key cũ nhất.
  - Áp `roomLookupLimiter` cho `/invitation`, `/join` và WS upgrade `/ws/room/:code`. WS bị vượt hạn mức thì trả `HTTP/1.1 429` rồi `socket.destroy()`.
  - IP limiter của login chỉ đếm lần **thất bại**. Username limiter chỉ làm chậm (vd tăng delay), **không** khoá hẳn, để kẻ xấu không khoá được tài khoản người khác.
- **Test**: đổi XFF liên tục vẫn bị 429 sau N lần; tra `/invitation` quá N lần bị 429.

### REV-05 · [MEDIUM] WS không kiểm tra token đã bị thu hồi / tài khoản bị khoá
- **File**: `roomHub.js:280`
- **Lỗi**: WS chỉ kiểm chữ ký JWT. Token đã bị thu hồi sau khi đổi mật khẩu (BE-02), hoặc của tài khoản không còn ACTIVE, vẫn vào phòng và chơi được.
- **Sửa**: trước `handleUpgrade`, gọi `userRepository.findById` và kiểm tra `status === 'ACTIVE'` cùng `iat >= password_changed_at`. Tái sử dụng hàm kiểm tra của `authMiddleware.js`: tách ra một hàm dùng chung. Đồng thời sửa `authMiddleware.js:39` đang dùng `PgUserRepository` mà chưa `require`.
- **Test**: đổi mật khẩu xong, token cũ mở WS → 401.

### REV-06 · [MEDIUM] Bảng `pvp_matches` không bao giờ được ghi ở production
- **File**: `roomHub.js:47, 1504`
- **Lỗi**: `pvpMatchRepository = null` mặc định; singleton được tạo bằng `new RoomHub()` nên chỉ test mới ghi kết quả.
- **Sửa**: mặc định dùng `new PgPvpMatchRepository()`, giống cách `userRepository` đã làm.
- **Test**: hub tạo không truyền repo → `pvpMatchRepository` khác null.

### REV-07 · [MEDIUM] Sweeper xoá phòng đang có người; phòng SYSTEM_ERROR không bao giờ được dọn
- **File**: `RoomManager.js:113-139`, `roomHub.js:1340-1359`
- **Lỗi**:
  - `lastActivityAt` chỉ được cập nhật ở `addParticipant/startGame/applyMove`. Chủ phòng ngồi chờ một mình hơn 30 phút (vẫn đang kết nối) thì phòng bị xoá; hub không được báo nên mọi message sau đó nhận `ROOM_NOT_FOUND`.
  - Nhánh SYSTEM_ERROR không gọi `settleMatch` và không xoá ghế, nên phòng không bao giờ bị dọn.
- **Sửa**:
  - Cập nhật `lastActivityAt` ở mọi message và mọi connect WS.
  - Sweeper **bỏ qua** phòng còn socket đang mở (hub cung cấp hàm `hasLiveSockets(code)`, hoặc sweeper chạy trong hub).
  - Nhánh SYSTEM_ERROR đi qua `settleMatch(room, null, 'SYSTEM_ERROR')` và xoá ghế của người đã rời.
  - Xoá method `joinRoom` bị trùng ở `RoomManager.js:155` và `:174` (bản ở 155 là code chết).
- **Test**: phòng có socket mở, `lastActivityAt` cũ hơn 30 phút → sweeper không xoá.

### REV-08 · [MEDIUM] `/api/auth/*` và `/api/rooms/*` không gửi header CORS (hồi quy CLEAN-05)
- **File**: `backend/src/presentation/http/routes/auth.routes.js:2`, `room.routes.js:2`
- **Lỗi**: hai file `import corsHeaders` nhưng không gọi. Demo qua proxy Vite không bị ảnh hưởng, nhưng gọi từ origin khác (đặt `VITE_API_URL` trỏ thẳng sang backend) thì trình duyệt chặn login/register/rooms.
- **Sửa**:
  - Áp `corsHeaders(request)` và xử lý `OPTIONS` ở đầu cả 2 handler, giống friends/user/matches.
  - Thêm `CORS_ORIGINS=http://localhost:3000` vào `backend/.env.example`.
  - Thêm `VITE_BACKEND_URL` vào `frontend/.env.example`, kèm ghi chú: đây là biến shell dùng cho proxy Vite.
- **Test**: `OPTIONS /api/auth/login` với `Origin: http://localhost:3000` → có header `Access-Control-Allow-Origin`.

### REV-09 · [LOW] Thêm bạn chiều ngược lại bị lỗi sau migration 005
- **File**: `backend/src/infrastructure/database/repositories/PgFriendRepository.js:50-53`
- **Lỗi**: `ON CONFLICT (user_id, friend_id)` không áp dụng cho index đối xứng `LEAST/GREATEST`. Đã có (A,B) mà chèn thêm (B,A) sẽ bị unique violation.
- **Sửa**: trước khi chèn, kiểm tra quan hệ đã tồn tại theo cả 2 chiều. Nếu có thì trả về bản ghi đó; nếu không thì mới chèn. Bắt lỗi unique `23505` và trả lỗi nghiệp vụ `ALREADY_FRIENDS`.

### REV-10 · [LOW-MEDIUM] Migration: kiểm tra "đã chạy chưa" nằm ngoài lock
- **File**: `backend/src/migrations/migrate.js:107-115` so với `:59`
- **Sửa**: sau `pg_advisory_xact_lock`, trong cùng transaction, kiểm tra lại `migrations_history`. Nếu file đã được chạy thì `COMMIT` và bỏ qua file đó.

### REV-11 · [MEDIUM] Đồng hồ tổng không được thực thi; thời gian trước khi rớt mạng không bị trừ (thiếu sót BE-05)
- **File**: `roomHub.js:461-466, 1230-1272`
- **Sửa**:
  - `armTurnTimer` hẹn giờ theo `min(thời gian còn của lượt 60s, remainingClocks[color])`. Bên nào hết đồng hồ tổng thì `settleMatch(..., 'TIMEOUT')`.
  - Khi tạm dừng vì rớt mạng: trừ ngay thời gian đã dùng vào `remainingClocks[color]`, và lưu thời gian còn lại của lượt để resume tiếp, **không** reset `turnStartedAt` về đầy 60s.

### REV-12 · [MEDIUM] Heartbeat dùng JSON ping (trình duyệt không tự trả lời); relay WebRTC trước khi được chấp nhận (thiếu sót BE-07)
- **File**: `roomHub.js:34, 761, 792, 823, 1032-1054`
- **Lỗi**:
  - Heartbeat đang gửi `{type:'ping'}` dạng JSON. Client nào im lặng quá 10 giây là bị ngắt. Khi FE-01/FE-05 nối vào roomHub, người chơi sẽ bị đá ra liên tục và ván cờ bị tạm dừng.
  - offer/answer/candidate vẫn được relay khi cuộc gọi còn `RINGING`.
  - `isSameCall` trả `true` khi thiếu `callId`.
- **Sửa**:
  - Đổi sang `ws.ping()` ở mức protocol, kèm cờ `isAlive` cập nhật trong sự kiện `'pong'`. Trình duyệt tự trả pong, không cần code client. Vẫn chấp nhận `{type:'pong'}` cũ để tương thích.
  - Chỉ relay offer/answer/candidate khi `room.videoCall.status === 'CONNECTED'` (đã accept).
  - `isSameCall` bắt buộc có `callId` và phải khớp.

### REV-13 · [LOW] Hoà cờ: thông báo sai, PvE không bao giờ hoà được (thiếu sót BE-20)
- **File**: `roomHub.js:1200-1202`, `PveMatch.js:29-34`, migration ràng buộc `ck_pve_matches_end_reason`, adapter SQLite trong `config/db.js`
- **Sửa**:
  - Khi hoà, broadcast thông báo "Ván cờ hoà (đạt giới hạn số nước)" thay vì "Trận đấu đã bị huỷ.".
  - PvE: thêm `DRAW_PLY_LIMIT` vào `PVE_END_REASON` và vào constraint (migration mới); áp dụng giới hạn 300 ply trong `applyAndPersistMove`.
  - Đồng bộ constraint result/end_reason cho schema SQLite dùng trong test.

### REV-14 · [LOW-MEDIUM] Reset mật khẩu: chưa dùng transaction, cửa sổ rate limit vẫn lệch múi giờ (thiếu sót BE-02)
- **File**: `resetPassword.js:32-42, 76-91`, `PgPasswordResetRepository.js:25-29`
- **Sửa**:
  - Validate mật khẩu mới (tối đa 72 byte) **trước** khi hash.
  - Đánh dấu token đã dùng và đổi mật khẩu trong **một transaction**.
  - Đổi điều kiện cửa sổ rate limit thành `created_at >= NOW() - make_interval(mins => $2)`.

### REV-15 · [LOW-MEDIUM] Phần còn thiếu của SEC-05, BE-13, BE-16 (auth)
- Thêm `GOOGLE_CLIENT_ID=` vào `backend/.env.example` (commit SEC-05 ghi đã thêm nhưng thực tế không có).
- `oauthLogin.js:95`: sanitize `redirectUrl` giống login. `sanitizeRedirectUrl` (`loginUser.js:15`) phải chặn thêm ký tự điều khiển, tab và xuống dòng (`"/\t/evil.com"` hiện lọt qua).
- `oauthLogin.js:124`: tên lấy từ Google phải qua `validateDisplayName`; không hợp lệ thì dùng phần trước `@` của email.
- Migration mới: `CREATE UNIQUE INDEX ... ON users (LOWER(username))`. Nếu dữ liệu cũ bị trùng theo chữ hoa/thường thì migration báo lỗi rõ ràng, không tự xoá.
- `loginUser.js:89-93`: tài khoản không ACTIVE trả **cùng** thông báo chung "Sai thông tin đăng nhập".
- `docs/OAUTH_SETUP.md` đã có. Thêm 1 dòng link tới file này trong README.

### REV-16 · [LOW] Phần còn thiếu của FE-03, FE-04, frontend JS cũ
- Nút "vào phòng bằng mã" và nút "Vào" trên thẻ phòng phải yêu cầu đăng nhập (`rooms.js:1010, 1145`; `api.js:275` `joinRoomByCode`).
- Xoá user hardcode "Nguyễn Tấn Sang" còn sót ở `rooms.js:2498-2502`, `chat.js:25-27`, `ChatBox.jsx:7`.
- Escape các giá trị còn sót: `rooms.js:1093` (`statusMeta.label`), `:1102` (`hostElo`), `:1108`, `:1112`, `:1352` (`friend.elo`). Với số thì ép kiểu `Number(...)`.
- `rooms.js:973, 1547`: bỏ `escapeHtml` bên trong lời gọi `showToast`, vì hàm này đã tự escape (đang hiện `A&amp;B`).
- `js/auth.js:351, 694, 869`: đọc `import.meta.env.VITE_API_URL ?? '/api'` thay cho `window.VITE_API_URL`. `:506`: bỏ `'facebook'`. `:522-537`: bỏ đoạn tạo session giả khi không có `fetch`.
- `auth.js:214`: chỉ nhận token reset từ `?token=` (bỏ `#token=`).

### REV-17 · [LOW] Phần còn thiếu của BE-08
- `createRoom.js:31-37`: key cache là `${userId}:${requestId}`; dọn các entry quá 3 giây trong sweeper.
- Khi ghế giữ qua HTTP bị giải phóng (BE-10): broadcast trạng thái phòng và xoá `readyStates` của user đó.

### REV-18 · [LOW] CI: PR từ fork vẫn điều khiển được job có secret Jira
- **File**: `.github/scripts/ai_pr_tester.py` (nhánh xử lý khi fail, `resolve_pull_request` khoảng dòng 155)
- **Sửa**:
  - Khi `HEAD_REPO != REPOSITORY` (PR từ fork): không tạo Jira Bug, chỉ comment ngắn và không chèn nội dung log của PR vào comment.
  - `resolve_pull_request`: bắt buộc khớp head SHA, không được fallback `data[0]`.

### REV-19 · [MEDIUM — quan trọng cho buổi demo] Trận demo COT-615 tự chạy đồng hồ trước khi có người vào
- **File**: `backend/src/domain/entities/cot615Match.js`, `server.js` (route demo)
- **Lỗi**: trận được tạo ở lần GET đầu tiên và đồng hồ của Đỏ chạy sau 3 giây dù chưa ai kết nối. Đỏ không đi trong khoảng 2 phút là thua do hết giờ, và trận đứng ở trạng thái kết thúc cho tới khi restart backend.
- **Sửa** (chỉ áp dụng khi `ENABLE_DEMO_MATCH=true`):
  - Đồng hồ chỉ bắt đầu khi **cả Đỏ và Đen đều đã kết nối**.
  - Khi trận kết thúc: tự reset ván mới sau 10 giây, hoặc thêm message `{type:'rematch'}` để 2 người chơi bấm "Chơi lại".
  - Thêm `DEMO_CLOCK_SECONDS` (mặc định 600) vào `.env.example` để demo không bị gấp.
- **Test**: tạo trận và chờ quá thời gian đồng hồ khi chưa đủ 2 người → chưa ai thua.

---

## PHỤ LỤC A — Những phần đã kiểm tra và ỔN (không cần sửa)
- Toàn bộ SQL dùng tham số `$n` → không có SQL injection.
- Luật cờ: cung Tướng/Sĩ, Tượng không qua sông & bị chặn mắt, Mã bị cản chân, Pháo ăn qua đúng 1 ngòi, Tốt chỉ đi ngang sau khi qua sông và không lùi, lộ mặt Tướng, cấm tự chiếu, hết nước = thua — **đều đúng**. Hệ toạ độ thống nhất (hàng 0 = hàng cuối của Đỏ, cột 0 = `a`).
- PvE trên Postgres: double-submit và race người/bot an toàn nhờ cập nhật có điều kiện theo `ply` + `UNIQUE(match_id, ply)`; timeout dùng `expectedPly`; kiểm quyền sở hữu qua `loadOwnedMatch`; bot chỉ chọn nước hợp lệ.
- Token reset dùng `crypto.randomBytes(32)`, hết hạn 15 phút. Quyền respond/cancel lời mời kết bạn đúng.
- React không dùng `dangerouslySetInnerHTML`; tên người chơi/chat được React escape. Phép lật bàn cờ (Đỏ/Đen) trong `XiangqiBoard.jsx` đúng.
- Workflow không nội suy `${{ github.event.* }}` trực tiếp trong `run:` (đã qua `env:`).

## PHỤ LỤC B — Checklist tiến độ
Ký hiệu: `[x]` đạt · `[~]` đã làm nhưng còn thiếu, phần thiếu nằm ở REV ghi bên cạnh · `[ ]` chưa làm.

**Đợt 1 (đã review lần 2):**
- [x] SEC-01 · [x] SEC-02 · [x] SEC-03 · [x] SEC-04 · [~] SEC-05 (REV-03, REV-15)
- [x] BE-01 · [~] BE-02 (REV-05, REV-14) · [x] BE-03 · [~] BE-04 · [~] BE-05 (REV-02, REV-11) · [~] BE-06 (REV-01) · [~] BE-07 (REV-12) · [~] BE-08 (REV-07, REV-17) · [x] BE-09 · [x] BE-10 · [x] BE-11 (REV-19 cho demo)
- [x] FE-02 · [~] FE-03 (REV-16) · [~] FE-04 (REV-16) · [x] FE-09 · [x] FE-11
- [~] BE-12 (REV-03) · [~] BE-13 (REV-04, REV-15) · [x] BE-15 · [~] BE-16 (REV-15) · [~] BE-17 (REV-10) · [~] BE-18 (REV-06, REV-09) · [x] BE-19 · [~] BE-20 (REV-13)
- [~] CLEAN-05 (REV-08)

**Làm ngay (dọn working tree):**
- [x] BE-14 (phần backend đã làm nhưng chưa commit; còn thiếu test và sửa `LobbyNavigation.jsx`)

**Phase 4 — làm tiếp theo, đúng thứ tự:**
- [x] REV-01 · [x] REV-02 · [x] REV-03 · [x] REV-04 · [x] REV-05 · [x] REV-06 · [x] REV-07 · [x] REV-08 · [x] REV-09 · [x] REV-10
- [x] REV-11 · [x] REV-12 · [x] REV-13 · [x] REV-14 · [x] REV-15 · [x] REV-16 · [x] REV-17 · [x] REV-18 · [x] REV-19

**Còn lại của plan gốc (làm sau Phase 4):**
- [x] FE-06 · [x] FE-08 · [x] FE-07 · [x] FE-01 · [x] FE-05 · [x] FE-10
- [ ] CLEAN-01 · [ ] CLEAN-02 · [ ] CLEAN-03 · [ ] CLEAN-04

**Lưu ý vận hành**: vì secret JWT mặc định đã công khai trong source, sau khi xong SEC-02 phải đặt `JWT_SECRET` mới trên mọi môi trường (mọi token cũ sẽ mất hiệu lực — đây là điều mong muốn). Nếu repo GitHub từng public hoặc có PR từ fork chạy qua workflow `ai-pr-test.yml`, hãy **xoay vòng (rotate) `JIRA_API_TOKEN` và `GEMINI_API_KEY`**.
