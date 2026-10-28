// CLEAN-04: test render + tương tác click-chọn-quân-rồi-đi của XiangqiBoard (jsdom).
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import XiangqiBoard from '../../src/presentation/components/board/XiangqiBoard.jsx';

const FILES = 'abcdefghi';

// Thế khai cuộc đầy đủ 32 quân theo định dạng server gửi: { id, color, type, position }
function openingPieces() {
  const pieces = [];
  const back = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  for (const [color, backRank, cannonRank, soldierRank] of [['red', 0, 2, 3], ['black', 9, 7, 6]]) {
    back.forEach((type, file) => {
      pieces.push({ id: `${color}-${type}-${FILES[file]}`, color, type, position: `${FILES[file]}${backRank}` });
    });
    for (const file of [1, 7]) {
      pieces.push({ id: `${color}-cannon-${FILES[file]}`, color, type: 'cannon', position: `${FILES[file]}${cannonRank}` });
    }
    for (const file of [0, 2, 4, 6, 8]) {
      pieces.push({ id: `${color}-soldier-${FILES[file]}`, color, type: 'soldier', position: `${FILES[file]}${soldierRank}` });
    }
  }
  return pieces;
}

// Toạ độ SVG (viewBox 900x1000) của giao điểm, đúng với cách bàn cờ vẽ
function svgPointOf(position, orientation = 'red') {
  const file = FILES.indexOf(position[0]);
  const rank = Number(position[1]);
  const left = 54, right = 846, top = 48, bottom = 952;
  return orientation === 'black'
    ? { x: right - (right - left) * (file / 8), y: top + (bottom - top) * (rank / 9) }
    : { x: left + (right - left) * (file / 8), y: bottom - (bottom - top) * (rank / 9) };
}

// jsdom không có hình học SVG: cho toạ độ chuột (clientX/Y) trùng toạ độ viewBox
function stubSvgGeometry(svg) {
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() { return { x: this.x, y: this.y }; },
  });
}

function renderBoard(props = {}) {
  const onMove = vi.fn();
  const view = render(
    <XiangqiBoard pieces={openingPieces()} readOnly={false} interactive playerColor="red" onMove={onMove} {...props} />,
  );
  const svg = view.container.querySelector('svg.xiangqi-board');
  stubSvgGeometry(svg);
  const clickAt = (position, orientation = props.orientation || 'red') => {
    const { x, y } = svgPointOf(position, orientation);
    fireEvent.click(svg, { clientX: x, clientY: y });
  };
  const pieceNode = (position) => view.container.querySelector(`[data-position="${position}"]`);
  return { ...view, svg, onMove, clickAt, pieceNode };
}

describe('XiangqiBoard: hiển thị', () => {
  it('vẽ đủ 32 quân của thế khai cuộc với nhãn truy cập được', () => {
    const { container, getByLabelText } = renderBoard();
    expect(container.querySelectorAll('[data-piece-id]')).toHaveLength(32);
    expect(getByLabelText('Đỏ Tướng tại e0')).toBeInTheDocument();
    expect(getByLabelText('Đen Tướng tại e9')).toBeInTheDocument();
    expect(getByLabelText('Đỏ Pháo tại b2')).toBeInTheDocument();
    expect(getByLabelText('Đen Chốt tại a6')).toBeInTheDocument();
  });

  it('đặt quân đúng vị trí: Đỏ ở phía dưới, Đen ở phía trên (góc nhìn Đỏ)', () => {
    const { pieceNode } = renderBoard();
    const red = svgPointOf('e0');
    const black = svgPointOf('e9');
    expect(pieceNode('e0').getAttribute('transform')).toBe(`translate(${red.x} ${red.y})`);
    expect(pieceNode('e9').getAttribute('transform')).toBe(`translate(${black.x} ${black.y})`);
    expect(red.y).toBeGreaterThan(black.y);
  });

  it('góc nhìn Đen lật bàn cờ và đảo thứ tự cột a..i', () => {
    const { pieceNode, container } = renderBoard({ orientation: 'black', playerColor: 'black' });
    const redGeneral = svgPointOf('e0', 'black');
    expect(pieceNode('e0').getAttribute('transform')).toBe(`translate(${redGeneral.x} ${redGeneral.y})`);
    const letters = [...container.querySelectorAll('.coordinate-top span')].map((n) => n.textContent);
    expect(letters).toEqual([...FILES].reverse());
  });

  it('bỏ qua quân có vị trí hoặc loại quân không hợp lệ thay vì vỡ giao diện', () => {
    const pieces = [
      { id: 'ok', color: 'red', type: 'general', position: 'e0' },
      { id: 'bad-pos', color: 'red', type: 'soldier', position: 'z9' },
      { id: 'no-pos', color: 'red', type: 'soldier', position: undefined },
      { id: 'bad-type', color: 'black', type: 'dragon', position: 'a5' },
    ];
    const { container } = renderBoard({ pieces });
    expect([...container.querySelectorAll('[data-piece-id]')].map((n) => n.dataset.pieceId)).toEqual(['ok']);
  });

  it('chế độ chỉ xem hiện nhãn quan sát, người chơi thì không', () => {
    const watching = renderBoard({ readOnly: true, interactive: false });
    expect(watching.getByText(/CHẾ ĐỘ QUAN SÁT/)).toBeInTheDocument();
    watching.unmount();
    const playing = renderBoard({ readOnly: false });
    expect(playing.queryByText(/CHẾ ĐỘ QUAN SÁT/)).not.toBeInTheDocument();
  });

  it('đếm ngược bắt đầu trận hiện số giây còn lại', () => {
    const { getByRole } = renderBoard({ countdown: 3 });
    expect(getByRole('status')).toHaveTextContent('3');
  });

  it('highlight Tướng bị chiếu quanh đúng quân Tướng của bên bị chiếu', () => {
    const { container } = renderBoard({ checkedColor: 'black' });
    const circle = container.querySelector('.check-highlight-layer circle');
    const general = svgPointOf('e9');
    expect(circle.getAttribute('cx')).toBe(String(general.x));
    expect(circle.getAttribute('cy')).toBe(String(general.y));
    // không bị chiếu thì không có highlight
    const calm = renderBoard();
    expect(calm.container.querySelector('.check-highlight-layer')).toBeNull();
  });
});

