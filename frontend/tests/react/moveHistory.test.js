// Lịch sử nước đi phía client: ghi nước quan sát được kèm số ply, khử trùng, reset khi đổi/ván mới,
// gom thành hàng "Đỏ | Đen" (có hàng "…" khi thiếu nước ở giữa) và công thức tổng số nước.
import { describe, expect, it } from 'vitest';
import { BoardSyncManager } from '../../src/domain/game/boardSyncManager.js';
import {
  buildMoveRows,
  createMoveHistory,
  formatMove,
  getTotalPly,
  isHistoryPartial,
  normalizeMove,
  recordMoves,
} from '../../src/domain/game/moveHistory.js';

const red = (from, to, extra = {}) => ({ color: 'red', from, to, ...extra });
const black = (from, to, extra = {}) => ({ color: 'black', from, to, ...extra });
const record = (history, id, moves, totalPly = null) => recordMoves(history, id, moves, { totalPly });
const plies = (history) => history.moves.map((m) => m.ply);

describe('normalizeMove', () => {
  it('nhận from/to dạng chuỗi hoặc {row,col}; giữ cờ ăn quân', () => {
    expect(normalizeMove(red('e3', 'e4'))).toEqual({ color: 'red', from: 'e3', to: 'e4', captured: false });
    expect(normalizeMove({ side: 'black', from: { row: 6, col: 0 }, to: { row: 5, col: 0 }, captured: { type: 'soldier' } }))
      .toEqual({ color: 'black', from: 'a6', to: 'a5', captured: true });
  });

  it('bỏ nước thiếu/hỏng thay vì bịa', () => {
    const bad = [null, undefined, 'e3e4', {}, red('z3', 'e4'), red('e3', 'e10'), { from: 'e3', to: 'e4' },
      { color: 'green', from: 'e3', to: 'e4' }, red({ row: 10, col: 0 }, 'a1')];
    for (const value of bad) expect(normalizeMove(value)).toBeNull();
  });
});

