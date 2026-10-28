require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getRookMoves } = require('../src/domain/rules/rookMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

describe('Nước đi quân Xe (COT-610)', () => {
  it('Xe trên bàn trống đi được 17 ô theo hàng và cột', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'R', color: 'red' };
    const moves = getRookMoves(board, 4, 4);
    assert.strictEqual(moves.length, 9 + 8);
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Xe bị quân mình chặn thì dừng trước quân đó', () => {
    const board = createEmptyBoard();
    board[9][0] = { type: 'R', color: 'red' };
    board[6][0] = { type: 'P', color: 'red' };
    const moves = getRookMoves(board, 9, 0);
    assert.ok(has(moves, 7, 0));
    assert.ok(!has(moves, 6, 0));
    assert.ok(!has(moves, 5, 0));
  });

  it('Xe được ăn quân địch đầu tiên trên đường đi và không đi xuyên qua', () => {
    const board = createEmptyBoard();
    board[9][0] = { type: 'R', color: 'red' };
    board[3][0] = { type: 'H', color: 'black' };
    const moves = getRookMoves(board, 9, 0);
    const capture = moves.find((m) => m.row === 3 && m.col === 0);
    assert.ok(capture && capture.capture);
    assert.ok(!has(moves, 2, 0));
  });

  it('Ô không phải quân Xe trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[0][0] = { type: 'H', color: 'black' };
    assert.deepStrictEqual(getRookMoves(board, 0, 0), []);
    assert.deepStrictEqual(getRookMoves(board, 5, 5), []);
  });
});
