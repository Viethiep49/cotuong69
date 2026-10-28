require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getKingMoves, areKingsFacing, isInPalace } = require('../src/domain/rules/kingMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

describe('Nước đi quân Tướng (COT-606)', () => {
  it('isInPalace xác định đúng Cung Đỏ (hàng 0–2) và Cung Đen (hàng 7–9), cột 3–5', () => {
    assert.ok(isInPalace(0, 3, 'red'));
    assert.ok(isInPalace(2, 5, 'red'));
    assert.ok(!isInPalace(3, 4, 'red'));
    assert.ok(!isInPalace(1, 2, 'red'));
    assert.ok(!isInPalace(8, 4, 'red'));
    assert.ok(isInPalace(7, 3, 'black'));
    assert.ok(isInPalace(9, 5, 'black'));
    assert.ok(!isInPalace(6, 4, 'black'));
    assert.ok(!isInPalace(8, 6, 'black'));
    assert.ok(!isInPalace(1, 4, 'black'));
  });

  it('Tướng Đỏ ở giữa Cung đi được 4 ô ngang/dọc, không đi chéo', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'K', color: 'red' };
    const moves = getKingMoves(board, 1, 4);
    assert.strictEqual(moves.length, 4);
    assert.ok(has(moves, 0, 4));
    assert.ok(has(moves, 2, 4));
    assert.ok(has(moves, 1, 3));
    assert.ok(has(moves, 1, 5));
    assert.ok(!has(moves, 0, 3));
    assert.ok(!has(moves, 2, 5));
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Tướng Đen ở giữa Cung đi được 4 ô ngang/dọc, không đi chéo', () => {
    const board = createEmptyBoard();
    board[8][4] = { type: 'K', color: 'black' };
    const moves = getKingMoves(board, 8, 4);
    assert.strictEqual(moves.length, 4);
    assert.ok(has(moves, 7, 4));
    assert.ok(has(moves, 9, 4));
    assert.ok(has(moves, 8, 3));
    assert.ok(has(moves, 8, 5));
    assert.ok(!has(moves, 7, 3));
    assert.ok(!has(moves, 9, 5));
  });

  it('Tướng ở góc Cung chỉ đi được 2 ô', () => {
    const board = createEmptyBoard();
    board[0][3] = { type: 'K', color: 'red' };
    const moves = getKingMoves(board, 0, 3);
    assert.strictEqual(moves.length, 2);
    assert.ok(has(moves, 1, 3));
    assert.ok(has(moves, 0, 4));
  });

  it('Tướng không được đi ra khỏi Cung', () => {
    const board = createEmptyBoard();
    board[2][5] = { type: 'K', color: 'red' };
    const redMoves = getKingMoves(board, 2, 5);
    assert.ok(!has(redMoves, 3, 5));
    assert.ok(!has(redMoves, 2, 6));
    assert.strictEqual(redMoves.length, 2);

    board[7][3] = { type: 'K', color: 'black' };
    const blackMoves = getKingMoves(board, 7, 3);
    assert.ok(!has(blackMoves, 6, 3));
    assert.ok(!has(blackMoves, 7, 2));
    assert.strictEqual(blackMoves.length, 2);
  });

  it('Tướng ăn quân địch ở ô kề trong Cung', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'K', color: 'red' };
    board[1][5] = { type: 'R', color: 'black' };
    const capture = getKingMoves(board, 1, 4).find((m) => m.row === 1 && m.col === 5);
    assert.ok(capture && capture.capture);

    const blackBoard = createEmptyBoard();
    blackBoard[8][4] = { type: 'K', color: 'black' };
    blackBoard[7][4] = { type: 'P', color: 'red' };
    const blackCapture = getKingMoves(blackBoard, 8, 4).find((m) => m.row === 7 && m.col === 4);
    assert.ok(blackCapture && blackCapture.capture);
  });

  it('Tướng không được dừng trên ô có quân mình', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'K', color: 'red' };
    board[1][3] = { type: 'A', color: 'red' };
    board[2][4] = { type: 'A', color: 'red' };
    const moves = getKingMoves(board, 1, 4);
    assert.ok(!has(moves, 1, 3));
    assert.ok(!has(moves, 2, 4));
    assert.strictEqual(moves.length, 2);
  });

  it('Tướng Đỏ không được tự đi tới cột đối mặt trực tiếp với Tướng Đen', () => {
    const board = createEmptyBoard();
    board[0][3] = { type: 'K', color: 'red' };
    board[9][4] = { type: 'K', color: 'black' };
    const moves = getKingMoves(board, 0, 3);
    assert.ok(!has(moves, 0, 4));
    assert.ok(has(moves, 1, 3));
    assert.strictEqual(moves.length, 1);
  });

  it('Tướng Đen không được tự đi tới cột đối mặt trực tiếp với Tướng Đỏ', () => {
    const board = createEmptyBoard();
    board[1][5] = { type: 'K', color: 'red' };
    board[8][4] = { type: 'K', color: 'black' };
    const moves = getKingMoves(board, 8, 4);
    assert.ok(!has(moves, 8, 5));
    assert.ok(has(moves, 8, 3));
    assert.ok(has(moves, 7, 4));
    assert.ok(has(moves, 9, 4));
  });

  it('Có quân cản giữa hai Tướng thì được đi vào cùng cột', () => {
    const board = createEmptyBoard();
    board[0][3] = { type: 'K', color: 'red' };
    board[9][4] = { type: 'K', color: 'black' };
    board[5][4] = { type: 'P', color: 'black' };
    const moves = getKingMoves(board, 0, 3);
    assert.ok(has(moves, 0, 4));
  });

  it('Tướng đi dọc trên cột vẫn đang lộ mặt thì nước đó bị loại', () => {
    const board = createEmptyBoard();
    board[0][4] = { type: 'K', color: 'red' };
    board[9][4] = { type: 'K', color: 'black' };
    const moves = getKingMoves(board, 0, 4);
    assert.ok(!has(moves, 1, 4));
    assert.ok(has(moves, 0, 3));
    assert.ok(has(moves, 0, 5));
  });

  it('areKingsFacing trả về true khi hai Tướng cùng cột và không có quân cản', () => {
    const board = createEmptyBoard();
    board[0][4] = { type: 'K', color: 'red' };
    board[9][4] = { type: 'K', color: 'black' };
    assert.strictEqual(areKingsFacing(board), true);
  });

  it('areKingsFacing trả về false khi có quân cản, khác cột hoặc thiếu Tướng', () => {
    const board = createEmptyBoard();
    board[0][4] = { type: 'K', color: 'red' };
    board[9][4] = { type: 'K', color: 'black' };
    board[4][4] = { type: 'C', color: 'red' };
    assert.strictEqual(areKingsFacing(board), false);

    const diffCol = createEmptyBoard();
    diffCol[0][4] = { type: 'K', color: 'red' };
    diffCol[9][3] = { type: 'K', color: 'black' };
    assert.strictEqual(areKingsFacing(diffCol), false);

    const missing = createEmptyBoard();
    missing[0][4] = { type: 'K', color: 'red' };
    assert.strictEqual(areKingsFacing(missing), false);
  });

  it('getKingMoves không làm thay đổi bàn cờ gốc', () => {
    const board = createEmptyBoard();
    board[1][4] = { type: 'K', color: 'red' };
    board[9][3] = { type: 'K', color: 'black' };
    const snapshot = JSON.stringify(board);
    getKingMoves(board, 1, 4);
    assert.strictEqual(JSON.stringify(board), snapshot);
  });

  it('Ô không phải quân Tướng trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[0][4] = { type: 'A', color: 'red' };
    assert.deepStrictEqual(getKingMoves(board, 0, 4), []);
    assert.deepStrictEqual(getKingMoves(board, 5, 5), []);
  });
});
