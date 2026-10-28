require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { performance } = require('node:perf_hooks');
const { createEmptyBoard, createInitialBoard } = require('../src/domain/rules/board');
const { generateLegalMoves, applyMove, isInCheck } = require('../src/domain/rules/moveGenerator');
const {
  PIECE_VALUES,
  CROSSED_PAWN_VALUE,
  getAlivePieces,
  extractBoardState,
  getThreatenedSquares,
  getThreatenedPieces,
  getSafeMoves,
  evaluate,
} = require('../src/domain/rules/botEvaluation');

const put = (board, row, col, type, color) => {
  board[row][col] = { type, color };
  return board;
};

const hasSquare = (squares, row, col) => squares.some((s) => s.row === row && s.col === col);

function boardWithKings(redKing = [0, 4], blackKing = [9, 3]) {
  const board = createEmptyBoard();
  put(board, redKing[0], redKing[1], 'K', 'red');
  put(board, blackKing[0], blackKing[1], 'K', 'black');
  return board;
}

describe('Trích xuất trạng thái bàn cờ cho Bot (COT-633)', () => {
  it('Thế ban đầu: 32 quân còn sống, đúng vị trí Tướng của Bot và đối phương', () => {
    const state = extractBoardState(createInitialBoard(), 'black');
    assert.strictEqual(state.pieces.length, 32);
    assert.strictEqual(state.botColor, 'black');
    assert.strictEqual(state.opponentColor, 'red');
    assert.deepStrictEqual(state.botKing, { row: 9, col: 4 });
    assert.deepStrictEqual(state.opponentKing, { row: 0, col: 4 });
    assert.strictEqual(state.botInCheck, false);
    assert.deepStrictEqual(state.pieces[0], { type: 'R', color: 'red', row: 0, col: 0 });
  });

  it('getAlivePieces chỉ trả về quân đang có trên bàn kèm toạ độ', () => {
    const board = boardWithKings();
    put(board, 5, 5, 'H', 'black');
    const pieces = getAlivePieces(board);
    assert.strictEqual(pieces.length, 3);
    assert.ok(pieces.some((p) => p.type === 'H' && p.color === 'black' && p.row === 5 && p.col === 5));
  });

  it('Phản ánh Tướng của Bot đang bị chiếu', () => {
    const board = boardWithKings();
    put(board, 8, 3, 'C', 'red'); // Pháo sát Tướng, không có ngòi: không chiếu
    assert.strictEqual(extractBoardState(board, 'black').botInCheck, false);
    put(board, 5, 3, 'C', 'red'); // Pháo (8,3) thành ngòi cho Pháo (5,3): chiếu
    assert.strictEqual(extractBoardState(board, 'black').botInCheck, true);
  });

  it('Bàn cờ thiếu Tướng thì vị trí Tướng là null', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    const state = extractBoardState(board, 'black');
    assert.strictEqual(state.botKing, null);
    assert.deepStrictEqual(state.opponentKing, { row: 0, col: 4 });
  });

  it('Không làm thay đổi bàn cờ đầu vào', () => {
    const board = createInitialBoard();
    const snapshot = JSON.stringify(board);
    extractBoardState(board, 'red');
    getThreatenedSquares(board, 'red');
    getThreatenedPieces(board, 'red');
    getSafeMoves(board, 'red');
    evaluate(board, 'red');
    assert.strictEqual(JSON.stringify(board), snapshot);
  });
});