describe('recordMoves: số ply', () => {
  it('không biết tổng số nước: đánh số tiếp 1, 2, 3 theo thứ tự quan sát', () => {
    let history = record(null, 'm1', [red('e3', 'e4'), black('a6', 'a5')]);
    history = record(history, 'm1', [red('b2', 'b9', { captured: true })]);
    expect(plies(history)).toEqual([1, 2, 3]);
    expect(history.moves[2]).toEqual({ ply: 3, color: 'red', from: 'b2', to: 'b9', captured: true });
  });

  it('biết tổng số nước: nước cuối có ply = tổng, nước thứ i có ply = tổng - (n - 1 - i)', () => {
    const history = record(null, 'm1', [red('e3', 'e4'), black('a6', 'a5')], 8);
    expect(plies(history)).toEqual([7, 8]);
  });

  it('khử trùng theo ply và theo nước cuối được báo lại; trả đúng đối tượng cũ khi cùng mảng + cùng tổng', () => {
    const observed = [red('e3', 'e4')];
    const history = record(null, 'm1', observed, 1);
    expect(recordMoves(history, 'm1', observed, { totalPly: 1 })).toBe(history);
    // mảng mới nhưng cùng nước (kết nối lại): không thêm
    const again = record(history, 'm1', [red('e3', 'e4')], 1);
    expect(again.moves).toHaveLength(1);
    // tổng ply nhích lên mà nước báo lại vẫn là nước cũ (lastMove cũ được giữ): không ghi với ply sai
    const stale = record(again, 'm1', [red('e3', 'e4')], 3);
    expect(stale.moves).toHaveLength(1);
    expect(stale.moves[0].ply).toBe(1);
  });

  it('không sửa mảng cũ (bất biến)', () => {
    const first = record(null, 'm1', [red('e3', 'e4')]);
    const second = record(first, 'm1', [black('a6', 'a5')]);
    expect(first.moves).toHaveLength(1);
    expect(second.moves).toHaveLength(2);
  });

  it('thiếu nước ở giữa (kết nối lại): ply nhảy cách, không dồn lại', () => {
    let history = record(null, 'm1', [red('e3', 'e4')], 1);
    history = record(history, 'm1', [black('a6', 'a5')], 2);
    history = record(history, 'm1', [red('c3', 'c4')], 7); // bỏ lỡ ply 3..6
    expect(plies(history)).toEqual([1, 2, 7]);
  });

  it('đổi matchId thì bắt đầu lại danh sách', () => {
    const first = record(null, 'm1', [red('e3', 'e4'), black('a6', 'a5')]);
    const second = record(first, 'm2', [red('b0', 'c2')]);
    expect(second.matchId).toBe('m2');
    expect(second.moves).toEqual([{ ply: 1, color: 'red', from: 'b0', to: 'c2', captured: false }]);
    expect(record(first, 'm2', []).moves).toEqual([]);
  });

  it('đổi matchId nhưng mảng quan sát vẫn là mảng CŨ (không rỗng) của ván trước: không ghi sang ván mới', () => {
    const stale = [red('e3', 'e4'), black('a6', 'a5')];
    const first = record(null, 'room:m1', stale, 2);
    const second = recordMoves(first, 'room:m2', stale, { totalPly: 2 });
    expect(second.matchId).toBe('room:m2');
    expect(second.moves).toEqual([]);
    // render kế tiếp vẫn chưa có nước mới -> vẫn rỗng; nước mới của ván 2 thì ghi bình thường
    expect(recordMoves(second, 'room:m2', stale, { totalPly: 2 })).toBe(second);
    expect(plies(record(second, 'room:m2', [red('b0', 'c2')], 1))).toEqual([1]);
  });

  it('tổng số nước tụt xuống dưới ply đã ghi (demo tự reset, cùng matchId): bắt đầu danh sách lại', () => {
    let history = record(null, 'demo', [red('e3', 'e4')], 9);
    history = record(history, 'demo', [black('a6', 'a5')], 10);
    expect(plies(history)).toEqual([9, 10]);
    const reset = record(history, 'demo', [], 0);
    expect(reset.moves).toEqual([]);
    expect(reset.matchId).toBe('demo');
    // ván mới có nước đầu tiên
    expect(plies(record(reset, 'demo', [red('b2', 'b4')], 1))).toEqual([1]);
  });

  it('tổng số nước tụt xuống ngay trong lần quan sát nước mới: giữ đúng nước mới của ván mới', () => {
    const history = record(null, 'demo', [red('e3', 'e4'), black('a6', 'a5')], 20);
    const next = record(history, 'demo', [red('b2', 'b4')], 1);
    expect(next.moves.map((m) => `${m.ply}:${m.from}${m.to}`)).toEqual(['1:b2b4']);
  });
});

describe('buildMoveRows', () => {
  it('gom Đỏ + Đen vào cùng hàng theo ply: hàng = ceil(ply / 2)', () => {
    const history = record(null, 'm', [red('e3', 'e4'), black('a6', 'a5'), red('b2', 'b3')]);
    const rows = buildMoveRows(history.moves);
    expect(rows.map((r) => [r.number, r.red && r.red.to, r.black && r.black.to])).toEqual([
      [1, 'e4', 'a5'],
      [2, 'b3', null],
    ]);
  });

  it('người cầm Đen: máy (Đỏ) đi trước, nước Đen quan sát đầu tiên (ply 4) thuộc hàng 2, ô Đỏ để trống', () => {
    const history = record(null, 'm', [black('a6', 'a5')], 4);
    const rows = buildMoveRows(history.moves);
    expect(rows).toHaveLength(1);
    expect(rows[0].number).toBe(2);
    expect(rows[0].red).toBeNull();
    expect(rows[0].black.to).toBe('a5');
  });

  it('thiếu nước ở giữa: số hàng đúng (1 rồi 4) và chèn mục gap cho hàng 2-3', () => {
    let history = record(null, 'm', [red('e3', 'e4'), black('a6', 'a5')], 2);
    history = record(history, 'm', [red('c3', 'c4')], 7); // ply 7 -> hàng 4
    const rows = buildMoveRows(history.moves);
    expect(rows.map((r) => (r.gap ? `gap ${r.from}-${r.to}` : `row ${r.number}`))).toEqual(['row 1', 'gap 2-3', 'row 4']);
    expect(rows[2].red.to).toBe('c4');
    expect(rows[2].black).toBeNull();
  });

  it('chỉ thiếu đúng một hàng: gap from === to', () => {
    let history = record(null, 'm', [red('e3', 'e4')], 1);
    history = record(history, 'm', [red('c3', 'c4')], 5);
    expect(buildMoveRows(history.moves)[1]).toEqual({ gap: true, from: 2, to: 2 });
  });

  it('danh sách rỗng/không hợp lệ hoặc nước không có ply -> không có hàng', () => {
    expect(buildMoveRows([])).toEqual([]);
    expect(buildMoveRows(null)).toEqual([]);
    expect(buildMoveRows([{ color: 'red', from: 'e3', to: 'e4' }])).toEqual([]);
  });
});

