require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getPawnMoves } = require('../src/domain/rules/pawnMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

describe('Nước đi quân Tốt (COT-613)', () => {
  describe('Tốt Đỏ (tiến về hàng lớn hơn)', () => {
    it('Ở vị trí xuất phát (hàng 3) chỉ tiến thẳng 1 bước', () => {
      const board = createEmptyBoard();
      board[3][4] = { type: 'P', color: 'red' };
      const moves = getPawnMoves(board, 3, 4);
      assert.deepStrictEqual(moves, [{ row: 4, col: 4, capture: false }]);
    });

    it('Ở bờ sông (hàng 4) vẫn chưa qua sông nên chỉ tiến thẳng', () => {
      const board = createEmptyBoard();
      board[4][4] = { type: 'P', color: 'red' };
      const moves = getPawnMoves(board, 4, 4);
      assert.deepStrictEqual(moves, [{ row: 5, col: 4, capture: false }]);
    });

    it('Vừa qua sông (hàng 5) có 3 nước: tiến, trái, phải', () => {
      const board = createEmptyBoard();
      board[5][4] = { type: 'P', color: 'red' };
      const moves = getPawnMoves(board, 5, 4);
      assert.strictEqual(moves.length, 3);
      assert.ok(has(moves, 6, 4));
      assert.ok(has(moves, 5, 3));
      assert.ok(has(moves, 5, 5));
    });

    it('Đã qua sông ở mép cột chỉ có 2 nước', () => {
      const board = createEmptyBoard();
      board[6][0] = { type: 'P', color: 'red' };
      const left = getPawnMoves(board, 6, 0);
      assert.strictEqual(left.length, 2);
      assert.ok(has(left, 7, 0));
      assert.ok(has(left, 6, 1));

      board[6][8] = { type: 'P', color: 'red' };
      const right = getPawnMoves(board, 6, 8);
      assert.strictEqual(right.length, 2);
      assert.ok(has(right, 7, 8));
      assert.ok(has(right, 6, 7));
    });

    it('Ở hàng cuối (hàng 9) chỉ đi ngang', () => {
      const board = createEmptyBoard();
      board[9][4] = { type: 'P', color: 'red' };
      const moves = getPawnMoves(board, 9, 4);
      assert.strictEqual(moves.length, 2);
      assert.ok(has(moves, 9, 3));
      assert.ok(has(moves, 9, 5));
    });

    it('Không bao giờ lùi và không đi chéo', () => {
      for (let row = 3; row <= 9; row++) {
        const board = createEmptyBoard();
        board[row][4] = { type: 'P', color: 'red' };
        const moves = getPawnMoves(board, row, 4);
        assert.ok(moves.every((m) => m.row >= row), `lùi ở hàng ${row}`);
        assert.ok(
          moves.every((m) => m.row === row || m.col === 4),
          `đi chéo ở hàng ${row}`
        );
      }
    });

    it('Ăn quân địch phía trước và hai bên sau khi qua sông', () => {
      const board = createEmptyBoard();
      board[6][4] = { type: 'P', color: 'red' };
      board[7][4] = { type: 'R', color: 'black' };
      board[6][3] = { type: 'H', color: 'black' };
      board[6][5] = { type: 'C', color: 'black' };
      const moves = getPawnMoves(board, 6, 4);
      assert.strictEqual(moves.length, 3);
      assert.ok(moves.every((m) => m.capture));
    });

    it('Chưa qua sông thì không ăn ngang, chỉ ăn phía trước', () => {
      const board = createEmptyBoard();
      board[4][4] = { type: 'P', color: 'red' };
      board[4][3] = { type: 'P', color: 'black' };
      board[4][5] = { type: 'P', color: 'black' };
      board[5][4] = { type: 'P', color: 'black' };
      const moves = getPawnMoves(board, 4, 4);
      assert.deepStrictEqual(moves, [{ row: 5, col: 4, capture: true }]);
    });

    it('Không ăn quân địch ở phía sau', () => {
      const board = createEmptyBoard();
      board[6][4] = { type: 'P', color: 'red' };
      board[5][4] = { type: 'R', color: 'black' };
      const moves = getPawnMoves(board, 6, 4);
      assert.ok(!has(moves, 5, 4));
    });

    it('Không dừng trên quân mình', () => {
      const board = createEmptyBoard();
      board[6][4] = { type: 'P', color: 'red' };
      board[7][4] = { type: 'R', color: 'red' };
      board[6][3] = { type: 'H', color: 'red' };
      const moves = getPawnMoves(board, 6, 4);
      assert.deepStrictEqual(moves, [{ row: 6, col: 5, capture: false }]);
    });
  });

  describe('Tốt Đen (tiến về hàng nhỏ hơn)', () => {
    it('Ở vị trí xuất phát (hàng 6) chỉ tiến thẳng 1 bước', () => {
      const board = createEmptyBoard();
      board[6][4] = { type: 'P', color: 'black' };
      const moves = getPawnMoves(board, 6, 4);
      assert.deepStrictEqual(moves, [{ row: 5, col: 4, capture: false }]);
    });

    it('Ở bờ sông (hàng 5) vẫn chưa qua sông nên chỉ tiến thẳng', () => {
      const board = createEmptyBoard();
      board[5][4] = { type: 'P', color: 'black' };
      const moves = getPawnMoves(board, 5, 4);
      assert.deepStrictEqual(moves, [{ row: 4, col: 4, capture: false }]);
    });

    it('Vừa qua sông (hàng 4) có 3 nước: tiến, trái, phải', () => {
      const board = createEmptyBoard();
      board[4][4] = { type: 'P', color: 'black' };
      const moves = getPawnMoves(board, 4, 4);
      assert.strictEqual(moves.length, 3);
      assert.ok(has(moves, 3, 4));
      assert.ok(has(moves, 4, 3));
      assert.ok(has(moves, 4, 5));
    });

    it('Đã qua sông ở mép cột chỉ có 2 nước', () => {
      const board = createEmptyBoard();
      board[3][0] = { type: 'P', color: 'black' };
      const left = getPawnMoves(board, 3, 0);
      assert.strictEqual(left.length, 2);
      assert.ok(has(left, 2, 0));
      assert.ok(has(left, 3, 1));

      board[3][8] = { type: 'P', color: 'black' };
      const right = getPawnMoves(board, 3, 8);
      assert.strictEqual(right.length, 2);
      assert.ok(has(right, 2, 8));
      assert.ok(has(right, 3, 7));
    });

    it('Ở hàng cuối (hàng 0) chỉ đi ngang', () => {
      const board = createEmptyBoard();
      board[0][4] = { type: 'P', color: 'black' };
      const moves = getPawnMoves(board, 0, 4);
      assert.strictEqual(moves.length, 2);
      assert.ok(has(moves, 0, 3));
      assert.ok(has(moves, 0, 5));
    });

    it('Không bao giờ lùi và không đi chéo', () => {
      for (let row = 0; row <= 6; row++) {
        const board = createEmptyBoard();
        board[row][4] = { type: 'P', color: 'black' };
        const moves = getPawnMoves(board, row, 4);
        assert.ok(moves.every((m) => m.row <= row), `lùi ở hàng ${row}`);
        assert.ok(
          moves.every((m) => m.row === row || m.col === 4),
          `đi chéo ở hàng ${row}`
        );
      }
    });

    it('Ăn quân địch phía trước và hai bên sau khi qua sông', () => {
      const board = createEmptyBoard();
      board[3][4] = { type: 'P', color: 'black' };
      board[2][4] = { type: 'R', color: 'red' };
      board[3][3] = { type: 'H', color: 'red' };
      board[3][5] = { type: 'C', color: 'red' };
      const moves = getPawnMoves(board, 3, 4);
      assert.strictEqual(moves.length, 3);
      assert.ok(moves.every((m) => m.capture));
    });

    it('Chưa qua sông thì không ăn ngang, chỉ ăn phía trước', () => {
      const board = createEmptyBoard();
      board[5][4] = { type: 'P', color: 'black' };
      board[5][3] = { type: 'P', color: 'red' };
      board[5][5] = { type: 'P', color: 'red' };
      board[4][4] = { type: 'P', color: 'red' };
      const moves = getPawnMoves(board, 5, 4);
      assert.deepStrictEqual(moves, [{ row: 4, col: 4, capture: true }]);
    });

    it('Không ăn quân địch ở phía sau', () => {
      const board = createEmptyBoard();
      board[3][4] = { type: 'P', color: 'black' };
      board[4][4] = { type: 'R', color: 'red' };
      const moves = getPawnMoves(board, 3, 4);
      assert.ok(!has(moves, 4, 4));
    });

    it('Không dừng trên quân mình', () => {
      const board = createEmptyBoard();
      board[3][4] = { type: 'P', color: 'black' };
      board[2][4] = { type: 'R', color: 'black' };
      board[3][5] = { type: 'H', color: 'black' };
      const moves = getPawnMoves(board, 3, 4);
      assert.deepStrictEqual(moves, [{ row: 3, col: 3, capture: false }]);
    });
  });

  it('Ô không phải quân Tốt trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[3][0] = { type: 'R', color: 'red' };
    assert.deepStrictEqual(getPawnMoves(board, 3, 0), []);
    assert.deepStrictEqual(getPawnMoves(board, 5, 5), []);
  });
});
