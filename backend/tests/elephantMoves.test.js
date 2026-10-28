require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getElephantMoves } = require('../src/domain/rules/elephantMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);
const toKeys = (moves) => moves.map((m) => `${m.row},${m.col}`).sort();

describe('Nước đi quân Tượng (COT-607)', () => {
  it('Tượng Đỏ ở vị trí ban đầu (0,2) đi được 2 ô chữ Điền', () => {
    const board = createEmptyBoard();
    board[0][2] = { type: 'E', color: 'red' };
    const moves = getElephantMoves(board, 0, 2);
    assert.deepStrictEqual(toKeys(moves), ['2,0', '2,4']);
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Tượng Đen ở vị trí ban đầu (9,6) đi được 2 ô chữ Điền', () => {
    const board = createEmptyBoard();
    board[9][6] = { type: 'E', color: 'black' };
    assert.deepStrictEqual(toKeys(getElephantMoves(board, 9, 6)), ['7,4', '7,8']);
  });

  it('Tượng ở giữa sân mình (2,4) đi được cả 4 hướng', () => {
    const board = createEmptyBoard();
    board[2][4] = { type: 'E', color: 'red' };
    assert.deepStrictEqual(
      toKeys(getElephantMoves(board, 2, 4)),
      ['0,2', '0,6', '4,2', '4,6'],
    );
  });

  it('Mắt Tượng bị quân mình chặn thì không đi được hướng đó', () => {
    const board = createEmptyBoard();
    board[2][4] = { type: 'E', color: 'red' };
    board[1][3] = { type: 'A', color: 'red' };
    const moves = getElephantMoves(board, 2, 4);
    assert.ok(!has(moves, 0, 2));
    assert.deepStrictEqual(toKeys(moves), ['0,6', '4,2', '4,6']);
  });

  it('Mắt Tượng bị quân địch chặn thì không đi được hướng đó', () => {
    const board = createEmptyBoard();
    board[7][4] = { type: 'E', color: 'black' };
    board[6][5] = { type: 'P', color: 'red' };
    board[8][3] = { type: 'H', color: 'red' };
    const moves = getElephantMoves(board, 7, 4);
    assert.ok(!has(moves, 5, 6));
    assert.ok(!has(moves, 9, 2));
    assert.deepStrictEqual(toKeys(moves), ['5,2', '9,6']);
  });

  it('Mắt bị chặn thì cũng không ăn được quân địch ở ô đích', () => {
    const board = createEmptyBoard();
    board[2][4] = { type: 'E', color: 'red' };
    board[3][5] = { type: 'P', color: 'black' };
    board[4][6] = { type: 'C', color: 'black' };
    assert.ok(!has(getElephantMoves(board, 2, 4), 4, 6));
  });

  it('Tượng Đỏ không qua sông (không lên hàng 5 trở đi)', () => {
    const board = createEmptyBoard();
    board[4][2] = { type: 'E', color: 'red' };
    const moves = getElephantMoves(board, 4, 2);
    assert.ok(!has(moves, 6, 0));
    assert.ok(!has(moves, 6, 4));
    assert.deepStrictEqual(toKeys(moves), ['2,0', '2,4']);
  });

  it('Tượng Đen không qua sông (không xuống hàng 4 trở về)', () => {
    const board = createEmptyBoard();
    board[5][6] = { type: 'E', color: 'black' };
    const moves = getElephantMoves(board, 5, 6);
    assert.ok(!has(moves, 3, 4));
    assert.ok(!has(moves, 3, 8));
    assert.deepStrictEqual(toKeys(moves), ['7,4', '7,8']);
  });

  it('Tượng ăn quân đối phương khi mắt trống và ô đích ở sân mình', () => {
    const board = createEmptyBoard();
    board[2][4] = { type: 'E', color: 'red' };
    board[4][6] = { type: 'R', color: 'black' };
    const redCapture = getElephantMoves(board, 2, 4).find((m) => m.row === 4 && m.col === 6);
    assert.ok(redCapture && redCapture.capture);

    board[7][4] = { type: 'E', color: 'black' };
    board[5][2] = { type: 'H', color: 'red' };
    const blackCapture = getElephantMoves(board, 7, 4).find((m) => m.row === 5 && m.col === 2);
    assert.ok(blackCapture && blackCapture.capture);
  });

  it('Tượng không dừng trên quân mình', () => {
    const board = createEmptyBoard();
    board[2][4] = { type: 'E', color: 'red' };
    board[0][6] = { type: 'A', color: 'red' };
    board[4][2] = { type: 'P', color: 'red' };
    const moves = getElephantMoves(board, 2, 4);
    assert.deepStrictEqual(toKeys(moves), ['0,2', '4,6']);
  });

  it('Tượng ở mép bàn cờ chỉ đi các hướng còn trong bàn', () => {
    const board = createEmptyBoard();
    board[2][0] = { type: 'E', color: 'red' };
    board[7][8] = { type: 'E', color: 'black' };
    assert.deepStrictEqual(toKeys(getElephantMoves(board, 2, 0)), ['0,2', '4,2']);
    assert.deepStrictEqual(toKeys(getElephantMoves(board, 7, 8)), ['5,6', '9,6']);
  });

  it('Ô không phải quân Tượng trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[0][2] = { type: 'A', color: 'red' };
    assert.deepStrictEqual(getElephantMoves(board, 0, 2), []);
    assert.deepStrictEqual(getElephantMoves(board, 9, 2), []);
  });
});
