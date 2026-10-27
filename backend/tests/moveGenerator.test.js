require('./helpers/testEnv.js');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createEmptyBoard, createInitialBoard } = require('../src/domain/rules/board');
const {
  opponentOf,
  getPseudoMoves,
  findKing,
  applyMove,
  isSquareAttacked,
  isInCheck,
  generateLegalMoves,
  getLegalMovesForPiece,
  isLegalMove,
} = require('../src/domain/rules/moveGenerator');

const put = (board, row, col, type, color) => {
  board[row][col] = { type, color };
  return board;
};

const mv = (fromRow, fromCol, toRow, toCol) => ({
  from: { row: fromRow, col: fromCol },
  to: { row: toRow, col: toCol },
});

const hasMove = (moves, fromRow, fromCol, toRow, toCol) =>
  moves.some(
    (m) => m.from.row === fromRow && m.from.col === fromCol && m.to.row === toRow && m.to.col === toCol
  );

// Hai Tướng lệch cột để không đối mặt: Tướng Đỏ (0,4), Tướng Đen (9,3)
function boardWithKings(redKing = [0, 4], blackKing = [9, 3]) {
  const board = createEmptyBoard();
  put(board, redKing[0], redKing[1], 'K', 'red');
  put(board, blackKing[0], blackKing[1], 'K', 'black');
  return board;
}

function perft(board, color, depth) {
  const moves = generateLegalMoves(board, color);
  if (depth === 1) {
    return moves.length;
  }
  let nodes = 0;
  for (const move of moves) {
    nodes += perft(applyMove(board, move).board, opponentOf(color), depth - 1);
  }
  return nodes;
}

describe('Bàn cờ ban đầu (COT-641)', () => {
  it('createInitialBoard đặt đủ 32 quân theo quy ước Đỏ hàng 0–4, Đen hàng 5–9', () => {
    const board = createInitialBoard();
    const pieces = board.flat().filter(Boolean);
    assert.strictEqual(pieces.length, 32);
    assert.strictEqual(pieces.filter((p) => p.color === 'red').length, 16);
    assert.deepStrictEqual(board[0][4], { type: 'K', color: 'red' });
    assert.deepStrictEqual(board[9][4], { type: 'K', color: 'black' });
    assert.deepStrictEqual(board[2][1], { type: 'C', color: 'red' });
    assert.deepStrictEqual(board[7][7], { type: 'C', color: 'black' });
    for (const col of [0, 2, 4, 6, 8]) {
      assert.deepStrictEqual(board[3][col], { type: 'P', color: 'red' });
      assert.deepStrictEqual(board[6][col], { type: 'P', color: 'black' });
    }
    assert.deepStrictEqual(
      board[0].map((p) => p.type),
      ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R']
    );
    for (let r = 0; r <= 4; r++) {
      assert.ok(board[r].every((p) => !p || p.color === 'red'));
    }
    for (let r = 5; r <= 9; r++) {
      assert.ok(board[r].every((p) => !p || p.color === 'black'));
    }
  });

  it('Mỗi lần gọi tạo một bàn cờ mới độc lập', () => {
    const a = createInitialBoard();
    const b = createInitialBoard();
    a[0][0] = null;
    assert.ok(b[0][0]);
  });
});

describe('Engine dùng chung: getPseudoMoves / findKing / applyMove (COT-641)', () => {
  it('getPseudoMoves dispatch đúng theo loại quân và trả [] cho ô trống', () => {
    const board = createInitialBoard();
    assert.strictEqual(getPseudoMoves(board, 0, 0).length, 2); // Xe góc
    assert.strictEqual(getPseudoMoves(board, 0, 1).length, 2); // Mã
    assert.strictEqual(getPseudoMoves(board, 0, 2).length, 2); // Tượng
    assert.strictEqual(getPseudoMoves(board, 0, 3).length, 1); // Sĩ
    assert.strictEqual(getPseudoMoves(board, 0, 4).length, 1); // Tướng
    assert.strictEqual(getPseudoMoves(board, 3, 0).length, 1); // Tốt
    assert.ok(getPseudoMoves(board, 2, 1).some((m) => m.row === 9 && m.col === 1 && m.capture)); // Pháo ăn Mã
    assert.deepStrictEqual(getPseudoMoves(board, 4, 4), []);
  });

  it('findKing trả về vị trí Tướng hoặc null', () => {
    const board = createInitialBoard();
    assert.deepStrictEqual(findKing(board, 'red'), { row: 0, col: 4 });
    assert.deepStrictEqual(findKing(board, 'black'), { row: 9, col: 4 });
    assert.strictEqual(findKing(createEmptyBoard(), 'red'), null);
  });

  it('applyMove trả về bàn cờ mới, không sửa bàn gốc, và trả quân bị ăn', () => {
    const board = boardWithKings();
    put(board, 4, 0, 'R', 'red');
    put(board, 6, 0, 'P', 'black');
    const { board: next, captured } = applyMove(board, mv(4, 0, 6, 0));
    assert.notStrictEqual(next, board);
    assert.deepStrictEqual(next[6][0], { type: 'R', color: 'red' });
    assert.strictEqual(next[4][0], null);
    assert.deepStrictEqual(captured, { type: 'P', color: 'black' });
    assert.deepStrictEqual(board[4][0], { type: 'R', color: 'red' });
    assert.deepStrictEqual(board[6][0], { type: 'P', color: 'black' });
  });

  it('applyMove trả captured = null khi đi vào ô trống và báo lỗi khi ô xuất phát trống', () => {
    const board = boardWithKings();
    put(board, 4, 0, 'R', 'red');
    assert.strictEqual(applyMove(board, mv(4, 0, 5, 0)).captured, null);
    assert.throws(() => applyMove(board, mv(5, 5, 6, 5)));
  });
});

