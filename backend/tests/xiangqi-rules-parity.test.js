// CLEAN-01: PvP (xiangqiRules, toạ độ chuỗi) và PvE (domain/rules, lưới {row,col}) phải cho cùng kết quả
// vì PvP giờ chỉ là adapter của domain/rules. Test này chơi các ván ngẫu nhiên có seed và so sánh
// từng thế cờ giữa hai phía.
require('./helpers/testEnv.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCot615Match } = require('../src/domain/entities/cot615Match');
const {
  getLegalMoveError,
  hasLegalMove,
  isInCheck,
  parsePosition,
} = require('../src/domain/entities/xiangqiRules');
const { createInitialBoard } = require('../src/domain/rules/board');
const {
  generateLegalMoves,
  isInCheck: isInCheckOnGrid,
  applyMove,
} = require('../src/domain/rules/moveGenerator');
const { hasAnyLegalMove } = require('../src/domain/rules/gameStatus');

const FILES = 'abcdefghi';
const GRID_TO_PVP_TYPE = {
  K: 'general', A: 'advisor', E: 'elephant', H: 'horse', R: 'chariot', C: 'cannon', P: 'soldier',
};

// Bộ sinh số giả ngẫu nhiên có seed để test lặp lại được
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Đổi lưới PvE sang danh sách quân PvP (độc lập với adapter trong xiangqiRules)
function gridToPieces(board) {
  const pieces = [];
  board.forEach((cells, row) => cells.forEach((cell, col) => {
    if (cell) {
      pieces.push({
        id: `${cell.color}-${cell.type}-${row}-${col}`,
        color: cell.color,
        type: GRID_TO_PVP_TYPE[cell.type],
        position: `${FILES[col]}${row}`,
      });
    }
  }));
  return pieces;
}

function sq(row, col) {
  return `${FILES[col]}${row}`;
}

function pvpLegalMoves(pieces, color) {
  const result = new Set();
  for (const piece of pieces) {
    if (piece.color !== color) continue;
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if (getLegalMoveError(pieces, color, piece.position, sq(row, col)) === null) {
          result.add(`${piece.position}-${sq(row, col)}`);
        }
      }
    }
  }
  return result;
}

function pveLegalMoves(board, color) {
  return new Set(generateLegalMoves(board, color).map(
    (move) => `${sq(move.from.row, move.from.col)}-${sq(move.to.row, move.to.col)}`
  ));
}

test('PvP và PvE cho cùng tập nước đi hợp lệ / trạng thái chiếu trên các ván ngẫu nhiên có seed', () => {
  const GAMES = 6;
  const PLIES = 50;
  let positions = 0;
  let checks = 0;

  for (let game = 0; game < GAMES; game += 1) {
    const random = mulberry32(1000 + game);
    let board = createInitialBoard();
    let color = 'red';

    for (let ply = 0; ply < PLIES; ply += 1) {
      const pieces = gridToPieces(board);
      const pveMoves = pveLegalMoves(board, color);
      const pvpMoves = pvpLegalMoves(pieces, color);
      assert.deepEqual([...pvpMoves].sort(), [...pveMoves].sort(), `ván ${game} nước ${ply}`);

      for (const side of ['red', 'black']) {
        assert.equal(isInCheck(pieces, side), isInCheckOnGrid(board, side), `chiếu ${side} ván ${game} nước ${ply}`);
      }
      assert.equal(hasLegalMove(pieces, color), hasAnyLegalMove(board, color));
      positions += 1;
      if (isInCheckOnGrid(board, color)) checks += 1;

      const moves = generateLegalMoves(board, color);
      if (moves.length === 0) break;
      // Ưu tiên nước ăn quân để ván sinh ra nhiều thế cờ tàn / chiếu hơn
      const captures = moves.filter((move) => move.capture);
      const pool = captures.length > 0 && random() < 0.5 ? captures : moves;
      const move = pool[Math.floor(random() * pool.length)];
      board = applyMove(board, move).board;
      color = color === 'red' ? 'black' : 'red';
    }
  }

  assert.ok(positions >= 100, `chỉ kiểm được ${positions} thế cờ`);
  assert.ok(checks > 0, 'bộ ván ngẫu nhiên phải có ít nhất một thế bị chiếu');
});

test('PvP và PvE cùng kết luận chiếu bí / hết nước ở thế cờ dựng sẵn', () => {
  // Đen bị chiếu bí: Xe a9 chiếu dọc hàng 9, Xe a8 khoá hàng 8, Tướng đen không còn ô thoát
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[0][3] = { type: 'K', color: 'red' };
  board[9][4] = { type: 'K', color: 'black' };
  board[9][0] = { type: 'R', color: 'red' };
  board[8][0] = { type: 'R', color: 'red' };
  const pieces = gridToPieces(board);

  assert.equal(isInCheck(pieces, 'black'), true);
  assert.equal(hasLegalMove(pieces, 'black'), hasAnyLegalMove(board, 'black'));
  assert.equal(hasLegalMove(pieces, 'black'), false);
  assert.equal(hasLegalMove(pieces, 'red'), true);
});

test('thiếu Tướng: PvP coi là bị chiếu (an toàn hơn), PvE trả false - khác biệt có chủ đích', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[9][4] = { type: 'K', color: 'black' };
  board[3][0] = { type: 'R', color: 'red' };
  const pieces = gridToPieces(board);

  assert.equal(isInCheckOnGrid(board, 'red'), false);
  assert.equal(isInCheck(pieces, 'red'), true);
  // Bên không còn Tướng không có nước đi hợp lệ nào -> ván kết thúc
  assert.equal(hasLegalMove(pieces, 'red'), false);
  assert.match(getLegalMoveError(pieces, 'red', 'a3', 'a4'), /Tướng phe bạn bị chiếu/);
});

test('SEC-03: toạ độ in hoa / không phải chuỗi / sai định dạng bị từ chối, không ném lỗi', () => {
  const pieces = createCot615Match(0).board;
  const invalid = ['E0', 'e10', 'j1', '', 'e', 'e0 ', null, undefined, 4, {}, [], ['e0']];

  for (const value of invalid) {
    assert.equal(parsePosition(value), null);
    assert.equal(getLegalMoveError(pieces, 'red', value, 'e1'), 'Tọa độ ô cờ không hợp lệ.');
    assert.equal(getLegalMoveError(pieces, 'red', 'e0', value), 'Tọa độ ô cờ không hợp lệ.');
  }
  assert.deepEqual(parsePosition('e3'), { file: 4, rank: 3 });
});

test('Tướng đi vào ô làm hai Tướng đối mặt báo "bị chiếu", Tướng bay ăn Tướng báo "bắt Tướng"', () => {
  const facing = [
    { id: 'rg', color: 'red', type: 'general', position: 'd0' },
    { id: 'bg', color: 'black', type: 'general', position: 'e9' },
  ];
  assert.match(getLegalMoveError(facing, 'red', 'd0', 'e0'), /Tướng phe bạn bị chiếu/);
  assert.equal(getLegalMoveError(facing, 'red', 'd0', 'd1'), null);

  const sameFile = [
    { id: 'rg', color: 'red', type: 'general', position: 'e0' },
    { id: 'bg', color: 'black', type: 'general', position: 'e9' },
  ];
  assert.match(getLegalMoveError(sameFile, 'red', 'e0', 'e9'), /Không được bắt Tướng/);
});
