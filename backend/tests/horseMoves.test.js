require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getHorseMoves } = require('../src/domain/rules/horseMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

describe('Nước đi quân Mã (COT-612)', () => {
  it('Mã giữa bàn trống đi được 8 ô hình chữ L', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    const moves = getHorseMoves(board, 4, 4);
    assert.strictEqual(moves.length, 8);
    const expected = [
      [2, 3], [2, 5], [6, 3], [6, 5],
      [3, 2], [5, 2], [3, 6], [5, 6],
    ];
    for (const [r, c] of expected) {
      assert.ok(has(moves, r, c), `thiếu nước (${r}, ${c})`);
    }
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Mã ở góc bàn chỉ đi được 2 ô', () => {
    const board = createEmptyBoard();
    board[0][0] = { type: 'H', color: 'red' };
    const moves = getHorseMoves(board, 0, 0);
    assert.strictEqual(moves.length, 2);
    assert.ok(has(moves, 2, 1));
    assert.ok(has(moves, 1, 2));
  });

  it('Mã ở mép bàn chỉ đi được các ô nằm trong bàn', () => {
    const board = createEmptyBoard();
    board[9][4] = { type: 'H', color: 'black' };
    const moves = getHorseMoves(board, 9, 4);
    assert.strictEqual(moves.length, 4);
    assert.ok(has(moves, 7, 3));
    assert.ok(has(moves, 7, 5));
    assert.ok(has(moves, 8, 2));
    assert.ok(has(moves, 8, 6));
  });

  it('Chân Mã bị quân mình chặn thì mất đúng 2 hướng tương ứng', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    board[3][4] = { type: 'P', color: 'red' };
    const moves = getHorseMoves(board, 4, 4);
    assert.strictEqual(moves.length, 6);
    assert.ok(!has(moves, 2, 3));
    assert.ok(!has(moves, 2, 5));
  });

  it('Chân Mã bị quân địch chặn thì cũng mất đúng 2 hướng tương ứng', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    board[4][5] = { type: 'P', color: 'black' };
    const moves = getHorseMoves(board, 4, 4);
    assert.strictEqual(moves.length, 6);
    assert.ok(!has(moves, 3, 6));
    assert.ok(!has(moves, 5, 6));
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Mã được ăn quân địch tại ô đích chữ L khi chân thông', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    board[6][5] = { type: 'R', color: 'black' };
    const moves = getHorseMoves(board, 4, 4);
    const capture = moves.find((m) => m.row === 6 && m.col === 5);
    assert.ok(capture && capture.capture);
    assert.strictEqual(moves.length, 8);
  });

  it('Mã không ăn được quân địch khi chân bị chặn', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    board[5][4] = { type: 'P', color: 'red' };
    board[6][5] = { type: 'R', color: 'black' };
    const moves = getHorseMoves(board, 4, 4);
    assert.ok(!has(moves, 6, 5));
  });

  it('Mã không dừng trên ô có quân mình', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'black' };
    board[2][3] = { type: 'C', color: 'black' };
    const moves = getHorseMoves(board, 4, 4);
    assert.ok(!has(moves, 2, 3));
    assert.strictEqual(moves.length, 7);
  });

  it('Quân ở ô chéo sát Mã (không phải chân) không cản Mã', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'H', color: 'red' };
    board[3][3] = { type: 'P', color: 'red' };
    board[3][5] = { type: 'P', color: 'black' };
    board[5][3] = { type: 'P', color: 'black' };
    board[5][5] = { type: 'P', color: 'red' };
    const moves = getHorseMoves(board, 4, 4);
    assert.strictEqual(moves.length, 8);
  });

  it('Ô không phải quân Mã trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[0][0] = { type: 'R', color: 'red' };
    assert.deepStrictEqual(getHorseMoves(board, 0, 0), []);
    assert.deepStrictEqual(getHorseMoves(board, 5, 5), []);
  });
});
