/**
 * FE-06: trận đấu React gửi xác thực (Bearer cho fetchMatch, token qua
 * Sec-WebSocket-Protocol cho WS, không để token trong query string) và công cụ
 * debug/mô phỏng chỉ hiện ở bản dev.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const importSrc = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

function installLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  });
}

describe('FE-06: xác thực trận đấu React', () => {
  let originalFetch;
  let calls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ id: 'COT-615' }) };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  });

  test('fetchMatch gắn Authorization: Bearer khi đã đăng nhập', async () => {
    installLocalStorage({ cotuong_access_token: 'abc.def.ghi' });
    const { fetchMatch } = await importSrc('src/infrastructure/api/matchApi.js');
    await fetchMatch('COT-615');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer abc.def.ghi');
  });

  test('fetchMatch không gắn Authorization khi chưa đăng nhập', async () => {
    installLocalStorage();
    const { fetchMatch } = await importSrc('src/infrastructure/api/matchApi.js');
    await fetchMatch('COT-615');
    assert.strictEqual(calls[0].options.headers.Authorization, undefined);
  });

  test('WS mang token qua subprotocol, URL không chứa token', async () => {
    installLocalStorage({ cotuong_access_token: 'abc.def.ghi' });
    const { matchWebSocketProtocols, matchWebSocketUrl } = await importSrc('src/infrastructure/api/matchApi.js');
    assert.deepStrictEqual(matchWebSocketProtocols(), ['cotuong.v1', 'access_token.abc.def.ghi']);
    assert.ok(!matchWebSocketUrl('COT-615').includes('token'), 'URL WS không được chứa token');
  });

  test('chưa đăng nhập hoặc token có ký tự lạ -> chỉ gửi cotuong.v1 (không làm WebSocket ném lỗi)', async () => {
    const { buildWsProtocols } = await importSrc('src/infrastructure/api/wsAuth.js');
    assert.deepStrictEqual(buildWsProtocols(null), ['cotuong.v1']);
    assert.deepStrictEqual(buildWsProtocols('có dấu cách'), ['cotuong.v1']);
  });

  test('useMatch tạo WebSocket kèm protocols, không nối token vào URL', () => {
    const src = read('src/application/hooks/useMatch.js');
    assert.ok(/new WebSocket\(matchWebSocketUrl\(matchId\), matchWebSocketProtocols\(\)\)/.test(src));
    assert.ok(!/[?&]token=/.test(src), 'không được đưa token vào query string');
  });

  test('khối nút mô phỏng/debug chỉ render khi import.meta.env.DEV', () => {
    const src = read('src/App.jsx');
    const guardIndex = src.indexOf('import.meta.env.DEV');
    const toolsIndex = src.indexOf('simulation-tools-group');
    assert.ok(guardIndex !== -1, 'thiếu guard import.meta.env.DEV');
    assert.ok(guardIndex < toolsIndex, 'guard phải bao ngoài khối simulation-tools-group');
    assert.ok(/import\.meta\.env\.DEV && \(\s*<div className="simulation-tools-group"/.test(src));
  });
});