describe('Giao điểm bị đe doạ (COT-633)', () => {
  it('Xe đe doạ toàn bộ hàng và cột tới khi gặp quân, không đe doạ ô mình đứng', () => {
    const board = boardWithKings();
    put(board, 4, 0, 'R', 'red');
    put(board, 4, 6, 'P', 'black');
    const squares = getThreatenedSquares(board, 'red');
    for (let c = 1; c <= 6; c++) {
      assert.ok(hasSquare(squares, 4, c), `(4,${c}) phải bị đe doạ`);
    }
    assert.ok(!hasSquare(squares, 4, 7)); // sau quân cản
    assert.ok(hasSquare(squares, 9, 0));
    assert.ok(hasSquare(squares, 0, 0));
    assert.ok(!hasSquare(squares, 4, 0));
    assert.ok(hasSquare(squares, 1, 4)); // Tướng Đỏ khống chế ô kề trong Cung
  });

  it('Tướng không đe doạ ô mà nếu ăn vào sẽ đối mặt Tướng địch', () => {
    const board = boardWithKings(); // Tướng Đen ở cột 3
    const squares = getThreatenedSquares(board, 'red');
    assert.ok(!hasSquare(squares, 0, 3));
    assert.ok(hasSquare(squares, 0, 5));
  });

  it('Pháo chỉ đe doạ các ô phía sau đúng 1 ngòi, không đe doạ ô nó có thể đi thường', () => {
    const board = boardWithKings();
    put(board, 2, 1, 'C', 'red');
    put(board, 6, 1, 'P', 'black'); // ngòi
    const squares = getThreatenedSquares(board, 'red');
    assert.ok(hasSquare(squares, 7, 1));
    assert.ok(hasSquare(squares, 9, 1));
    assert.ok(!hasSquare(squares, 4, 1));
    assert.ok(!hasSquare(squares, 6, 1));
  });

  it('Mã bị cản chân không đe doạ hai ô tương ứng', () => {
    const board = boardWithKings();
    put(board, 4, 4, 'H', 'red');
    put(board, 5, 4, 'P', 'black'); // cản chân hướng tiến
    const squares = getThreatenedSquares(board, 'red');
    assert.ok(!hasSquare(squares, 6, 3));
    assert.ok(!hasSquare(squares, 6, 5));
    assert.ok(hasSquare(squares, 2, 3));
    assert.ok(hasSquare(squares, 5, 6));
  });

  it('Tốt chưa qua sông chỉ đe doạ ô phía trước', () => {
    const board = boardWithKings();
    put(board, 6, 0, 'P', 'black');
    const squares = getThreatenedSquares(board, 'black');
    assert.ok(hasSquare(squares, 5, 0));
    assert.ok(!hasSquare(squares, 6, 1));
    assert.ok(!hasSquare(squares, 7, 0));
  });

  it('getThreatenedPieces liệt kê quân của Bot đang bị đối phương đe doạ ăn', () => {
    const board = boardWithKings();
    put(board, 5, 0, 'R', 'black');
    put(board, 5, 8, 'H', 'black');
    put(board, 5, 3, 'C', 'red'); // Pháo Đỏ ăn được Mã (5,8)? Không: thiếu ngòi
    put(board, 2, 0, 'R', 'red'); // Xe Đỏ đe doạ Xe Đen (5,0)
    const threatened = getThreatenedPieces(board, 'black');
    assert.deepStrictEqual(
      threatened.map((p) => `${p.type}@${p.row},${p.col}`),
      ['R@5,0']
    );
  });
});

