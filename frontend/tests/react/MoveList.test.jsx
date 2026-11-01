// Render MoveList + hook useMoveHistory: danh sách ngữ nghĩa có tên, hàng Đỏ|Đen, ghi chú khi thiếu lịch sử.
import { cleanup, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MoveList from '../../src/presentation/components/match/MoveList.jsx';
import { useMoveHistory } from '../../src/application/hooks/useMoveHistory.js';

const move = (color, from, to, captured = false) => ({ color, from, to, captured });

describe('MoveList', () => {
  afterEach(cleanup);

  it('rỗng: có vùng tên "Lịch sử nước đi" và câu báo chưa có nước, không có <li>', () => {
    render(<MoveList moves={[]} />);
    const region = screen.getByRole('region', { name: 'Lịch sử nước đi' });
    expect(within(region).getByText('Chưa có nước đi nào.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByTestId('move-list-partial-note')).toBeNull();
  });

  it('hiện danh sách có tên, mỗi hàng: số thứ tự + nước Đỏ + nước Đen; nước ăn quân có dấu ×', () => {
    render(<MoveList moves={[move('red', 'e3', 'e4'), move('black', 'a6', 'a5'), move('red', 'b2', 'b9', true)]} />);
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

  it('đánh dấu nước mới nhất bằng aria-current', () => {
    const { container } = render(<MoveList moves={[move('red', 'e3', 'e4'), move('black', 'a6', 'a5')]} />);
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('a6→a5');
  });

  it('ô trống của hàng thiếu nước được ẩn khỏi trình đọc màn hình', () => {
    const { container } = render(<MoveList moves={[move('black', 'a6', 'a5')]} />);
    expect(container.querySelector('.move-cell.is-empty')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tổng số nước lớn hơn danh sách: báo lịch sử chỉ gồm các nước từ khi mở trang, và đánh số theo ván thật', () => {
    render(<MoveList moves={[move('red', 'e3', 'e4'), move('black', 'a6', 'a5')]} totalPly={8} />);
    expect(screen.getByTestId('move-list-partial-note')).toHaveTextContent('Lịch sử chỉ gồm các nước từ khi mở trang');
    expect(screen.getByRole('listitem')).toHaveTextContent('4.');
  });

  it('tổng số nước bằng số nước đã ghi: không hiện ghi chú', () => {
    render(<MoveList moves={[move('red', 'e3', 'e4')]} totalPly={1} />);
    expect(screen.queryByTestId('move-list-partial-note')).toBeNull();
  });
});

describe('useMoveHistory', () => {
  it('ghi nước mới khi observedMoves đổi, khử trùng nước lặp, reset khi đổi ván', () => {
    const { result, rerender } = renderHook(({ id, moves }) => useMoveHistory(id, moves), {
      initialProps: { id: 'm1', moves: [move('red', 'e3', 'e4')] },
    });
    expect(result.current).toHaveLength(1);

    rerender({ id: 'm1', moves: [move('red', 'e3', 'e4')] }); // cùng nước, mảng mới (kết nối lại)
    expect(result.current).toHaveLength(1);

    rerender({ id: 'm1', moves: [move('black', 'a6', 'a5')] });
    expect(result.current.map((m) => m.to)).toEqual(['e4', 'a5']);

    rerender({ id: 'm2', moves: [] });
    expect(result.current).toEqual([]);

    rerender({ id: 'm2', moves: [move('red', 'b0', 'c2')] });
    expect(result.current.map((m) => m.to)).toEqual(['c2']);
  });
});
