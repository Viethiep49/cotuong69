/**
 * FE-08: các lỗi React khác — kết nối lại WS, readOnly của khán giả, destroy() sai chỗ,
 * kiểm response.ok/content-type, khay quân bị bắt tính từ bàn cờ, AudioContext dùng chung.
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importSrc = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('FE-08: reconnectPolicy', () => {
  test('backoff tăng dần, có jitter và bị chặn trên', async () => {
    const { nextRetryDelay } = await importSrc('src/domain/network/reconnectPolicy.js');
    // random = 0 -> cận dưới (cap/2); random = 1 -> cận trên (cap)
    assert.strictEqual(nextRetryDelay(0, { random: () => 0 }), 250);
    assert.strictEqual(nextRetryDelay(0, { random: () => 1 }), 500);
    assert.strictEqual(nextRetryDelay(2, { random: () => 1 }), 2000);
    assert.strictEqual(nextRetryDelay(10, { random: () => 1 }), 5000);
    assert.strictEqual(nextRetryDelay(50, { random: () => 0 }), 2500);
    // hai giá trị random khác nhau cho độ trễ khác nhau (không đồng loạt)
    assert.notStrictEqual(
      nextRetryDelay(3, { random: () => 0.1 }),
      nextRetryDelay(3, { random: () => 0.9 }),
    );
  });

  test('lỗi 4xx và mã đóng xác thực là lỗi không thử lại; 5xx/408/429 vẫn thử lại', async () => {
    const { isFatalHttpStatus, isFatalCloseCode } = await importSrc('src/domain/network/reconnectPolicy.js');
    for (const status of [400, 401, 403, 404]) assert.strictEqual(isFatalHttpStatus(status), true, String(status));
    for (const status of [408, 429, 500, 502, 503, undefined, null]) {
      assert.strictEqual(isFatalHttpStatus(status), false, String(status));
    }
    // REV2-11: chỉ các mã server dùng để từ chối hẳn; 4008 (heartbeat timeout) phải thử lại
    for (const code of [1008, 4001, 4003]) assert.strictEqual(isFatalCloseCode(code), true, String(code));
    for (const code of [1000, 1001, 1006, 1011, 4008, 4000, 4401, undefined]) assert.strictEqual(isFatalCloseCode(code), false, String(code));
  });

  test('sự kiện online khi WS còn đóng -> phải kết nối lại, KHÔNG mở khóa bàn cờ', async () => {
    const { browserOnlineAction } = await importSrc('src/domain/network/reconnectPolicy.js');
    assert.strictEqual(browserOnlineAction({ socketOpen: false }), 'RECONNECT_NOW');
    assert.strictEqual(browserOnlineAction({ socketOpen: true }), 'MARK_CONNECTED');
  });

  test('khán giả thiếu trường readOnly vẫn là readOnly', async () => {
    const { resolveReadOnly } = await importSrc('src/domain/network/reconnectPolicy.js');
    assert.strictEqual(resolveReadOnly({ color: null }), true);
    assert.strictEqual(resolveReadOnly({}), true);
    assert.strictEqual(resolveReadOnly({ color: 'red' }), false);
    assert.strictEqual(resolveReadOnly({ color: 'black', readOnly: false }), false);
    assert.strictEqual(resolveReadOnly({ color: 'red', readOnly: true }), true);
  });
});

describe('FE-08: useMatch', () => {
  const src = read('src/application/hooks/useMatch.js');

  test('handler online không gọi handleSelfReconnect vô điều kiện', () => {
    const start = src.indexOf('function handleBrowserOnline');
    const end = src.indexOf('function handleBrowserOffline');
    const body = src.slice(start, end);
    assert.ok(body.includes('browserOnlineAction'), 'phải suy từ trạng thái socket');
    assert.ok(body.includes('reconnectNowRef'), 'phải kết nối lại ngay');
  });

  test('cleanup của effect kết nối không còn destroy() ReconnectManager', () => {
    const start = src.indexOf('cancelled = true;');
    const end = src.indexOf('}, [matchId, reconnectManager]);');
    const cleanup = src.slice(start, end);
    assert.ok(!cleanup.includes('reconnectManager.destroy()'), 'destroy() xoá listener UI');
  });

  test('retry dùng backoff có jitter và dừng khi lỗi 4xx / mã đóng xác thực', () => {
    assert.ok(src.includes('nextRetryDelay('));
    assert.ok(src.includes('isFatalHttpStatus(error.status)'));
    assert.ok(src.includes('isFatalCloseCode('));
    assert.ok(!/retryDelay\s*\*\s*2/.test(src), 'còn backoff cũ không jitter');
  });

  test('state/welcome dùng resolveReadOnly thay vì message.readOnly thô', () => {
    assert.ok(src.includes('readOnly: resolveReadOnly(message)'));
    assert.ok(!/readOnly: message\.readOnly,/.test(src));
  });

  test('sendMove báo lỗi khi trả về false', () => {
    const start = src.indexOf('const sendMove');
    const end = src.indexOf('const clearMoveError');
    const body = src.slice(start, end);
    const falseReturns = body.match(/return false;/g) || [];
    const errorSets = body.match(/moveError: '/g) || [];
    assert.ok(falseReturns.length >= 3);
    assert.ok(errorSets.length >= falseReturns.length, 'mỗi nhánh return false phải set moveError');
  });
});

describe('FE-08: fetchMatch kiểm response', () => {
  let originalFetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  });

  function mockFetch(response) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
  }

  test('phản hồi HTML (vd 502 từ proxy) -> MatchApiError có status, không ném SyntaxError', async () => {
    mockFetch({
      ok: false,
      status: 502,
      headers: { get: () => 'text/html' },
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    const { fetchMatch, MatchApiError } = await importSrc('src/infrastructure/api/matchApi.js');
    await assert.rejects(
      () => fetchMatch('COT-615'),
      (err) => err instanceof MatchApiError && err.status === 502 && !(err instanceof SyntaxError),
    );
  });

  test('200 nhưng không phải JSON -> lỗi rõ ràng', async () => {
    mockFetch({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}) });
    const { fetchMatch } = await importSrc('src/infrastructure/api/matchApi.js');
    await assert.rejects(() => fetchMatch('COT-615'), /không hợp lệ/);
  });

  test('401 JSON -> giữ thông điệp server và status', async () => {
    mockFetch({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({ error: 'Cần đăng nhập' }),
    });
    const { fetchMatch } = await importSrc('src/infrastructure/api/matchApi.js');
    await assert.rejects(() => fetchMatch('COT-615'), (err) => err.status === 401 && err.message === 'Cần đăng nhập');
  });

  test('200 JSON -> trả về match', async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 'COT-615' }),
    });
    const { fetchMatch } = await importSrc('src/infrastructure/api/matchApi.js');
    assert.deepStrictEqual(await fetchMatch('COT-615'), { id: 'COT-615' });
  });
});

describe('FE-08: khay quân bị bắt tính từ bàn cờ', () => {
  const { BoardSyncManager } = require('../src/domain/game/boardSyncManager.js');

  function fullBoard() {
    const layout = { chariot: 2, horse: 2, elephant: 2, advisor: 2, general: 1, cannon: 2, soldier: 5 };
    const board = [];
    for (const color of ['red', 'black']) {
      for (const [type, count] of Object.entries(layout)) {
        for (let i = 0; i < count; i += 1) board.push({ id: `${color}-${type}-${i}`, type, color, position: `a${i}` });
      }
    }
    return board;
  }

  test('bàn cờ nguyên vẹn -> không quân nào bị bắt (kể cả khi tải lại giữa ván)', () => {
    const captured = BoardSyncManager.deriveCapturedPieces(fullBoard());
    assert.strictEqual(captured.red.length, 0);
    assert.strictEqual(captured.black.length, 0);
  });

  test('thiếu quân trên bàn -> đúng số quân bị bắt theo từng bên, không cần lịch sử lastMove', () => {
    const board = fullBoard().filter((p) => !(p.color === 'red' && p.type === 'horse'))
      .filter((p) => !(p.color === 'black' && p.type === 'soldier' && p.id.endsWith('-0')));
    const captured = BoardSyncManager.deriveCapturedPieces(board);
    assert.strictEqual(captured.red.length, 2);
    assert.ok(captured.red.every((p) => p.type === 'horse'));
    assert.strictEqual(captured.black.length, 1);
    assert.strictEqual(captured.black[0].type, 'soldier');
  });

  test('App dùng deriveCapturedPieces và không còn setCapturedPieces cộng dồn', () => {
    const app = read('src/App.jsx');
    assert.ok(app.includes('BoardSyncManager.deriveCapturedPieces(match.board)'));
    assert.ok(!app.includes('setCapturedPieces'));
  });
});

describe('FE-08: AudioContext dùng chung', () => {
  function createFakeAudioContextType() {
    const instances = [];
    class FakeAudioContext {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = {};
        this.resumeCalls = 0;
        this.oscillators = 0;
        instances.push(this);
      }

      resume() {
        this.resumeCalls += 1;
        this.state = 'running';
        return Promise.resolve();
      }

      createOscillator() {
        this.oscillators += 1;
        return { type: '', frequency: {}, connect() {}, start() {}, stop() {} };
      }

      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    }
    return { FakeAudioContext, instances };
  }

  test('nhiều nước đi chỉ tạo MỘT AudioContext', async () => {
    const { createMoveSoundPlayer } = await importSrc('src/infrastructure/sound/moveSound.js');
    const { FakeAudioContext, instances } = createFakeAudioContextType();
    const player = createMoveSoundPlayer({ getAudioContextType: () => FakeAudioContext });
    player.play(false);
    player.play(true);
    player.play(false);
    assert.strictEqual(instances.length, 1);
    assert.strictEqual(instances[0].oscillators, 3);
  });

  test('unlock() ở thao tác đầu tiên gọi resume() khi context đang suspended', async () => {
    const { createMoveSoundPlayer } = await importSrc('src/infrastructure/sound/moveSound.js');
    const { FakeAudioContext, instances } = createFakeAudioContextType();
    const player = createMoveSoundPlayer({ getAudioContextType: () => FakeAudioContext });
    player.unlock();
    assert.strictEqual(instances.length, 1);
    assert.strictEqual(instances[0].resumeCalls, 1);
    player.unlock(); // đã running -> không resume lại
    assert.strictEqual(instances[0].resumeCalls, 1);
  });

  test('trình duyệt không có AudioContext -> không ném lỗi', async () => {
    const { createMoveSoundPlayer } = await importSrc('src/infrastructure/sound/moveSound.js');
    const player = createMoveSoundPlayer({ getAudioContextType: () => null });
    assert.doesNotThrow(() => {
      player.unlock();
      player.play(true);
    });
  });
});