describe('Nước đi an toàn của Bot (COT-633)', () => {
  it('Thế ban đầu có 44 nước an toàn cho mỗi bên, trùng với generateLegalMoves', () => {
    const board = createInitialBoard();
    assert.strictEqual(getSafeMoves(board, 'red').length, 44);
    assert.strictEqual(getSafeMoves(board, 'black').length, 44);
    assert.deepStrictEqual(getSafeMoves(board, 'black'), generateLegalMoves(board, 'black'));
  });

  it('Mọi nước an toàn đều chỉ dùng quân của Bot và không để Tướng Bot bị chiếu', () => {
    const board = boardWithKings([0, 4], [9, 4]);
    put(board, 8, 4, 'H', 'black'); // quân cản duy nhất giữa hai Tướng
    put(board, 5, 3, 'R', 'red'); // khống chế cột 3
    put(board, 7, 8, 'R', 'black');
    const moves = getSafeMoves(board, 'black');
    assert.ok(moves.length > 0);
    for (const move of moves) {
      assert.strictEqual(board[move.from.row][move.from.col].color, 'black');
      assert.strictEqual(isInCheck(applyMove(board, move).board, 'black'), false);
    }
    assert.ok(moves.every((m) => !(m.from.row === 8 && m.from.col === 4))); // Mã không được rời cột
    assert.ok(moves.every((m) => !(m.to.row === 9 && m.to.col === 3))); // Tướng không vào ô bị khống chế
  });

  it('Khi Bot đang bị chiếu chỉ trả về nước giải chiếu', () => {
    const board = boardWithKings([0, 3], [9, 4]);
    put(board, 5, 4, 'R', 'red');
    put(board, 7, 0, 'R', 'black');
    const moves = getSafeMoves(board, 'black');
    const keys = moves.map((m) => `${m.from.row},${m.from.col}->${m.to.row},${m.to.col}`).sort();
    assert.deepStrictEqual(keys, ['7,0->7,4', '9,4->9,5']);
  });

  it('Bot bị chiếu bí thì không còn nước an toàn nào', () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 3, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    assert.deepStrictEqual(getSafeMoves(board, 'black'), []);
  });
});

describe('Hàm đánh giá vật chất evaluate (COT-633)', () => {
  it('Thế ban đầu cân bằng điểm 0 cho cả hai bên', () => {
    const board = createInitialBoard();
    assert.strictEqual(evaluate(board, 'red'), 0);
    assert.strictEqual(evaluate(board, 'black'), 0);
  });

  it('Mất một Xe thì lệch đúng giá trị Xe, điểm hai bên đối xứng', () => {
    const board = createInitialBoard();
    board[9][0] = null;
    assert.strictEqual(evaluate(board, 'red'), PIECE_VALUES.R);
    assert.strictEqual(evaluate(board, 'black'), -PIECE_VALUES.R);
  });

  it('Tốt qua sông có giá trị cao hơn Tốt chưa qua sông', () => {
    const board = boardWithKings();
    put(board, 3, 0, 'P', 'red');
    assert.strictEqual(evaluate(board, 'red'), PIECE_VALUES.P);
    board[3][0] = null;
    put(board, 5, 0, 'P', 'red');
    assert.strictEqual(evaluate(board, 'red'), CROSSED_PAWN_VALUE);
    put(board, 4, 8, 'P', 'black'); // Tốt Đen đã qua sông
    assert.strictEqual(evaluate(board, 'red'), 0);
  });

  it('Thứ tự giá trị quân: Xe > Pháo > Mã > Sĩ = Tượng > Tốt, Tướng không tính điểm', () => {
    assert.ok(PIECE_VALUES.R > PIECE_VALUES.C);
    assert.ok(PIECE_VALUES.C > PIECE_VALUES.H);
    assert.ok(PIECE_VALUES.H > PIECE_VALUES.A);
    assert.strictEqual(PIECE_VALUES.A, PIECE_VALUES.E);
    assert.ok(PIECE_VALUES.E > PIECE_VALUES.P);
    assert.strictEqual(PIECE_VALUES.K, 0);
  });
});

describe('Hiệu năng (COT-633)', () => {
  const measure = (fn, runs = 20) => {
    fn(); // làm nóng
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      fn();
    }
    return (performance.now() - start) / runs;
  };

  it('getSafeMoves từ thế ban đầu chạy dưới 30ms', () => {
    const board = createInitialBoard();
    const avg = measure(() => getSafeMoves(board, 'red'));
    assert.ok(avg < 30, `getSafeMoves trung bình ${avg.toFixed(2)}ms`);
  });

  it('extractBoardState + getThreatenedSquares từ thế ban đầu chạy dưới 30ms', () => {
    const board = createInitialBoard();
    const avg = measure(() => {
      extractBoardState(board, 'black');
      getThreatenedSquares(board, 'red');
    });
    assert.ok(avg < 30, `trung bình ${avg.toFixed(2)}ms`);
  });
});
