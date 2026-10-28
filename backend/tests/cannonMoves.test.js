require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { getCannonMoves } = require('../src/domain/rules/cannonMoves');

const has = (moves, row, col) => moves.some((m) => m.row === row && m.col === col);

describe('Nước đi quân Pháo (COT-611)', () => {
  it('Pháo trên bàn trống đi được 17 ô theo hàng và cột, không ăn quân nào', () => {
    const board = createEmptyBoard();
    board[4][4] = { type: 'C', color: 'red' };
    const moves = getCannonMoves(board, 4, 4);
    assert.strictEqual(moves.length, 9 + 8);
    assert.ok(moves.every((m) => !m.capture));
  });

  it('Pháo đi thường phải dừng trước quân chắn đường, không đứng lên ô có quân', () => {
    const board = createEmptyBoard();
    board[7][1] = { type: 'C', color: 'red' };
    board[4][1] = { type: 'P', color: 'red' };
    const moves = getCannonMoves(board, 7, 1);
    assert.ok(has(moves, 5, 1));
    assert.ok(!has(moves, 4, 1));
  });

  it('Pháo không ăn được quân địch nằm sát mà không có ngòi', () => {
    const board = createEmptyBoard();
    board[7][1] = { type: 'C', color: 'red' };
    board[5][1] = { type: 'H', color: 'black' };
    const moves = getCannonMoves(board, 7, 1);
    assert.ok(has(moves, 6, 1));
    assert.ok(!has(moves, 5, 1));
  });

  it('Pháo ăn được quân địch khi có đúng một ngòi là quân mình', () => {
    const board = createEmptyBoard();
    board[7][1] = { type: 'C', color: 'red' };
    board[5][1] = { type: 'P', color: 'red' };
    board[2][1] = { type: 'H', color: 'black' };
    const moves = getCannonMoves(board, 7, 1);
    const capture = moves.find((m) => m.row === 2 && m.col === 1);
    assert.ok(capture && capture.capture);
    assert.ok(!has(moves, 3, 1) && !has(moves, 4, 1), 'không được dừng ở ô trống sau ngòi');
  });

  it('Pháo ăn được quân địch khi ngòi là quân địch', () => {
    const board = createEmptyBoard();
    board[4][0] = { type: 'C', color: 'black' };
    board[4][3] = { type: 'P', color: 'red' };
    board[4][8] = { type: 'R', color: 'red' };
    const moves = getCannonMoves(board, 4, 0);
    const capture = moves.find((m) => m.row === 4 && m.col === 8);
    assert.ok(capture && capture.capture);
    assert.ok(!has(moves, 4, 3));
  });

  it('Pháo không ăn được khi có từ hai quân trở lên chen giữa', () => {
    const board = createEmptyBoard();
    board[9][4] = { type: 'C', color: 'red' };
    board[7][4] = { type: 'P', color: 'red' };
    board[5][4] = { type: 'P', color: 'black' };
    board[0][4] = { type: 'K', color: 'black' };
    const moves = getCannonMoves(board, 9, 4);
    const capture = moves.find((m) => m.row === 5 && m.col === 4);
    assert.ok(capture && capture.capture, 'ăn được quân ngay sau ngòi đầu tiên');
    assert.ok(!has(moves, 0, 4), 'không ăn xuyên qua hai quân');
  });

  it('Pháo không ăn quân cùng bên nằm sau ngòi', () => {
    const board = createEmptyBoard();
    board[7][1] = { type: 'C', color: 'red' };
    board[5][1] = { type: 'P', color: 'black' };
    board[2][1] = { type: 'R', color: 'red' };
    const moves = getCannonMoves(board, 7, 1);
    assert.ok(!has(moves, 2, 1));
  });

  it('Ô không phải quân Pháo trả về danh sách rỗng', () => {
    const board = createEmptyBoard();
    board[0][0] = { type: 'R', color: 'black' };
    assert.deepStrictEqual(getCannonMoves(board, 0, 0), []);
    assert.deepStrictEqual(getCannonMoves(board, 5, 5), []);
  });
});
