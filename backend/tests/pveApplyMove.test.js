require('./helpers/testEnv.js');
/**
 * COT-634: Áp dụng nước đi của người chơi trong trận PvE qua engine luật cờ dùng chung
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyBoard, createInitialBoard } = require('../src/domain/rules/board');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { ERROR_CODES } = require('../src/core/errors/AppError');
const { InMemoryPveMatchRepository } = require('./helpers/InMemoryPveMatchRepository');
const { put, mv, createFakeClock, snapshot, assertUnchanged } = require('./helpers/pveFixtures');

const USER_ID = 7;

const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err.code === code);

describe('Tạo trận PvE (COT-634)', () => {
  let repo;
  let useCases;

  beforeEach(() => {
    repo = new InMemoryPveMatchRepository();
    useCases = createPveUseCases({ pveMatchRepository: repo, clock: createFakeClock() });
  });

  it('Người chọn Đỏ: người đi trước, máy cầm Đen, bàn cờ ở thế ban đầu', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    assert.equal(match.playerColor, 'red');
    assert.equal(match.botColor, 'black');
    assert.equal(match.sideToMove, 'red');
    assert.equal(match.status, 'PLAYING');
    assert.equal(match.ply, 0);
    assert.deepEqual(match.board, createInitialBoard());
  });

  it('Người chọn Đen: máy cầm Đỏ và tới lượt máy đi trước', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    assert.equal(match.botColor, 'red');
    assert.equal(match.sideToMove, match.botColor);
  });

  it('Màu quân không hợp lệ bị từ chối', async () => {
    await rejectsWith(useCases.createPveMatch({ userId: USER_ID, playerColor: 'blue' }), ERROR_CODES.INVALID_INPUT);
  });
});

describe('Người chơi đi quân trong trận PvE (COT-634)', () => {
  let repo;
  let useCases;

  beforeEach(() => {
    repo = new InMemoryPveMatchRepository();
    useCases = createPveUseCases({ pveMatchRepository: repo, clock: createFakeClock() });
  });

  it('Nước hợp lệ được lưu, tăng ply và chuyển lượt cho máy', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const result = await useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 2, 4));

    const saved = await repo.findById(match.id);
    assert.equal(saved.ply, 1);
    assert.equal(saved.sideToMove, 'black');
    assert.equal(saved.board[2][1], null);
    assert.deepEqual(saved.board[2][4], { type: 'C', color: 'red' });
    assert.deepEqual(result.match.board, saved.board);

    const moves = await repo.listMoves(match.id);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].ply, 1);
    assert.equal(moves[0].side, 'red');
    assert.equal(moves[0].actor, 'PLAYER');
    assert.equal(moves[0].pieceType, 'C');
    assert.deepEqual(moves[0].from, { row: 2, col: 1 });
    assert.deepEqual(moves[0].to, { row: 2, col: 4 });
    assert.equal(moves[0].capturedType, null);
  });

  it('Nước ăn quân lưu lại loại quân bị ăn', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    // Pháo Đỏ cột 1 ăn Mã Đen qua ngòi là Pháo Đen
    await useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 9, 1));
    const moves = await repo.listMoves(match.id);
    assert.equal(moves[0].capturedType, 'H');
    const saved = await repo.findById(match.id);
    assert.deepEqual(saved.board[9][1], { type: 'C', color: 'red' });
  });

  it('Nước sai luật bị từ chối và bàn cờ không đổi', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const before = await snapshot(repo, match.id);
    // Xe Đỏ bị Tốt Đỏ chặn ở (3,0)
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(0, 0, 5, 0)), ERROR_CODES.ILLEGAL_MOVE);
    // Đi từ ô trống
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(4, 4, 5, 4)), ERROR_CODES.ILLEGAL_MOVE);
    await assertUnchanged(repo, match.id, before);
  });

  it('Đi quân của bên kia bị từ chối và bàn cờ không đổi', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(6, 0, 5, 0)), ERROR_CODES.ILLEGAL_MOVE);
    await assertUnchanged(repo, match.id, before);
  });

  it('Đi khi chưa tới lượt bị từ chối và bàn cờ không đổi', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(6, 0, 5, 0)), ERROR_CODES.NOT_YOUR_TURN);
    await assertUnchanged(repo, match.id, before);
  });

  it('Nước tự làm Tướng mình bị chiếu (quân bị ghim rời đường) bị từ chối', async () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 1, 4, 'R', 'red'); // bị Xe Đen ghim trên cột 4
    put(board, 5, 4, 'R', 'black');
    put(board, 9, 3, 'K', 'black');
    const match = await repo.create({
      userId: USER_ID,
      playerColor: 'red',
      botColor: 'black',
      board,
      sideToMove: 'red',
      now: '2026-01-01T00:00:00.000Z',
    });
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(1, 4, 1, 0)), ERROR_CODES.ILLEGAL_MOVE);
    await assertUnchanged(repo, match.id, before);

    // Nước vẫn giữ đường ghim (Xe tiến dọc cột 4 ăn Xe Đen) là hợp lệ
    const result = await useCases.submitPlayerMove(match.id, USER_ID, mv(1, 4, 5, 4));
    assert.equal(result.move.capturedType, 'R');
  });

  it('Nước sai định dạng hoặc ngoài bàn cờ bị từ chối', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, null), ERROR_CODES.INVALID_MOVE);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(0, 0, 10, 0)), ERROR_CODES.INVALID_MOVE);
    await rejectsWith(
      useCases.submitPlayerMove(match.id, USER_ID, { from: { row: '2', col: 1 }, to: { row: 2, col: 4 } }),
      ERROR_CODES.INVALID_MOVE
    );
    await assertUnchanged(repo, match.id, before);
  });

  it('Sai trận hoặc không phải chủ trận bị từ chối', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(999, USER_ID, mv(2, 1, 2, 4)), ERROR_CODES.MATCH_NOT_FOUND);
    await rejectsWith(useCases.submitPlayerMove(match.id, 8, mv(2, 1, 2, 4)), ERROR_CODES.NOT_MATCH_OWNER);
    await assertUnchanged(repo, match.id, before);
  });

  it('Trận đã kết thúc thì mọi nước đi bị từ chối', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    repo.matches.get(match.id).status = 'FINISHED';
    const before = await snapshot(repo, match.id);
    await rejectsWith(useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 2, 4)), ERROR_CODES.MATCH_FINISHED);
    await assertUnchanged(repo, match.id, before);
  });

  it('Lưu dựa trên trạng thái cũ (ply đã đổi) bị từ chối MOVE_CONFLICT, không ghi đè', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const stale = await repo.findById(match.id);
    await useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 2, 4));
    const before = await snapshot(repo, match.id);
    await rejectsWith(
      useCases.applyAndPersistMove(stale, { side: 'red', actor: 'PLAYER', move: mv(2, 7, 2, 4) }),
      ERROR_CODES.MOVE_CONFLICT
    );
    await assertUnchanged(repo, match.id, before);
  });
});
