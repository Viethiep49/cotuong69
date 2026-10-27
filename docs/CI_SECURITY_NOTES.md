# CI/CD Security Notes (SEC-04)

Ghi chú vận hành cho bộ GitHub Actions sau khi vá lỗ hổng **SEC-04** trong
[`CODE_REVIEW_FIX_PLAN.md`](./CODE_REVIEW_FIX_PLAN.md).

## 1. Nguyên tắc: code của PR là dữ liệu không tin cậy

Bất kỳ PR nào (kể cả PR từ fork) đều có thể chứa `postinstall`, test, hay
`vite.config.js` độc hại. Vì vậy **không job nào vừa checkout code PR vừa có
secret hoặc quyền ghi**. Quy tắc này được kiểm tra bằng mắt khi review mọi
thay đổi workflow:

> Job chạy code PR ⇒ chỉ `permissions: contents: read`, không `secrets.*`.
> Job có secret/quyền ghi ⇒ chỉ chạy script của nhánh base, không đọc code PR.

## 2. Bản đồ workflow hiện tại

| Workflow | Trigger | Quyền | Secrets | Có chạy code PR? |
| --- | --- | --- | --- | --- |
| `ai-pr-test.yml` (name: **PR Tests**) | `pull_request` | `contents: read` | không | có (đúng mục đích: test code PR) |
| `ai-pr-review.yml` (name: AI PR Review (post-CI)) | `workflow_run` của `PR Tests` | `contents: read`, `actions: read`, `pull-requests: read`, `issues: write` | `GEMINI_API_KEY`, `JIRA_*` | **không** — checkout `ref: <default branch>`, và có bước xác minh `HEAD == origin/<base>` trước khi chạy script |
| `jira-sync.yml` | `create`, `push`, `pull_request_target` (chỉ PR nội bộ), `workflow_dispatch` | `permissions: {}` + job `contents: read` | `JIRA_*` | **không** — luôn checkout base branch |

`PR Tests` ghi log + `ci-outcome.env` thành artifact `ci-logs`
(`retention-days: 14`); `ai-pr-review.yml` tải artifact này bằng
`run-id: ${{ github.event.workflow_run.id }}`.

> ⚠️ `on.workflow_run.workflows` khớp theo **tên** workflow. Nếu đổi
> `name:` của `ai-pr-test.yml` thì phải sửa cả `workflows: ["PR Tests"]`
> trong `ai-pr-review.yml`, nếu không bước AI sẽ không bao giờ chạy.

## 3. Fail-closed của AI gate

`ai_pr_tester.py` **chỉ** trả `exit 0` khi đã thực sự đánh giá được PR và
verdict là `PASSED`/`WARNING`. Các trường hợp sau đều `exit 1`:

- CI test/build thất bại (job test đã fail, gate chỉ bổ sung chẩn đoán);
- PR không tham chiếu Jira task `COT-<số>` trong tiêu đề / mô tả / tên nhánh;
- thiếu `GEMINI_API_KEY`, thiếu `JIRA_USER_EMAIL`/`JIRA_API_TOKEN`;
- không đọc được Jira issue, không lấy được danh sách file thay đổi;
- Gemini lỗi/timeout, hoặc phản hồi không có dòng `VERDICT: ...` hợp lệ ở đầu;
- không gửi được comment kết quả lên PR.

Verdict `WARNING` vẫn `exit 0` (cần reviewer để ý), `FAILED` thì `exit 1`.

Hệ quả cần biết: PR không có mã Jira sẽ **đỏ** ở bước AI. Đây là chủ ý (trước
đây thiếu key được coi là pass). Quy ước: đặt mã task vào tiêu đề PR
(`[COT-123] ...`) hoặc tên nhánh (`feature/COT-123-...`).

## 4. Secrets & biến cần cấu hình

Secrets (Settings → Secrets and variables → Actions):

- `JIRA_BASE_URL` (tuỳ chọn), `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`
- `GEMINI_API_KEY`

Variables (tuỳ chọn, có default trong workflow):

- `GEMINI_MODEL` — mặc định `gemini-2.5-flash`; đổi ở đây khi Google ngừng model cũ.
- `JIRA_PROJECT_KEY` — mặc định `COT`.

API key Gemini được gửi qua **header `x-goog-api-key`**, không nằm trong query
string (tránh lộ key qua log/proxy/URL history).

Nếu trước đây workflow cũ (`pull_request_target` + checkout `head.sha`) từng
chạy với PR từ fork, hãy **xoay vòng** `JIRA_API_TOKEN` và `GEMINI_API_KEY`
(xem ghi chú vận hành ở cuối `CODE_REVIEW_FIX_PLAN.md`).

## 5. Những gì đã bị xoá

- `auto_merge` job + `.github/scripts/auto_merge_pr.py` (auto-merge không cần
  review người, merge API không truyền `sha`). Thay thế bằng **branch
  protection**: bắt buộc review + check "Test and Verify" xanh.
- `pull_request_target` + `ref: github.event.pull_request.head.sha` +
  `allow-unsafe-pr-checkout: true` trong workflow test.
- `|| true` ở bước test frontend và `continue-on-error: true` ở các bước
  test/build (trước đây test fail vẫn xanh vì thiếu `pipefail`).
- Model `gemini-1.5-flash` (đã ngừng) và các nhánh "fail open" (thiếu
  secret/AI lỗi → coi như PASSED).

## 6. Rủi ro còn lại (chấp nhận được)

- `npm ci` trong job test vẫn chạy install script của dependencies do PR
  khai báo. Vì job đó không có secret và `GITHUB_TOKEN` chỉ `contents: read`
  (và `persist-credentials: false`), thiệt hại tối đa là máy runner của PR đó.
  Có thể siết thêm bằng `--ignore-scripts` nếu sau này không dependency nào
  cần install script.
- Log test (do PR tạo ra) được đưa vào prompt AI ⇒ prompt injection vẫn có
  thể tạo ra comment sai. Vì không còn auto-merge và verdict được parse
  nghiêm ngặt (chỉ đọc các dòng đầu), ảnh hưởng chỉ là nội dung comment.
- `jira-sync.yml` vẫn chạy với secret Jira trên `pull_request_target`, nhưng
  chỉ với PR nội bộ (`head.repo.full_name == github.repository`) và chỉ nhận
  key `COT-`.

## 7. Actions đã pin theo commit SHA

`actions/checkout`, `setup-node`, `setup-python`, `upload-artifact`,
`download-artifact` được pin theo SHA kèm comment tag (`# v4`, `# v5`).
Khi cần nâng cấp: lấy SHA thật từ GitHub API
(`/repos/<owner>/<repo>/git/ref/tags/<tag>`, nếu `type == "tag"` thì peel qua
`/git/tags/<sha>`) rồi cập nhật cả SHA **và** comment tag. Không dùng lại tag
trôi nổi.
