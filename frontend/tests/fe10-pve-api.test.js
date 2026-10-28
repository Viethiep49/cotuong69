/**
 * FE-10: PveApiService gọi API PvE thật (backend /api/pve/*), không giả lập trận ở client;
 * dùng MỘT instance dùng chung; xin thua không bịa kết quả LOSS.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PveApiService, PveGameController } = require('../js/pve.js');
const { createFakePveBackend } = require('./helpers/fakePveBackend.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MOVE = { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } };

function makeApi(options = {}) {
  const backend = createFakePveBackend(options.backend);
  const api = new PveApiService({ fetch: backend.fetch, getToken: () => 'tok-123', ...options.api });
  return { api, backend };
}

describe('FE-10: PveApiService gọi API thật', () => {
  test('tạo trận: POST /api/pve/matches kèm Bearer token và đúng body', async () => {
    const { api, backend } = makeApi();
    const res = await api.createPveMatch({ playerColor: 'red' });
    assert.strictEqual(res.success, true);
    const request = backend.requests[0];
    assert.strictEqual(request.method, 'POST');
    assert.ok(request.url.endsWith('/api/pve/matches'), request.url);
    assert.strictEqual(request.headers.Authorization, 'Bearer tok-123');
    assert.deepStrictEqual(request.body, { playerColor: 'red' });
    assert.ok(!('difficulty' in request.body));
  });

  test('không có token thì không gửi Authorization và nhận lỗi 401 có nghĩa', async () => {
    const { api } = makeApi({ api: { getToken: () => null }, backend: { requireAuth: true } });
    await assert.rejects(() => api.createPveMatch({ playerColor: 'red' }), (err) => {
      assert.strictEqual(err.code, 'NO_TOKEN');
      assert.strictEqual(err.status, 401);
      assert.match(err.message, /đăng nhập/);
      return true;
    });
    assert.strictEqual(api.getCurrentMatch(), null, 'Lỗi thì không được tự bịa trận');
  });

  test('đi quân: gửi {from,to} dạng {row,col}; nước của máy và trạng thái cuối cùng lấy từ response', async () => {
    const { api, backend } = makeApi();
    const { match } = await api.createPveMatch({ playerColor: 'red' });
    const res = await api.submitMove(match.id, MOVE);
    const request = backend.requests[1];
    assert.ok(request.url.endsWith(`/api/pve/matches/${match.id}/moves`), request.url);
    assert.deepStrictEqual(request.body, MOVE);
    assert.strictEqual(res.playerMove.actor, 'PLAYER');
    assert.strictEqual(res.botMove.actor, 'BOT');
    assert.strictEqual(api.getCurrentMatch().ply, 2);
  });

  test('nước đi thiếu from/to bị chặn trước khi gọi mạng', async () => {
    const { api, backend } = makeApi();
    const { match } = await api.createPveMatch({ playerColor: 'red' });
    const before = backend.requests.length;
    await assert.rejects(() => api.submitMove(match.id, {}), (err) => err.code === 'INVALID_MOVE');
    assert.strictEqual(backend.requests.length, before);
  });

  test('mã lỗi của backend được giữ nguyên trong err.code / err.status', async () => {
    const { api } = makeApi();
    await assert.rejects(() => api.submitMove(999, MOVE), (err) => err.code === 'MATCH_NOT_FOUND' && err.status === 404);

    const { match } = await api.createPveMatch({ playerColor: 'red' });
    await api.resignMatch(match.id);
    await assert.rejects(() => api.submitMove(match.id, MOVE), (err) => err.code === 'MATCH_FINISHED' && err.status === 409);
  });

  test('vượt giới hạn số trận đang chơi -> TOO_MANY_PVE_MATCHES (429)', async () => {
    const { api } = makeApi({ backend: { maxActive: 1 } });
    await api.createPveMatch({ playerColor: 'red' });
    await assert.rejects(() => api.createPveMatch({ playerColor: 'red' }), (err) => err.code === 'TOO_MANY_PVE_MATCHES' && err.status === 429);
    assert.strictEqual(api.isCreating, false, 'Nhả khoá sau lỗi để bấm lại được');
  });

  test('rớt mạng -> NETWORK_ERROR (không bịa kết quả), phản hồi sai dạng -> INVALID_RESPONSE', async () => {
    const offline = new PveApiService({ fetch: async () => { throw new TypeError('Failed to fetch'); }, getToken: () => 't' });
    await assert.rejects(() => offline.createPveMatch({ playerColor: 'red' }), (err) => err.code === 'NETWORK_ERROR' && err.status === 0);
    await assert.rejects(() => offline.resignMatch(1), (err) => err.code === 'NETWORK_ERROR');

    const weird = new PveApiService({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) }), getToken: () => 't' });
    await assert.rejects(() => weird.getMatch(1), (err) => err.code === 'INVALID_RESPONSE');
  });

  test('không còn mô phỏng ở client: không inMemoryMatches / fetchBotMove / finishMatch / bàn cờ giả', () => {
    const api = new PveApiService({ fetch: async () => null });
    assert.strictEqual(api.inMemoryMatches, undefined);
    assert.strictEqual(api.fetchBotMove, undefined);
    assert.strictEqual(api.finishMatch, undefined);
    const src = read('js/pve.js');
    assert.ok(!src.includes('inMemoryMatches'));
    assert.ok(!src.includes('sampleBotMove'));
    assert.ok(!src.includes('createInitialXiangqiBoard'));
    assert.ok(!/setTimeout\(resolve, (60|80)\)/.test(src), 'Không còn độ trễ giả lập');
  });

  test('baseUrl mặc định /api/pve, theo VITE_API_URL khi có', () => {
    assert.strictEqual(new PveApiService({ fetch: async () => null }).baseUrl, '/api/pve');
    assert.strictEqual(new PveApiService({ baseUrl: 'https://x.test/api/pve/', fetch: async () => null }).baseUrl, 'https://x.test/api/pve');
  });
});

describe('FE-10: PveGameController theo máy chủ', () => {
  test('chọn Đen: hiện "Máy đang đi..." trong lúc máy chủ đi nước đầu rồi trả lượt cho người', async () => {
    const { api } = makeApi();
    const controller = new PveGameController(api);
    const seen = [];
    controller.onStateChange((s) => seen.push(s.isBotThinking));
    await controller.startMatch({ playerColor: 'black' });
    assert.ok(seen.includes(true));
    const snap = controller.getSnapshot();
    assert.strictEqual(snap.isBotThinking, false);
    assert.strictEqual(snap.isPlayerTurn, true);
    assert.strictEqual(snap.match.ply, 1);
  });

  test('đi quân: bàn cờ khoá trong lúc chờ máy chủ, chỉ cập nhật sau khi có phản hồi', async () => {
    const { api } = makeApi({ backend: { delayMs: 20 } });
    const controller = new PveGameController(api);
    await controller.startMatch({ playerColor: 'red' });
    const pending = controller.makePlayerMove(MOVE);
    assert.strictEqual(controller.isBoardLocked(), true);
    assert.strictEqual(controller.match.ply, 0, 'Chưa cập nhật khi máy chủ chưa xác nhận');
    await pending;
    assert.strictEqual(controller.match.ply, 2);
    assert.strictEqual(controller.isBoardLocked(), false);
  });

  test('máy chủ báo trận đã kết thúc (vd. hết giờ) -> đồng bộ lại từ máy chủ và mở popup kết quả', async () => {
    const { api, backend } = makeApi();
    const controller = new PveGameController(api);
    await controller.startMatch({ playerColor: 'red' });
    // máy chủ xử thua do hết giờ trong lúc client vẫn nghĩ còn PLAYING
    backend.forceFinish(controller.match.id, 'LOSS', 'TIMEOUT');
    await assert.rejects(() => controller.makePlayerMove(MOVE), (err) => err.code === 'MATCH_FINISHED');
    const snap = controller.getSnapshot();
    assert.strictEqual(snap.match.endReason, 'TIMEOUT');
    assert.strictEqual(snap.isFinished, true);
    assert.strictEqual(snap.isResultModalOpen, true);
  });
});

describe('FE-10: rooms.js dùng một instance và không bịa kết quả', () => {
  const rooms = read('js/rooms.js');

  test('chỉ tạo PveApiService một chỗ (getPveApi), tạo trận và xin thua dùng chung', () => {
    const creations = rooms.match(/new window\.PveApiService\(/g) || [];
    assert.strictEqual(creations.length, 1, 'chỉ được có 1 chỗ khởi tạo PveApiService');
    assert.ok(rooms.includes('function getPveApi()'));
    assert.strictEqual((rooms.match(/getPveApi\(\)/g) || []).length >= 3, true);
  });

  test('xin thua lỗi không còn tạo kết quả LOSS giả', () => {
    const start = rooms.indexOf("pveConfirmResignBtn.addEventListener('click'");
    const body = rooms.slice(start, start + 2500);
    assert.ok(!/status: 'FINISHED'/.test(body), 'không được dựng match FINISHED ở client');
    assert.ok(!/result: 'LOSS'/.test(body), 'không được tự đặt result LOSS');
    assert.ok(!body.includes("'pve-current'"));
    assert.ok(body.includes("resignError.code === 'MATCH_FINISHED'"));
    assert.ok(body.includes('pveApi.getMatch('));
  });

  test('chưa đăng nhập thì báo cần đăng nhập thay vì gọi API', () => {
    assert.ok(rooms.includes('Bạn cần đăng nhập để chơi với máy.'));
  });
});
