require('./helpers/testEnv.js');
/**
 * COT-635: Lượt đi của máy trong trận PvE - chọn ngẫu nhiên một nước hợp lệ
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { generateLegalMoves } = require('../src/domain/rules/moveGenerator');
const { getGameStatus } = require('../src/domain/rules/gameStatus');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { BOT_TURN_SKIP_REASON } = require('../src/application/use-cases/game/pve/playBotTurn');
const { ERROR_CODES } = require('../src/core/errors/AppError');
const { InMemoryPveMatchRepository } = require('./helpers/InMemoryPveMatchRepository');
const { put, mv, createFakeClock, seededRandom, snapshot, assertUnchanged } = require('./helpers/pveFixtures');

const USER_ID = 7;
const sameMove = (a, b) =>
  a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;

function setup(random = seededRandom(1)) {
  const repo = new InMemoryPveMatchRepository();
  const useCases = createPveUseCases({ pveMatchRepository: repo, clock: createFakeClock(), random });
  return { repo, useCases };
}

const createWithBoard = (repo, board, { playerColor, sideToMove }) =>
  repo.create({
    userId: USER_ID,
    playerColor,
    botColor: playerColor === 'red' ? 'black' : 'red',
    board,
    sideToMove,
    now: '2026-01-01T00:00:00.000Z',
  });

// Đen bị chiếu bí: Xe Đỏ chiếu dọc cột 3, Tướng Đỏ khống chế cột 4 (luật đối mặt)
function blackCheckmatedBoard() {
  const board = createEmptyBoard();
  put(board, 0, 4, 'K', 'red');
  put(board, 7, 3, 'R', 'red');
  put(board, 9, 3, 'K', 'black');
  return board;
}

// Đen không bị chiếu nhưng hết nước: (8,3) bị Xe hàng 8 khống chế, (9,4) đối mặt Tướng Đỏ
function blackStalematedBoard() {
  const board = createEmptyBoard();
  put(board, 0, 4, 'K', 'red');
  put(board, 8, 0, 'R', 'red');
  put(board, 9, 3, 'K', 'black');
  return board;
}

describe('Máy chọn ngẫu nhiên nước đi hợp lệ (COT-635)', () => {
  it('Máy luôn đi nước hợp lệ qua nhiều lượt với các seed khác nhau', async () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      const { repo, useCases } = setup(seededRandom(seed));
      const playerRandom = seededRandom(seed * 7919);
      let match = await useCases.createPveMatch({ userId: USER_ID, playerColor: seed % 2 ? 'black' : 'red' });

      for (let turn = 0; turn < 60 && match.status === 'PLAYING'; turn++) {
        const legal = generateLegalMoves(match.board, match.sideToMove);
        if (match.sideToMove === match.botColor) {
          const result = await useCases.playBotTurn(match.id);
          assert.equal(result.played, true, `seed ${seed}: máy phải đi được`);
          assert.ok(legal.some((m) => sameMove(m, result.move)), `seed ${seed}: nước của máy phải hợp lệ`);
          assert.equal(result.move.actor, 'BOT');
          assert.equal(result.move.side, match.botColor);
        } else {
          const choice = legal[Math.floor(playerRandom() * legal.length)];
          await useCases.submitPlayerMove(match.id, USER_ID, choice);
        }
        match = await repo.findById(match.id);
      }

      const moves = await repo.listMoves(match.id);
      assert.equal(moves.length, match.ply);
      moves.forEach((m, i) => {
        assert.equal(m.ply, i + 1);
        assert.equal(m.side, i % 2 === 0 ? 'red' : 'black', 'Hai bên phải đi luân phiên, Đỏ trước');
        assert.equal(m.actor, m.side === match.botColor ? 'BOT' : 'PLAYER');
      });
    }
  });

  it('Nguồn random quyết định nước được chọn trong danh sách nước hợp lệ', async () => {
    const pick = async (value) => {
      const { useCases } = setup(() => value);
      const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
      const legal = generateLegalMoves(match.board, 'red');
      const result = await useCases.playBotTurn(match.id);
      return { legal, move: result.move };
    };
    const first = await pick(0);
    assert.ok(sameMove(first.move, first.legal[0]));
    const last = await pick(0.999999);
    assert.ok(sameMove(last.move, last.legal[last.legal.length - 1]));
  });

  it('Không đi khi chưa tới lượt máy', async () => {
    const { repo, useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const before = await snapshot(repo, match.id);
    const result = await useCases.playBotTurn(match.id);
    assert.equal(result.played, false);
    assert.equal(result.reason, BOT_TURN_SKIP_REASON.NOT_BOT_TURN);
    await assertUnchanged(repo, match.id, before);
  });

  it('Gọi lượt máy 2 lần liên tiếp chỉ đi đúng một nước', async () => {
    const { repo, useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    const first = await useCases.playBotTurn(match.id, { expectedPly: 0 });
    assert.equal(first.played, true);
    const second = await useCases.playBotTurn(match.id, { expectedPly: 0 });
    assert.equal(second.played, false);
    assert.equal(second.reason, BOT_TURN_SKIP_REASON.ALREADY_PLAYED);
    const third = await useCases.playBotTurn(match.id);
    assert.equal(third.played, false);
    assert.equal(third.reason, BOT_TURN_SKIP_REASON.NOT_BOT_TURN);
    assert.equal((await repo.listMoves(match.id)).length, 1);
    assert.equal((await repo.findById(match.id)).ply, 1);
  });

  it('Gọi lượt máy đồng thời chỉ đi đúng một nước', async () => {
    const { repo, useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    const results = await Promise.all([
      useCases.playBotTurn(match.id),
      useCases.playBotTurn(match.id),
      useCases.playBotTurn(match.id),
    ]);
    assert.equal(results.filter((r) => r.played).length, 1);
    assert.ok(results.filter((r) => !r.played).every((r) => r.reason === BOT_TURN_SKIP_REASON.ALREADY_PLAYED));
    assert.equal((await repo.listMoves(match.id)).length, 1);
    const saved = await repo.findById(match.id);
    assert.equal(saved.ply, 1);
    assert.equal(saved.sideToMove, 'black');
  });

  it('Sau nước máy trả lượt cho người chơi, người chơi đi tiếp được', async () => {
    const { repo, useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    const bot = await useCases.playBotTurn(match.id);
    assert.equal(bot.match.sideToMove, 'black');
    assert.equal(bot.gameStatus.status === 'ONGOING' || bot.gameStatus.status === 'CHECK', true);
    const reply = generateLegalMoves(bot.match.board, 'black')[0];
    const after = await useCases.submitPlayerMove(match.id, USER_ID, reply);
    assert.equal(after.match.sideToMove, 'red');
    assert.equal((await repo.findById(match.id)).ply, 2);
  });

  it('Không có tham số độ khó: playBotTurn chỉ nhận matchId và tuỳ chọn expectedPly', () => {
    const { useCases } = setup();
    assert.ok(useCases.playBotTurn.length <= 2);
  });

  it('Trận không tồn tại ném MATCH_NOT_FOUND', async () => {
    const { useCases } = setup();
    await assert.rejects(useCases.playBotTurn(404), (err) => err.code === ERROR_CODES.MATCH_NOT_FOUND);
  });
});

describe('Kết thúc ván sau nước đi trong trận PvE (COT-635)', () => {
  let repo;
  let useCases;

  beforeEach(() => {
    ({ repo, useCases } = setup());
  });

  it('Máy bị chiếu bí, không còn nước hợp lệ: máy thua', async () => {
    const board = blackCheckmatedBoard();
    assert.equal(getGameStatus(board, 'black').status, 'CHECKMATE');
    const match = await createWithBoard(repo, board, { playerColor: 'red', sideToMove: 'black' });
    const result = await useCases.playBotTurn(match.id);
    assert.equal(result.played, false);
    assert.equal(result.reason, BOT_TURN_SKIP_REASON.BOT_HAS_NO_MOVES);
    assert.equal(result.match.status, 'FINISHED');
    assert.equal(result.match.result, 'WIN');
    assert.equal(result.match.endReason, 'CHECKMATE');
    assert.equal((await repo.listMoves(match.id)).length, 0);
  });

  it('Máy hết nước (không bị chiếu): máy thua với lý do NO_LEGAL_MOVES', async () => {
    const board = blackStalematedBoard();
    assert.equal(getGameStatus(board, 'black').status, 'NO_LEGAL_MOVES');
    const match = await createWithBoard(repo, board, { playerColor: 'red', sideToMove: 'black' });
    const result = await useCases.playBotTurn(match.id);
    assert.equal(result.match.status, 'FINISHED');
    assert.equal(result.match.result, 'WIN');
    assert.equal(result.match.endReason, 'NO_LEGAL_MOVES');
  });

  it('Người chơi chiếu bí máy: trận kết thúc ngay, người chơi thắng, máy không đi nữa', async () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 0, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    const match = await createWithBoard(repo, board, { playerColor: 'red', sideToMove: 'red' });

    const result = await useCases.submitPlayerMove(match.id, USER_ID, mv(7, 0, 7, 3));
    assert.equal(result.gameStatus.status, 'CHECKMATE');
    assert.equal(result.match.status, 'FINISHED');
    assert.equal(result.match.result, 'WIN');
    assert.equal(result.match.endReason, 'CHECKMATE');

    const bot = await useCases.playBotTurn(match.id);
    assert.equal(bot.played, false);
    assert.equal(bot.reason, BOT_TURN_SKIP_REASON.MATCH_FINISHED);
    await assert.rejects(
      useCases.submitPlayerMove(match.id, USER_ID, mv(0, 4, 1, 4)),
      (err) => err.code === ERROR_CODES.MATCH_FINISHED
    );
    assert.equal((await repo.listMoves(match.id)).length, 1);
  });

  it('Máy chiếu bí người chơi: người chơi thua', async () => {
    const board = createEmptyBoard();
    put(board, 9, 4, 'K', 'black');
    put(board, 2, 0, 'R', 'black');
    put(board, 0, 3, 'K', 'red');
    const legal = generateLegalMoves(board, 'black');
    const mateIndex = legal.findIndex((m) => sameMove(m, mv(2, 0, 2, 3)));
    assert.ok(mateIndex >= 0);

    const scripted = setup(() => (mateIndex + 0.5) / legal.length);
    const match = await createWithBoard(scripted.repo, board, { playerColor: 'red', sideToMove: 'black' });
    const result = await scripted.useCases.playBotTurn(match.id);
    assert.equal(result.played, true);
    assert.ok(sameMove(result.move, mv(2, 0, 2, 3)));
    assert.equal(result.gameStatus.status, 'CHECKMATE');
    assert.equal(result.match.status, 'FINISHED');
    assert.equal(result.match.result, 'LOSS');
    assert.equal(result.match.endReason, 'CHECKMATE');
  });

  it('Chốt kết quả đúng một lần: gọi kết thúc lần 2 không ghi đè', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const first = await useCases.finishPveMatch(match.id, { result: 'WIN', endReason: 'CHECKMATE' });
    assert.equal(first.finished, true);
    const second = await useCases.finishPveMatch(match.id, { result: 'LOSS', endReason: 'RESIGN' });
    assert.equal(second.finished, false);
    assert.equal(second.match.result, 'WIN');
    assert.equal(second.match.endReason, 'CHECKMATE');
  });
});