describe('Phát hiện Chiếu Tướng (COT-641)', () => {
  it('Thế ban đầu không bên nào bị chiếu', () => {
    const board = createInitialBoard();
    assert.strictEqual(isInCheck(board, 'red'), false);
    assert.strictEqual(isInCheck(board, 'black'), false);
  });

  it('Chiếu bởi Xe cùng cột, hết chiếu khi có quân cản', () => {
    const board = boardWithKings();
    put(board, 5, 4, 'R', 'black');
    assert.strictEqual(isInCheck(board, 'red'), true);
    put(board, 3, 4, 'P', 'red');
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('Chiếu bởi Xe cùng hàng', () => {
    const board = boardWithKings([1, 4]);
    put(board, 1, 8, 'R', 'black');
    assert.strictEqual(isInCheck(board, 'red'), true);
    put(board, 1, 6, 'H', 'black'); // quân địch cản cũng chặn đường Xe
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('Chiếu bởi Mã (chữ L), hết chiếu khi chân Mã bị cản', () => {
    const board = boardWithKings();
    put(board, 2, 5, 'H', 'black'); // (2,5) -> (0,4), chân Mã tại (1,5)
    assert.strictEqual(isInCheck(board, 'red'), true);
    put(board, 1, 5, 'R', 'red');
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('Chiếu bởi Mã nằm ngang, chân Mã bị cản bởi quân của chính bên chiếu cũng không chiếu', () => {
    const board = boardWithKings();
    put(board, 1, 6, 'H', 'black'); // (1,6) -> (0,4), chân Mã tại (1,5)
    assert.strictEqual(isInCheck(board, 'red'), true);
    put(board, 1, 5, 'P', 'black');
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('Chiếu bởi Pháo khi có đúng 1 ngòi; không ngòi hoặc 2 ngòi thì không chiếu', () => {
    const board = boardWithKings();
    put(board, 6, 4, 'C', 'black');
    assert.strictEqual(isInCheck(board, 'red'), false); // không ngòi
    put(board, 3, 4, 'P', 'red');
    assert.strictEqual(isInCheck(board, 'red'), true); // 1 ngòi (quân Đỏ)
    put(board, 2, 4, 'H', 'black');
    assert.strictEqual(isInCheck(board, 'red'), false); // 2 ngòi
    board[3][4] = null;
    assert.strictEqual(isInCheck(board, 'red'), true); // 1 ngòi (quân Đen)
  });

  it('Chiếu bởi Tốt tiến thẳng và Tốt đã qua sông đi ngang', () => {
    const forward = boardWithKings();
    put(forward, 1, 4, 'P', 'black');
    assert.strictEqual(isInCheck(forward, 'red'), true);

    const sideways = boardWithKings();
    put(sideways, 0, 3, 'P', 'black');
    assert.strictEqual(isInCheck(sideways, 'red'), true);

    const redPawn = boardWithKings([0, 3], [8, 4]);
    put(redPawn, 8, 3, 'P', 'red');
    assert.strictEqual(isInCheck(redPawn, 'black'), true);
  });

  it('Tốt không chiếu theo hướng lùi', () => {
    const board = boardWithKings([1, 4]);
    put(board, 0, 4, 'P', 'black'); // Tốt Đen tiến về hàng nhỏ hơn, không lùi lên hàng 1
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('Hai Tướng đối mặt cùng cột không có quân cản thì cả hai bên đều tính là bị chiếu', () => {
    const board = boardWithKings([0, 4], [9, 4]);
    assert.strictEqual(isInCheck(board, 'red'), true);
    assert.strictEqual(isInCheck(board, 'black'), true);
    put(board, 5, 4, 'P', 'black');
    assert.strictEqual(isInCheck(board, 'red'), false);
    assert.strictEqual(isInCheck(board, 'black'), false);
  });

  it('Không có Tướng trên bàn cờ thì không tính là bị chiếu', () => {
    const board = createEmptyBoard();
    put(board, 5, 4, 'R', 'black');
    assert.strictEqual(isInCheck(board, 'red'), false);
  });

  it('isSquareAttacked: Pháo chỉ khống chế ô trống nằm sau ngòi', () => {
    const board = boardWithKings();
    put(board, 9, 0, 'C', 'black');
    put(board, 5, 0, 'P', 'red');
    assert.strictEqual(isSquareAttacked(board, 3, 0, 'black'), true);
    assert.strictEqual(isSquareAttacked(board, 7, 0, 'black'), false);
    // Bàn cờ gốc không bị sửa khi kiểm tra ô trống
    assert.strictEqual(board[3][0], null);
  });

  it('isSquareAttacked: Tượng không khống chế ô bên kia sông, Sĩ chỉ khống chế trong Cung', () => {
    const board = boardWithKings([0, 3]);
    put(board, 4, 2, 'E', 'red');
    put(board, 2, 3, 'A', 'red');
    assert.strictEqual(isSquareAttacked(board, 2, 0, 'red'), true);
    assert.strictEqual(isSquareAttacked(board, 6, 4, 'red'), false);
    assert.strictEqual(isSquareAttacked(board, 1, 4, 'red'), true);
    assert.strictEqual(isSquareAttacked(board, 3, 2, 'red'), false);
  });
});

describe('Lọc nước đi hợp lệ (COT-605/606/610/611/612/641)', () => {
  it('Quân Xe bị ghim chỉ được đi dọc theo đường ghim (kể cả ăn quân ghim)', () => {
    const board = boardWithKings();
    put(board, 3, 4, 'R', 'red');
    put(board, 7, 4, 'R', 'black');
    const moves = getLegalMovesForPiece(board, 3, 4);
    assert.ok(moves.length > 0);
    assert.ok(moves.every((m) => m.col === 4));
    assert.ok(moves.some((m) => m.row === 7 && m.capture));
    assert.strictEqual(isLegalMove(board, 'red', mv(3, 4, 3, 0)), false);
    assert.strictEqual(isLegalMove(board, 'red', mv(3, 4, 5, 4)), true);
  });

  it('Quân Mã bị Xe ghim không được đi nước nào', () => {
    const board = boardWithKings();
    put(board, 2, 4, 'H', 'red');
    put(board, 6, 4, 'R', 'black');
    assert.ok(getPseudoMoves(board, 2, 4).length > 0);
    assert.strictEqual(getLegalMovesForPiece(board, 2, 4).length, 0);
  });

  it('Bỏ một trong hai ngòi khiến Pháo địch chiếu là nước không hợp lệ', () => {
    const board = boardWithKings();
    put(board, 6, 4, 'C', 'black');
    put(board, 3, 4, 'R', 'red');
    put(board, 2, 4, 'H', 'red');
    assert.strictEqual(isInCheck(board, 'red'), false);
    assert.strictEqual(getLegalMovesForPiece(board, 2, 4).length, 0);
    // Xe vẫn đi dọc trong cột được vì vẫn còn đủ 2 ngòi
    assert.strictEqual(isLegalMove(board, 'red', mv(3, 4, 4, 4)), true);
    assert.strictEqual(isLegalMove(board, 'red', mv(3, 4, 3, 0)), false);
  });

  it('Quân cản duy nhất giữa hai Tướng không được rời khỏi cột (không lộ mặt Tướng)', () => {
    const board = boardWithKings([0, 4], [9, 4]);
    put(board, 4, 4, 'H', 'red');
    put(board, 5, 0, 'R', 'red');
    assert.ok(getPseudoMoves(board, 4, 4).length > 0);
    assert.strictEqual(getLegalMovesForPiece(board, 4, 4).length, 0);
    const legal = generateLegalMoves(board, 'red');
    assert.ok(legal.every((m) => !(m.from.row === 4 && m.from.col === 4)));
    assert.ok(hasMove(legal, 5, 0, 5, 8));
  });

  it('Tướng không được đi vào ô bị khống chế hoặc ô đối mặt Tướng địch', () => {
    const board = boardWithKings([1, 4], [9, 5]);
    put(board, 5, 3, 'R', 'black'); // khống chế cột 3
    const kingMoves = getLegalMovesForPiece(board, 1, 4);
    const targets = kingMoves.map((m) => `${m.row},${m.col}`).sort();
    assert.deepStrictEqual(targets, ['0,4', '2,4']);
    assert.strictEqual(isLegalMove(board, 'red', mv(1, 4, 1, 3)), false);
    assert.strictEqual(isLegalMove(board, 'red', mv(1, 4, 1, 5)), false);
  });

  it('Tướng không được ăn quân đang được bảo vệ', () => {
    const board = boardWithKings([1, 4]);
    put(board, 1, 5, 'R', 'black');
    put(board, 5, 5, 'R', 'black'); // bảo vệ Xe (1,5)
    assert.strictEqual(isLegalMove(board, 'red', mv(1, 4, 1, 5)), false);
    board[5][5] = null;
    assert.strictEqual(isLegalMove(board, 'red', mv(1, 4, 1, 5)), true);
  });

  it('Đang bị chiếu thì chỉ còn các nước giải chiếu', () => {
    const board = boardWithKings([0, 4], [9, 4]);
    put(board, 5, 4, 'R', 'black'); // chiếu Tướng Đỏ, đồng thời cản hai Tướng
    put(board, 3, 0, 'R', 'red'); // có thể chặn tại (3,4)
    put(board, 0, 0, 'H', 'red'); // không giúp được gì
    assert.strictEqual(isInCheck(board, 'red'), true);

    const legal = generateLegalMoves(board, 'red');
    const keys = legal.map((m) => `${m.from.row},${m.from.col}->${m.to.row},${m.to.col}`).sort();
    assert.deepStrictEqual(keys, ['0,4->0,3', '0,4->0,5', '3,0->3,4']);
    for (const move of legal) {
      assert.strictEqual(isInCheck(applyMove(board, move).board, 'red'), false);
    }
  });

  it('Đang bị chiếu có thể giải bằng cách ăn quân chiếu', () => {
    const board = boardWithKings();
    put(board, 2, 5, 'H', 'black');
    put(board, 2, 8, 'R', 'red');
    assert.strictEqual(isInCheck(board, 'red'), true);
    assert.strictEqual(isLegalMove(board, 'red', mv(2, 8, 2, 5)), true);
    assert.strictEqual(isLegalMove(board, 'red', mv(2, 8, 3, 8)), false);
  });

  it('isLegalMove từ chối nước sai lượt, ô trống, sai luật đi của quân hoặc dữ liệu thiếu', () => {
    const board = createInitialBoard();
    assert.strictEqual(isLegalMove(board, 'red', mv(2, 1, 2, 4)), true); // Pháo 2 bình 5
    assert.strictEqual(isLegalMove(board, 'black', mv(2, 1, 2, 4)), false);
    assert.strictEqual(isLegalMove(board, 'red', mv(4, 4, 5, 4)), false);
    assert.strictEqual(isLegalMove(board, 'red', mv(0, 0, 0, 1)), false);
    assert.strictEqual(isLegalMove(board, 'red', null), false);
    assert.strictEqual(isLegalMove(board, 'red', { from: { row: 0, col: 0 } }), false);
  });

  it('Mọi nước trong generateLegalMoves đều để Tướng mình an toàn', () => {
    const board = createInitialBoard();
    let side = 'red';
    let current = board;
    // Đi một chuỗi nước xác định (luôn chọn nước giữa danh sách) và kiểm tra bất biến
    for (let ply = 0; ply < 30; ply++) {
      const legal = generateLegalMoves(current, side);
      if (legal.length === 0) {
        break;
      }
      for (const move of legal) {
        assert.strictEqual(isInCheck(applyMove(current, move).board, side), false);
        assert.strictEqual(isLegalMove(current, side, move), true);
      }
      current = applyMove(current, legal[Math.floor(legal.length / 2)]).board;
      side = opponentOf(side);
    }
  });
});

describe('Perft từ thế ban đầu, Đỏ đi trước (COT-641)', () => {
  const start = createInitialBoard();

  it('Độ sâu 1 = 44', () => {
    assert.strictEqual(perft(start, 'red', 1), 44);
  });

  it('Độ sâu 2 = 1920', () => {
    assert.strictEqual(perft(start, 'red', 2), 1920);
  });

  it('Độ sâu 3 = 79666', () => {
    assert.strictEqual(perft(start, 'red', 3), 79666);
  });
});
