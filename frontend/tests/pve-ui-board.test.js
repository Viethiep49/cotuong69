/**
 * PVE-UI: logic thuần của màn hình chơi với máy (src/domain/pve/pveBoard.js) và nối dây với JS cũ.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const load = () => import(pathToFileURL(path.join(ROOT, 'src/domain/pve/pveBoard.js')).href);

describe('PVE-UI: ánh xạ toạ độ backend {row,col} <-> chuỗi của XiangqiBoard', () => {
  test('qua lại đúng và từ chối giá trị lạ', async () => {
    const { squareToPosition, positionToSquare } = await load();
    assert.strictEqual(squareToPosition({ row: 0, col: 0 }), 'a0');
    assert.strictEqual(squareToPosition({ row: 9, col: 8 }), 'i9');
    assert.strictEqual(squareToPosition({ row: 3, col: 4 }), 'e3');
    assert.deepStrictEqual(positionToSquare('a3'), { row: 3, col: 0 });
    assert.deepStrictEqual(positionToSquare('i9'), { row: 9, col: 8 });
    for (const bad of [null, undefined, 'j3', 'a10', '', 'A3', 5]) assert.strictEqual(positionToSquare(bad), null, String(bad));
    for (const bad of [null, { row: -1, col: 0 }, { row: 10, col: 0 }, { row: 0, col: 9 }, { row: 1.5, col: 0 }]) {
      assert.strictEqual(squareToPosition(bad), null);
    }
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        assert.deepStrictEqual(positionToSquare(squareToPosition({ row, col })), { row, col });
      }
    }
  });

  test('thế khai cuộc của backend -> 32 quân: Tướng Đỏ ở e0 (dưới), Tướng Đen ở e9, Pháo Đỏ b2, Chốt Đen a6', async () => {
    const { boardToPieces } = await load();
    const backendBoard = path.resolve(ROOT, '../backend/src/domain/rules/board.js');
    if (!fs.existsSync(backendBoard)) return; // chỉ chạy khi có cả backend trong repo
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { createInitialBoard } = require(backendBoard);
    const pieces = boardToPieces(createInitialBoard());
    assert.strictEqual(pieces.length, 32);
    const at = (position) => pieces.find((p) => p.position === position);
    assert.deepStrictEqual([at('e0').color, at('e0').type], ['red', 'general']);
    assert.deepStrictEqual([at('e9').color, at('e9').type], ['black', 'general']);
    assert.deepStrictEqual([at('b2').color, at('b2').type], ['red', 'cannon']);
    assert.deepStrictEqual([at('a6').color, at('a6').type], ['black', 'soldier']);
    assert.deepStrictEqual([at('a0').type, at('b0').type, at('c0').type, at('d0').type], ['chariot', 'horse', 'elephant', 'advisor']);
    assert.strictEqual(new Set(pieces.map((p) => p.id)).size, 32, 'id quân phải duy nhất');
  });

  test('bỏ qua ô/quân hỏng thay vì ném lỗi', async () => {
    const { boardToPieces } = await load();
    assert.deepStrictEqual(boardToPieces(null), []);
    const board = [[{ type: 'K', color: 'red' }, { type: 'X', color: 'red' }, { type: 'K', color: 'green' }, null, 5], null];
    assert.deepStrictEqual(boardToPieces(board).map((p) => p.position), ['a0']);
  });
});

describe('PVE-UI: kết quả và lý do bằng tiếng Việt', () => {
  test('WIN / LOSS / DRAW cùng các lý do của backend', async () => {
    const { describeResult } = await load();
    const f = (result, endReason) => describeResult({ status: 'FINISHED', result, endReason });
    assert.strictEqual(f('WIN', 'CHECKMATE').title, 'Chiến thắng');
    assert.strictEqual(f('LOSS', 'RESIGN').title, 'Thất bại');
    assert.strictEqual(f('DRAW', 'DRAW_PLY_LIMIT').title, 'Hoà cờ');
    const reasons = {
      CHECKMATE: 'Chiếu bí',
      NO_LEGAL_MOVES: 'Hết nước đi',
      TIMEOUT: 'Hết thời gian',
      RESIGN: 'Xin thua',
      DRAW_PLY_LIMIT: 'Hết giới hạn số nước đi',
    };
    for (const [code, label] of Object.entries(reasons)) assert.strictEqual(f('LOSS', code).reason, label, code);
    assert.strictEqual(f('LOSS', 'LA_HOAC_MOI').reason, 'Kết thúc ván đấu');
  });

  test('thiếu/lạ kết quả -> UNKNOWN trung tính (không phải Thất bại); ván đang chơi -> null', async () => {
    const { describeResult } = await load();
    for (const result of [null, undefined, '', 'GIBBERISH']) {
      const d = describeResult({ status: 'FINISHED', result, endReason: null });
      assert.strictEqual(d.kind, 'UNKNOWN');
      assert.strictEqual(d.title, 'Ván đấu đã kết thúc');
      assert.strictEqual(d.reason, null);
    }
    assert.strictEqual(describeResult({ status: 'PLAYING', result: null }), null);
    assert.strictEqual(describeResult(null), null);
  });
});

describe('PVE-UI: tiện ích', () => {
  test('formatClockMs làm tròn lên và không âm', async () => {
    const { formatClockMs } = await load();
    assert.strictEqual(formatClockMs(60000), '01:00');
    assert.strictEqual(formatClockMs(59001), '01:00');
    assert.strictEqual(formatClockMs(1), '00:01');
    assert.strictEqual(formatClockMs(0), '00:00');
    assert.strictEqual(formatClockMs(-500), '00:00');
    assert.strictEqual(formatClockMs(NaN), '00:00');
  });

  test('shouldAdoptMatch: không để phản hồi cũ ghi đè trạng thái mới', async () => {
    const { shouldAdoptMatch } = await load();
    assert.strictEqual(shouldAdoptMatch(null, { ply: 0, status: 'PLAYING' }), true);
    assert.strictEqual(shouldAdoptMatch({ ply: 4, status: 'PLAYING' }, { ply: 2, status: 'PLAYING' }), false);
    assert.strictEqual(shouldAdoptMatch({ ply: 4, status: 'PLAYING' }, { ply: 4, status: 'PLAYING' }), true);
    assert.strictEqual(shouldAdoptMatch({ ply: 4, status: 'PLAYING' }, { ply: 3, status: 'FINISHED' }), true);
    assert.strictEqual(shouldAdoptMatch({ ply: 4, status: 'FINISHED' }, { ply: 5, status: 'PLAYING' }), false);
  });

  test('parsePveMatchId chỉ nhận số nguyên dương 1-9 chữ số', async () => {
    const { parsePveMatchId } = await load();
    assert.strictEqual(parsePveMatchId('12'), '12');
    for (const bad of [null, '', '0', '012', 'abc', '1e3', '-1', '1234567890', '1 2']) assert.strictEqual(parsePveMatchId(bad), null, String(bad));
  });
});

describe('PVE-UI: nối dây', () => {
  test('JS cũ chuyển sang /?pveMatchId=<id> sau khi tạo trận; Root chọn PveScreen theo tham số đó', () => {
    const rooms = read('js/rooms.js');
    assert.ok(rooms.includes('openPveMatchScreen(response.match.id)'));
    assert.ok(rooms.includes("url.searchParams.set('pveMatchId'"));
    const root = read('src/Root.jsx');
    assert.ok(root.includes("params.has('pveMatchId')") && root.includes('PveScreen'));
    assert.ok(read('src/main.jsx').includes('<Root />'));
  });

  test('index.html không tham chiếu file cục bộ không tồn tại (favicon /vite.svg)', () => {
    const html = read('index.html');
    assert.ok(!html.includes('/vite.svg'));
    for (const match of html.matchAll(/(?:src|href)="\/([^"#?]+)"/g)) {
      const rel = match[1];
      if (rel.startsWith('src/') || rel.startsWith('js/') || rel.startsWith('css/')) continue; // Vite bundle
      assert.ok(fs.existsSync(path.join(ROOT, 'public', rel)), `thiếu public/${rel}`);
    }
  });

  test('màn hình dùng lại XiangqiBoard và API PvE thật (không tự tính luật/nước máy)', () => {
    const screen = read('src/presentation/pve/PveScreen.jsx');
    assert.ok(screen.includes("from '../components/board/XiangqiBoard'"));
    const api = read('src/infrastructure/api/pveApi.js');
    assert.ok(api.includes('/moves') && api.includes('/resign') && api.includes('buildAuthHeaders'));
  });
});
