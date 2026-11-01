// Lịch sử nước đi phía client: ghi nước quan sát được, khử trùng, reset khi đổi ván, gom thành hàng "Đỏ | Đen".
import { describe, expect, it } from 'vitest';
import {
  buildMoveRows,
  createMoveHistory,
  formatMove,
  isHistoryPartial,
  normalizeMove,
  recordMoves,
} from '../../src/domain/game/moveHistory.js';

const red = (from, to, extra = {}) => ({ color: 'red', from, to, ...extra });
const black = (from, to, extra = {}) => ({ color: 'black', from, to, ...extra });

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

describe('recordMoves', () => {
  it('thêm lần lượt theo thứ tự quan sát', () => {
    let history = createMoveHistory('m1');
    history = recordMoves(history, 'm1', [red('e3', 'e4'), black('a6', 'a5')]);
    history = recordMoves(history, 'm1', [red('b2', 'b9', { captured: true })]);
    expect(history.moves.map((m) => `${m.color}:${m.from}${m.to}`)).toEqual(['red:e3e4', 'black:a6a5', 'red:b2b9']);
    expect(history.moves[2].captured).toBe(true);
  });

  it('khử trùng nước cuối được báo lại (tải lại / kết nối lại) và trả đúng đối tượng cũ để không render thừa', () => {
    const history = recordMoves(createMoveHistory('m1'), 'm1', [red('e3', 'e4')]);
    expect(recordMoves(history, 'm1', [red('e3', 'e4')])).toBe(history);
    expect(recordMoves(history, 'm1', [])).toBe(history);
    expect(recordMoves(history, 'm1', null)).toBe(history);
    expect(recordMoves(history, 'm1', [{ color: 'red' }])).toBe(history);
  });

  it('không sửa mảng cũ (bất biến)', () => {
    const first = recordMoves(createMoveHistory('m1'), 'm1', [red('e3', 'e4')]);
    const second = recordMoves(first, 'm1', [black('a6', 'a5')]);
    expect(first.moves).toHaveLength(1);
    expect(second.moves).toHaveLength(2);
  });

  it('đổi matchId thì bắt đầu lại danh sách', () => {
    const first = recordMoves(createMoveHistory('m1'), 'm1', [red('e3', 'e4'), black('a6', 'a5')]);
    const second = recordMoves(first, 'm2', [red('b0', 'c2')]);
    expect(second.matchId).toBe('m2');
    expect(second.moves).toEqual([{ color: 'red', from: 'b0', to: 'c2', captured: false }]);
    expect(recordMoves(first, 'm2', []).moves).toEqual([]);
  });
});

describe('buildMoveRows', () => {
  it('gom Đỏ + Đen vào cùng hàng, đánh số từ 1', () => {
    const { moves } = recordMoves(createMoveHistory('m'), 'm', [red('e3', 'e4'), black('a6', 'a5'), red('b2', 'b3')]);
    const rows = buildMoveRows(moves);
    expect(rows.map((r) => [r.number, r.red && r.red.to, r.black && r.black.to])).toEqual([
      [1, 'e4', 'a5'],
      [2, 'b3', null],
    ]);
  });

  it('người cầm Đen mở trang khi chỉ thấy nước Đen: ô Đỏ để trống, hàng kế tiếp mở bằng nước Đỏ', () => {
    const { moves } = recordMoves(createMoveHistory('m'), 'm', [black('a6', 'a5'), red('e3', 'e4')]);
    const rows = buildMoveRows(moves);
    expect(rows).toHaveLength(2);
    expect(rows[0].red).toBeNull();
    expect(rows[0].black.to).toBe('a5');
    expect(rows[1].red.to).toBe('e4');
  });

  it('có tổng số nước: số hàng đầu khớp ván thật dù thiếu các nước trước', () => {
    const { moves } = recordMoves(createMoveHistory('m'), 'm', [red('e3', 'e4'), black('a6', 'a5')]);
    expect(buildMoveRows(moves, { totalPly: 10 }).map((r) => r.number)).toEqual([5]);
    // nước Đen quan sát được đầu tiên ở ply 5 (0-based) thuộc hàng 3
    const blackFirst = recordMoves(createMoveHistory('m'), 'm', [black('a6', 'a5')]).moves;
    expect(buildMoveRows(blackFirst, { totalPly: 6 }).map((r) => r.number)).toEqual([3]);
    // tổng nhỏ hơn số nước đã ghi (dữ liệu lạ): bỏ qua, đánh số từ 1
    expect(buildMoveRows(moves, { totalPly: 1 }).map((r) => r.number)).toEqual([1]);
  });

  it('danh sách rỗng/không hợp lệ -> không có hàng', () => {
    expect(buildMoveRows([])).toEqual([]);
    expect(buildMoveRows(null)).toEqual([]);
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