describe('XiangqiBoard: đi quân bằng click', () => {
  it('chọn quân của mình rồi bấm ô đích thì gọi onMove(từ, đến) và bỏ chọn', () => {
    const { clickAt, onMove, pieceNode } = renderBoard();
    clickAt('a3');
    expect(pieceNode('a3')).toHaveClass('is-selected');
    expect(onMove).not.toHaveBeenCalled();

    clickAt('a4');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('a3', 'a4');
    expect(pieceNode('a3')).not.toHaveClass('is-selected');
  });

  it('bấm lại đúng quân đang chọn thì bỏ chọn, bấm quân mình khác thì đổi chọn', () => {
    const { clickAt, pieceNode, onMove } = renderBoard();
    clickAt('a3');
    clickAt('a3');
    expect(pieceNode('a3')).not.toHaveClass('is-selected');

    clickAt('a3');
    clickAt('c3');
    expect(pieceNode('a3')).not.toHaveClass('is-selected');
    expect(pieceNode('c3')).toHaveClass('is-selected');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('chọn quân rồi bấm vào quân đối phương = đi ăn quân (onMove tới ô của quân đó)', () => {
    const { clickAt, onMove } = renderBoard();
    clickAt('b2'); // Pháo đỏ
    clickAt('b9'); // Mã đen
    expect(onMove).toHaveBeenCalledWith('b2', 'b9');
  });

  it('không chọn được quân của đối phương', () => {
    const { clickAt, pieceNode, onMove } = renderBoard();
    clickAt('a6');
    expect(pieceNode('a6')).not.toHaveClass('is-selected');
    clickAt('a5');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('bấm ô trống khi chưa chọn quân thì không làm gì', () => {
    const { clickAt, onMove } = renderBoard();
    clickAt('e5');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('không tương tác khi board không interactive (khán giả / chưa tới lượt)', () => {
    const { clickAt, pieceNode, onMove } = renderBoard({ interactive: false });
    clickAt('a3');
    clickAt('a4');
    expect(pieceNode('a3')).not.toHaveClass('is-selected');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('khoá thao tác khi đang chờ server xác nhận nước đi trước (movePending)', () => {
    const { clickAt, onMove } = renderBoard({ movePending: true });
    clickAt('a3');
    clickAt('a4');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('góc nhìn Đen: ánh xạ toạ độ chuột về đúng ô khi lật bàn cờ', () => {
    const { clickAt, onMove } = renderBoard({ orientation: 'black', playerColor: 'black' });
    clickAt('a6');
    clickAt('a5');
    expect(onMove).toHaveBeenCalledWith('a6', 'a5');
  });

  it('bấm ngoài lưới (xa mọi giao điểm) bị bỏ qua', () => {
    const { svg, onMove } = renderBoard();
    fireEvent.click(svg, { clientX: 1, clientY: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('thế cờ thay đổi (server xác nhận nước đi) thì bỏ chọn quân cũ', () => {
    const initial = openingPieces();
    const { clickAt, pieceNode, rerender, onMove, container } = renderBoard({ pieces: initial });
    clickAt('a3');
    expect(pieceNode('a3')).toHaveClass('is-selected');

    const moved = initial.map((piece) => (piece.id === 'red-soldier-a' ? { ...piece, position: 'a4' } : piece));
    rerender(<XiangqiBoard pieces={moved} readOnly={false} interactive playerColor="red" onMove={onMove} />);
    expect(container.querySelector('.is-selected')).toBeNull();
    expect(container.querySelector('[data-position="a4"]')).toBeInTheDocument();
  });
});