describe('getTotalPly', () => {
  it('phòng thật có plyCount -> dùng luôn plyCount', () => {
    expect(getTotalPly({ plyCount: 7, moveNumber: 8, currentTurn: 'black' })).toBe(7);
    expect(getTotalPly({ plyCount: 0, moveNumber: 1, currentTurn: 'red' })).toBe(0);
  });

  it('ván demo: moveNumber đếm theo cặp nước -> (moveNumber - 1) * 2 + (lượt Đen ? 1 : 0)', () => {
    expect(getTotalPly({ moveNumber: 1, currentTurn: 'red' })).toBe(0);
    expect(getTotalPly({ moveNumber: 1, currentTurn: 'black' })).toBe(1);
    expect(getTotalPly({ moveNumber: 4, currentTurn: 'red' })).toBe(6);
    expect(getTotalPly({ moveNumber: 4, currentTurn: 'black' })).toBe(7);
  });

  it('không biết -> null', () => {
    expect(getTotalPly(null)).toBeNull();
    expect(getTotalPly({})).toBeNull();
    expect(getTotalPly({ moveNumber: 'abc' })).toBeNull();
  });
});

describe('formatMove / isHistoryPartial', () => {
  it('định dạng e3→e4, thêm × khi ăn quân', () => {
    expect(formatMove({ from: 'e3', to: 'e4', captured: false })).toBe('e3→e4');
    expect(formatMove({ from: 'b2', to: 'b9', captured: true })).toBe('b2→b9 ×');
    expect(formatMove(null)).toBe('');
  });

  it('chỉ coi là thiếu khi biết tổng số nước và tổng lớn hơn số đã ghi', () => {
    const moves = [{}, {}];
    expect(isHistoryPartial(moves, 5)).toBe(true);
    expect(isHistoryPartial(moves, 2)).toBe(false);
    expect(isHistoryPartial(moves, 0)).toBe(false);
    expect(isHistoryPartial(moves, null)).toBe(false);
    expect(isHistoryPartial(moves, undefined)).toBe(false);
    expect(isHistoryPartial(moves, 'abc')).toBe(false);
  });
});

describe('createMoveHistory', () => {
  it('trạng thái ban đầu rỗng', () => {
    expect(createMoveHistory('x')).toEqual({ matchId: 'x', moves: [], seen: null });
  });
});

describe('getTotalPly với snapshot đã qua BoardSyncManager (App dùng đúng đường này)', () => {
  const restore = (snapshot, previous = null) => BoardSyncManager.restoreFromSnapshot({ board: [], ...snapshot }, previous);

  it('ván demo: snapshot chỉ có moveNumber (đếm theo cặp nước) -> tổng ply theo công thức, tính cả lượt Đen', () => {
    expect(getTotalPly(restore({ moveNumber: 1, currentTurn: 'red' }))).toBe(0);
    expect(getTotalPly(restore({ moveNumber: 3, currentTurn: 'red' }))).toBe(4);
    expect(getTotalPly(restore({ moveNumber: 3, currentTurn: 'black' }))).toBe(5);
  });

  it('phòng thật: snapshot có plyCount -> ưu tiên plyCount, kể cả khi có cả moveNumber', () => {
    expect(getTotalPly(restore({ plyCount: 6, currentTurn: 'red' }))).toBe(6);
    expect(getTotalPly(restore({ plyCount: 6, moveNumber: 2, currentTurn: 'black' }))).toBe(6);
  });

  it('snapshot không kèm số nước giữ giá trị của lần trước', () => {
    const first = restore({ plyCount: 6, currentTurn: 'red' });
    expect(getTotalPly(restore({ currentTurn: 'black' }, first))).toBe(6);
  });
});
