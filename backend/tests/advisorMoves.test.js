require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getAdvisorMoves } = require('../src/domain/rules/advisorMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);
const toKeys = (moves) => moves.map((m) => `${m.row},${m.col}`).sort();

describe('Nước đi quân Sĩ (COT-607)', () => {
  it('Sĩ Đỏ ở tâm Cung (1,4) đi được 4 góc Cung', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'A', color: 'red' };
    const moves = getAdvisorMoves(board, 1, 4);
    assert.deepStrictEqual(toKeys(moves), ['0,3', '0,5', '2,3', '2,5']);
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Sĩ Đen ở tâm Cung (8,4) đi được 4 góc Cung', () => {
    const board = createEmptyBoard();
    board[8][4] = { type: 'A', color: 'black' };
    const moves = getAdvisorMoves(board, 8, 4);
    assert.deepStrictEqual(toKeys(moves), ['7,3', '7,5', '9,3', '9,5']);
  });

  it('Sĩ Đỏ ở mỗi góc Cung chỉ có 1 nước về tâm Cung', () => {
    for (const [row, col] of [[0, 3], [0, 5], [2, 3], [2, 5]]) {
      const board = createEmptyBoard();
      board[row][col] = { type: 'A', color: 'red' };
      assert.deepStrictEqual(toKeys(getAdvisorMoves(board, row, col)), ['1,4']);
    }
  });

  it('Sĩ Đen ở mỗi góc Cung chỉ có 1 nước về tâm Cung', () => {
    for (const [row, col] of [[9, 3], [9, 5], [7, 3], [7, 5]]) {
      const board = createEmptyBoard();
      board[row][col] = { type: 'A', color: 'black' };
      assert.deepStrictEqual(toKeys(getAdvisorMoves(board, row, col)), ['8,4']);
    }
  });

  it('Sĩ không ra khỏi Cung và không đi ngang/dọc', () => {
    const board = createEmptyBoard();
    board[2][3] = { type: 'A', color: 'red' };
    board[7][5] = { type: 'A', color: 'black' };
    const redMoves = getAdvisorMoves(board, 2, 3);
    const blackMoves = getAdvisorMoves(board, 7, 5);
    // Ô chéo ra ngoài Cung
    assert.ok(!has(redMoves, 3, 2));
    assert.ok(!has(redMoves, 3, 4));
    assert.ok(!has(redMoves, 1, 2));
    assert.ok(!has(blackMoves, 6, 6));
    assert.ok(!has(blackMoves, 6, 4));
    assert.ok(!has(blackMoves, 8, 6));
    // Ô ngang/dọc kề bên
    assert.ok(!has(redMoves, 2, 4));
    assert.ok(!has(redMoves, 1, 3));
    assert.ok(!has(blackMoves, 7, 4));
    assert.ok(!has(blackMoves, 8, 5));
  });

  it('Sĩ ăn quân đối phương ở ô chéo kề trong Cung', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'A', color: 'red' };
    board[2][5] = { type: 'R', color: 'black' };
    board[8][4] = { type: 'A', color: 'black' };
    board[7][3] = { type: 'H', color: 'red' };

    const redCapture = getAdvisorMoves(board, 1, 4).find((m) => m.row === 2 && m.col === 5);
    assert.ok(redCapture && redCapture.capture);

    const blackCapture = getAdvisorMoves(board, 8, 4).find((m) => m.row === 7 && m.col === 3);
    assert.ok(blackCapture && blackCapture.capture);
  });

  it('Sĩ không dừng trên quân mình', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'A', color: 'red' };
    board[0][3] = { type: 'A', color: 'red' };
    board[0][5] = { type: 'K', color: 'red' };
    const moves = getAdvisorMoves(board, 1, 4);
    assert.deepStrictEqual(toKeys(moves), ['2,3', '2,5']);

    const blackBoard = createEmptyBoard();
    blackBoard[9][5] = { type: 'A', color: 'black' };
    blackBoard[8][4] = { type: 'K', color: 'black' };
    assert.deepStrictEqual(getAdvisorMoves(blackBoard, 9, 5), []);
  });

  it('Ô không phải quân Sĩ trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'K', color: 'red' };
    assert.deepStrictEqual(getAdvisorMoves(board, 1, 4), []);
    assert.deepStrictEqual(getAdvisorMoves(board, 8, 4), []);
  });
});
