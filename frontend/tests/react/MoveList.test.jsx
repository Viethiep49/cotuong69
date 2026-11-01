// Render MoveList + hook useMoveHistory: danh sách ngữ nghĩa có tên, hàng Đỏ|Đen, hàng "…" khi thiếu nước,
// ghi chú khi thiếu lịch sử, và hook không ghi nước của ván trước sang ván mới.
import { cleanup, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MoveList from '../../src/presentation/components/match/MoveList.jsx';
import { useMoveHistory } from '../../src/application/hooks/useMoveHistory.js';

const move = (ply, color, from, to, captured = false) => ({ ply, color, from, to, captured });

describe('MoveList', () => {
  afterEach(cleanup);

  it('rỗng: vùng có tên theo tiêu đề, câu báo chưa có nước, không có <li>, đếm 0 nước', () => {
    render(<MoveList moves={[]} />);
    const region = screen.getByRole('region', { name: 'Nước đi' });
    expect(within(region).getByText('Chưa có nước đi nào.')).toBeInTheDocument();
    expect(within(region).getByText('0 nước')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByTestId('move-list-partial-note')).toBeNull();
  });

  it('rỗng nhưng ván đã đi nhiều nước (mở trang giữa ván): nói "Chưa ghi nhận nước nào từ khi mở trang", không hiện "0 nước"', () => {
    render(<MoveList moves={[]} totalPly={14} />);
    expect(screen.getByText('Chưa ghi nhận nước nào từ khi mở trang.')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có nước đi nào.')).toBeNull();
    expect(screen.queryByText('0 nước')).toBeNull();
    expect(screen.getByTestId('move-list-partial-note')).toHaveTextContent('Lịch sử chỉ gồm các nước từ khi mở trang');
  });

  it('hiện danh sách có tên, mỗi hàng: số thứ tự + nước Đỏ + nước Đen; nước ăn quân có dấu ×', () => {
    render(<MoveList moves={[move(1, 'red', 'e3', 'e4'), move(2, 'black', 'a6', 'a5'), move(3, 'red', 'b2', 'b9', true)]} />);
    const list = screen.getByRole('list', { name: 'Danh sách nước đi' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1.');
    expect(rows[0]).toHaveTextContent('Đỏ e3→e4');
    expect(rows[0]).toHaveTextContent('Đen a6→a5');
    expect(rows[1]).toHaveTextContent('2.');
    expect(rows[1]).toHaveTextContent('Đỏ b2→b9 ×');
    expect(screen.getByText('3 nước')).toBeInTheDocument();
  });

  it('trợ năng: ký hiệu →/× ẩn khỏi trình đọc màn hình và có câu thay thế "đến" / "ăn quân"; vùng cuộn focus được', () => {
    const { container } = render(<MoveList moves={[move(1, 'red', 'b2', 'b9', true)]} />);
    const visible = container.querySelector('.move-text');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible).toHaveTextContent('b2→b9 ×');
    expect(container.querySelector('.move-cell')).toHaveTextContent('b2 đến b9, ăn quân');
    const scroll = container.querySelector('.move-list-scroll');
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('group', { name: 'Nước đi' })).toBe(scroll);
  });

  it('đánh dấu nước mới nhất bằng aria-current', () => {
    const { container } = render(<MoveList moves={[move(1, 'red', 'e3', 'e4'), move(2, 'black', 'a6', 'a5')]} />);
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('a6→a5');
  });

  it('ô trống của hàng thiếu nước được ẩn khỏi trình đọc màn hình', () => {
    const { container } = render(<MoveList moves={[move(4, 'black', 'a6', 'a5')]} />);
    expect(container.querySelector('.move-cell.is-empty')).toHaveAttribute('aria-hidden', 'true');
  });

  it('thiếu nước ở giữa: số hàng theo ply thật (1 rồi 4) và có hàng "…" cho hàng 2-3', () => {
    const moves = [move(1, 'red', 'e3', 'e4'), move(2, 'black', 'a6', 'a5'), move(7, 'red', 'c3', 'c4')];
    const { container } = render(<MoveList moves={moves} totalPly={7} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('1.');
    expect(items[1]).toHaveAttribute('data-move-gap', '2-3');
    expect(items[1]).toHaveTextContent('Thiếu hàng 2–3');
    expect(items[2]).toHaveTextContent('4.');
    expect(items[2]).toHaveTextContent('Đỏ c3→c4');
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    // chỉ ghi 3/7 nước -> báo thiếu
    expect(screen.getByTestId('move-list-partial-note')).toBeInTheDocument();
    expect(screen.getByText('3 / 7 nước')).toBeInTheDocument();
  });

  it('mở trang giữa ván: số hàng đúng theo ply và báo lịch sử chỉ gồm các nước từ khi mở trang', () => {
    render(<MoveList moves={[move(7, 'red', 'e3', 'e4'), move(8, 'black', 'a6', 'a5')]} totalPly={8} />);
    expect(screen.getByTestId('move-list-partial-note')).toHaveTextContent('Lịch sử chỉ gồm các nước từ khi mở trang');
    expect(screen.getByRole('listitem')).toHaveTextContent('4.');
  });

  it('đã ghi đủ nước: không hiện ghi chú', () => {
    render(<MoveList moves={[move(1, 'red', 'e3', 'e4')]} totalPly={1} />);
    expect(screen.queryByTestId('move-list-partial-note')).toBeNull();
  });
});

describe('useMoveHistory', () => {
  const lm = (color, from, to) => ({ color, from, to, captured: false });

  it('ghi nước mới khi observedMoves đổi, khử trùng nước lặp, reset khi đổi ván', () => {
    const { result, rerender } = renderHook(({ id, moves, total }) => useMoveHistory(id, moves, total), {
      initialProps: { id: 'm1', moves: [lm('red', 'e3', 'e4')], total: 1 },
    });
    expect(result.current).toHaveLength(1);

    rerender({ id: 'm1', moves: [lm('red', 'e3', 'e4')], total: 1 }); // cùng nước, mảng mới (kết nối lại)
    expect(result.current).toHaveLength(1);

    rerender({ id: 'm1', moves: [lm('black', 'a6', 'a5')], total: 2 });
    expect(result.current.map((m) => `${m.ply}:${m.to}`)).toEqual(['1:e4', '2:a5']);

    rerender({ id: 'm2', moves: [], total: 0 });
    expect(result.current).toEqual([]);

    rerender({ id: 'm2', moves: [lm('red', 'b0', 'c2')], total: 1 });
    expect(result.current.map((m) => `${m.ply}:${m.to}`)).toEqual(['1:c2']);
  });

  it('đổi khoá ván trong khi mảng quan sát cũ (KHÔNG rỗng) vẫn còn: không ghi nước cũ sang ván mới, kể cả ở lần render đầu của khoá mới', () => {
    const stale = [lm('red', 'e3', 'e4')];
    const seen = [];
    const { result, rerender } = renderHook(({ id, moves, total }) => {
      const value = useMoveHistory(id, moves, total);
      seen.push(`${id}:${value.length}`);
      return value;
    }, { initialProps: { id: 'room:m1', moves: stale, total: 1 } });
    expect(result.current).toHaveLength(1);

    rerender({ id: 'room:m2', moves: stale, total: 0 });
    expect(result.current).toEqual([]);
    // chưa từng có khung hình nào của khoá mới chứa nước của ván cũ
    expect(seen.filter((entry) => entry.startsWith('room:m2')).every((entry) => entry === 'room:m2:0')).toBe(true);
  });

  it('tổng số nước tụt xuống (ván demo tự reset, cùng khoá): danh sách bắt đầu lại', () => {
    const { result, rerender } = renderHook(({ moves, total }) => useMoveHistory('demo:COT-615', moves, total), {
      initialProps: { moves: [lm('red', 'e3', 'e4')], total: 11 },
    });
    expect(result.current.map((m) => m.ply)).toEqual([11]);
    rerender({ moves: [], total: 0 });
    expect(result.current).toEqual([]);
  });
});
