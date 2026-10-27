require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard, createInitialBoard } = require('../src/domain/rules/board');
const { generateLegalMoves, applyMove, isInCheck } = require('../src/domain/rules/moveGenerator');
const { GAME_STATUS, getGameStatus, hasAnyLegalMove } = require('../src/domain/rules/gameStatus');

const put = (board, row, col, type, color) => {
  board[row][col] = { type, color };
  return board;
};

describe('Trạng thái ván cờ: Chiếu Bí / Hết nước (COT-642)', () => {
  it('Thế ban đầu: ván cờ đang diễn ra, chưa có bên thua', () => {
    const board = createInitialBoard();
    assert.deepStrictEqual(getGameStatus(board, 'red'), { status: GAME_STATUS.ONGOING });
    assert.deepStrictEqual(getGameStatus(board, 'black'), { status: GAME_STATUS.ONGOING });
  });

  it('Chiếu bí bằng Xe + Tướng đối mặt (Đen thua)', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red'); // khống chế cột 4 bằng luật đối mặt
    put(board, 7, 3, 'R', 'red'); // chiếu dọc cột 3, khống chế (8,3)
    put(board, 9, 3, 'K', 'black');
    assert.deepStrictEqual(getGameStatus(board, 'black'), {
      status: GAME_STATUS.CHECKMATE,
      loser: 'black',
      winner: 'red',
    });
  });

  it('Chiếu bí bằng Xe + Tướng đối mặt (Đỏ thua)', () => {
    const board = createEmptyBoard();
    put(board, 9, 4, 'K', 'black');
    put(board, 2, 3, 'R', 'black');
    put(board, 0, 3, 'K', 'red');
    assert.deepStrictEqual(getGameStatus(board, 'red'), {
      status: GAME_STATUS.CHECKMATE,
      loser: 'red',
      winner: 'black',
    });
  });

  it('Chiếu bí bằng Mã + Xe khi Tướng bị Sĩ của mình chặn hai bên', () => {
    const board = createEmptyBoard();
    put(board, 0, 3, 'K', 'red');
    put(board, 7, 5, 'H', 'red'); // Mã chiếu (7,5) -> (9,4), chân (8,5) trống
    put(board, 8, 0, 'R', 'red'); // Xe khống chế hàng 8, chặn đường thoát (8,4)
    put(board, 9, 4, 'K', 'black');
    put(board, 9, 3, 'A', 'black');
    put(board, 9, 5, 'A', 'black');
    assert.strictEqual(isInCheck(board, 'black'), true);
    assert.deepStrictEqual(getGameStatus(board, 'black'), {
      status: GAME_STATUS.CHECKMATE,
      loser: 'black',
      winner: 'red',
    });
  });

  it('Chiếu bí bằng Pháo trùng (hai Pháo cùng cột, Pháo trước làm ngòi)', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 4, 4, 'C', 'red');
    put(board, 5, 4, 'C', 'red');
    put(board, 9, 4, 'K', 'black');
    put(board, 9, 3, 'R', 'black'); // quân mình chặn hai bên, không chặn được cột 4
    put(board, 9, 5, 'R', 'black');
    assert.strictEqual(isInCheck(board, 'black'), true);
    assert.deepStrictEqual(getGameStatus(board, 'black'), {
      status: GAME_STATUS.CHECKMATE,
      loser: 'black',
      winner: 'red',
    });
  });

  it('Pháo trùng: Sĩ chèn vào cột không giải được vì Pháo trước lấy Sĩ làm ngòi', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 4, 4, 'C', 'red');
    put(board, 5, 4, 'C', 'red');
    put(board, 9, 4, 'K', 'black');
    put(board, 9, 3, 'A', 'black'); // Sĩ lên (8,4) thì Pháo (5,4) chiếu qua ngòi (8,4)
    put(board, 9, 5, 'R', 'black');
    assert.strictEqual(getGameStatus(board, 'black').status, GAME_STATUS.CHECKMATE);
  });

  it('Pháo trùng nhưng bên bị chiếu ăn được Pháo sau thì chỉ là Chiếu (ăn Pháo trước thì Xe lại thành ngòi)', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 4, 4, 'C', 'red');
    put(board, 5, 4, 'C', 'red');
    put(board, 9, 4, 'K', 'black');
    put(board, 9, 3, 'R', 'black');
    put(board, 9, 5, 'R', 'black');
    put(board, 4, 8, 'R', 'black'); // ăn Pháo sau (4,4) để Pháo trước (5,4) không còn ngòi
    assert.deepStrictEqual(getGameStatus(board, 'black'), { status: GAME_STATUS.CHECK });
    const legal = generateLegalMoves(board, 'black');
    assert.strictEqual(legal.length, 1);
    assert.deepStrictEqual(legal[0].from, { row: 4, col: 8 });
    assert.deepStrictEqual(legal[0].to, { row: 4, col: 4 });

    // Nếu Xe chỉ ăn được Pháo trước thì Xe trở thành ngòi mới: vẫn Chiếu Bí
    board[4][8] = null;
    put(board, 5, 8, 'R', 'black');
    assert.strictEqual(getGameStatus(board, 'black').status, GAME_STATUS.CHECKMATE);
  });

  it('Bị vây không bị chiếu, chỉ còn Tướng và mọi ô đều bị khống chế: Hết nước, bên đó thua', () => {
    const board = createEmptyBoard();
    put(board, 0, 3, 'K', 'red'); // khống chế (9,3) bằng luật đối mặt
    put(board, 8, 0, 'R', 'red'); // khống chế hàng 8
    put(board, 7, 6, 'H', 'red'); // khống chế (9,5)
    put(board, 9, 4, 'K', 'black');
    assert.strictEqual(isInCheck(board, 'black'), false);
    assert.deepStrictEqual(getGameStatus(board, 'black'), {
      status: GAME_STATUS.NO_LEGAL_MOVES,
      loser: 'black',
      winner: 'red',
    });
  });

  it('Còn quân nhưng quân đó bị ghim, không bị chiếu: vẫn là Hết nước', () => {
    const board = createEmptyBoard();
    put(board, 0, 3, 'K', 'red');
    put(board, 5, 4, 'R', 'red'); // ghim Mã Đen tại (8,4)
    put(board, 6, 5, 'R', 'red'); // khống chế (9,5)
    put(board, 9, 4, 'K', 'black');
    put(board, 8, 4, 'H', 'black');
    assert.strictEqual(isInCheck(board, 'black'), false);
    assert.ok(hasAnyLegalMove(board, 'black') === false);
    assert.strictEqual(getGameStatus(board, 'black').status, GAME_STATUS.NO_LEGAL_MOVES);
    assert.strictEqual(getGameStatus(board, 'black').loser, 'black');
  });

  it('Đang bị chiếu nhưng còn nước chạy Tướng: chỉ là Chiếu, chưa kết luận thua', () => {
    const board = createEmptyBoard();
    put(board, 0, 3, 'K', 'red');
    put(board, 5, 4, 'R', 'red');
    put(board, 9, 4, 'K', 'black');
    const result = getGameStatus(board, 'black');
    assert.deepStrictEqual(result, { status: GAME_STATUS.CHECK });
    assert.strictEqual(result.loser, undefined);
  });

  it('Đang bị chiếu nhưng còn nước ăn quân chiếu: chỉ là Chiếu', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 3, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    put(board, 7, 8, 'R', 'black'); // ăn được Xe chiếu
    assert.deepStrictEqual(getGameStatus(board, 'black'), { status: GAME_STATUS.CHECK });
  });

  it('Kết quả phụ thuộc bên tới lượt: thế Đen bị bí nhưng tới lượt Đỏ thì chưa kết thúc', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 3, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    assert.strictEqual(getGameStatus(board, 'red').status, GAME_STATUS.ONGOING);
  });

  it('Không làm thay đổi bàn cờ đầu vào', () => {
    const board = createInitialBoard();
    const snapshot = JSON.stringify(board);
    getGameStatus(board, 'red');
    assert.strictEqual(JSON.stringify(board), snapshot);
  });

  it('Bên đi không hợp lệ thì báo lỗi', () => {
    assert.throws(() => getGameStatus(createInitialBoard(), 'green'));
  });

  it('Sau nước Pháo bình trung tạo Pháo trùng, bên Đen bị chiếu bí', () => {
    const board = createEmptyBoard();
    put(board, 1, 4, 'K', 'red');
    put(board, 4, 4, 'C', 'red'); // Pháo trước, chưa có ngòi nên chưa chiếu
    put(board, 2, 1, 'C', 'red');
    put(board, 9, 4, 'K', 'black');
    put(board, 9, 3, 'R', 'black');
    put(board, 9, 5, 'R', 'black');
    assert.strictEqual(isInCheck(board, 'black'), false);
    assert.deepStrictEqual(getGameStatus(board, 'red'), { status: GAME_STATUS.ONGOING });

    const move = { from: { row: 2, col: 1 }, to: { row: 2, col: 4 } };
    assert.ok(
      generateLegalMoves(board, 'red').some(
        (m) => m.from.row === 2 && m.from.col === 1 && m.to.row === 2 && m.to.col === 4
      )
    );
    const next = applyMove(board, move).board;
    assert.strictEqual(isInCheck(next, 'black'), true);
    assert.strictEqual(getGameStatus(next, 'black').status, GAME_STATUS.CHECKMATE);
    assert.strictEqual(getGameStatus(next, 'black').loser, 'black');
  });
});
