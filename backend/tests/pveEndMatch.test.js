require('./helpers/testEnv.js');
/**
 * COT-636: Kết thúc ván PvE (chiếu bí, hết nước, hết giờ, đầu hàng) và lịch sử đấu
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyBoard, createInitialBoard } = require('../src/domain/rules/board');
const { generateLegalMoves, applyMove } = require('../src/domain/rules/moveGenerator');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { BOT_TURN_SKIP_REASON } = require('../src/application/use-cases/game/pve/playBotTurn');
const { PLAYER_TURN_LIMIT_MS } = require('../src/domain/entities/PveMatch');
const { ERROR_CODES } = require('../src/core/errors/AppError');
const { InMemoryPveMatchRepository } = require('./helpers/InMemoryPveMatchRepository');
const { put, mv, createFakeClock, seededRandom } = require('./helpers/pveFixtures');

const USER_ID = 7;
const OTHER_USER_ID = 8;
const sameMove = (a, b) =>
  a.from.row === b.from.row && a.from.col === b.from.col && a.to.row === b.to.row && a.to.col === b.to.col;
const rejectsWith = (promise, code) => assert.rejects(promise, (err) => err.code === code);

function setup(random = seededRandom(5)) {
  const repo = new InMemoryPveMatchRepository();
  const clock = createFakeClock();
  const useCases = createPveUseCases({ pveMatchRepository: repo, clock, random });
  return { repo, clock, useCases };
}

const createWithBoard = (repo, clock, board, { playerColor, sideToMove }) =>
  repo.create({
    userId: USER_ID,
    playerColor,
    botColor: playerColor === 'red' ? 'black' : 'red',
    board,
    sideToMove,
    now: clock().toISOString(),
  });

/** Nguồn random chọn đúng nước `target` trong danh sách nước hợp lệ của `color` */
function randomPicking(board, color, target) {
  const legal = generateLegalMoves(board, color);
  const index = legal.findIndex((m) => sameMove(m, target));
  assert.ok(index >= 0, 'Nước mục tiêu phải hợp lệ');
  return () => (index + 0.5) / legal.length;
}

async function assertLocked(useCases, matchId) {
  await rejectsWith(useCases.submitPlayerMove(matchId, USER_ID, mv(0, 0, 1, 0)), ERROR_CODES.MATCH_FINISHED);
  const bot = await useCases.playBotTurn(matchId);
  assert.equal(bot.played, false);
  assert.equal(bot.reason, BOT_TURN_SKIP_REASON.MATCH_FINISHED);
  await rejectsWith(useCases.resignPveMatch(matchId, USER_ID), ERROR_CODES.MATCH_FINISHED);
}

describe('Kết thúc ván PvE theo từng điều kiện (COT-636)', () => {
  it('Chiếu bí: người chơi chiếu bí máy thì THẮNG, trận bị khoá', async () => {
    const { repo, clock, useCases } = setup();
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 0, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    const match = await createWithBoard(repo, clock, board, { playerColor: 'red', sideToMove: 'red' });
    clock.advance(5000);

    const { match: finished } = await useCases.submitPlayerMove(match.id, USER_ID, mv(7, 0, 7, 3));
    assert.equal(finished.status, 'FINISHED');
    assert.equal(finished.result, 'WIN');
    assert.equal(finished.endReason, 'CHECKMATE');
    assert.equal(finished.finishedAt.toISOString(), clock().toISOString());
    await assertLocked(useCases, match.id);
  });

  it('Chiếu bí: máy chiếu bí người chơi thì người chơi THUA', async () => {
    const board = createEmptyBoard();
    put(board, 9, 4, 'K', 'black');
    put(board, 2, 0, 'R', 'black');
    put(board, 0, 3, 'K', 'red');
    const { repo, clock, useCases } = setup(randomPicking(board, 'black', mv(2, 0, 2, 3)));
    const match = await createWithBoard(repo, clock, board, { playerColor: 'red', sideToMove: 'black' });

    const result = await useCases.playBotTurn(match.id);
    assert.equal(result.match.result, 'LOSS');
    assert.equal(result.match.endReason, 'CHECKMATE');
    await assertLocked(useCases, match.id);
  });

  it('Hết nước: người chơi làm máy hết nước thì THẮNG (NO_LEGAL_MOVES)', async () => {
    const { repo, clock, useCases } = setup();
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 0, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    const match = await createWithBoard(repo, clock, board, { playerColor: 'red', sideToMove: 'red' });

    const { match: finished, gameStatus } = await useCases.submitPlayerMove(match.id, USER_ID, mv(7, 0, 8, 0));
    assert.equal(gameStatus.status, 'NO_LEGAL_MOVES');
    assert.equal(finished.result, 'WIN');
    assert.equal(finished.endReason, 'NO_LEGAL_MOVES');
    await assertLocked(useCases, match.id);
  });

  it('Hết nước: máy làm người chơi hết nước thì người chơi THUA (NO_LEGAL_MOVES)', async () => {
    const board = createEmptyBoard();
    put(board, 9, 4, 'K', 'black');
    put(board, 2, 0, 'R', 'black');
    put(board, 0, 3, 'K', 'red');
    const { repo, clock, useCases } = setup(randomPicking(board, 'black', mv(2, 0, 1, 0)));
    const match = await createWithBoard(repo, clock, board, { playerColor: 'red', sideToMove: 'black' });

    const result = await useCases.playBotTurn(match.id);
    assert.equal(result.gameStatus.status, 'NO_LEGAL_MOVES');
    assert.equal(result.match.result, 'LOSS');
    assert.equal(result.match.endReason, 'NO_LEGAL_MOVES');
  });

  it('Đầu hàng ở lượt mình hoặc lượt máy: người chơi THUA (RESIGN), không đầu hàng lần hai được', async () => {
    const { useCases } = setup();
    const onMyTurn = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const resigned = await useCases.resignPveMatch(onMyTurn.id, USER_ID);
    assert.equal(resigned.status, 'FINISHED');
    assert.equal(resigned.result, 'LOSS');
    assert.equal(resigned.endReason, 'RESIGN');
    await assertLocked(useCases, onMyTurn.id);

    const onBotTurn = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    const resigned2 = await useCases.resignPveMatch(onBotTurn.id, USER_ID);
    assert.equal(resigned2.endReason, 'RESIGN');
    await assertLocked(useCases, onBotTurn.id);
  });

  it('Đầu hàng trận của người khác hoặc trận không tồn tại bị từ chối', async () => {
    const { repo, useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    await rejectsWith(useCases.resignPveMatch(match.id, OTHER_USER_ID), ERROR_CODES.NOT_MATCH_OWNER);
    await rejectsWith(useCases.resignPveMatch(999, USER_ID), ERROR_CODES.MATCH_NOT_FOUND);
    assert.equal((await repo.findById(match.id)).status, 'PLAYING');
  });
});

describe('Hết 60 giây cho một lượt của người chơi (COT-636)', () => {
  let repo;
  let clock;
  let useCases;

  beforeEach(() => {
    ({ repo, clock, useCases } = setup());
  });

  it('Chưa đủ 60 giây thì chưa thua; đủ 60 giây thì THUA do hết giờ, chỉ chốt một lần', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    clock.advance(PLAYER_TURN_LIMIT_MS - 1);
    const early = await useCases.checkPveTimeout(match.id);
    assert.equal(early.timedOut, false);
    assert.equal(early.remainingMs, 1);
    assert.equal(early.match.status, 'PLAYING');

    clock.advance(1);
    const late = await useCases.checkPveTimeout(match.id);
    assert.equal(late.timedOut, true);
    assert.equal(late.remainingMs, null);
    assert.equal(late.match.result, 'LOSS');
    assert.equal(late.match.endReason, 'TIMEOUT');

    clock.advance(10000);
    const again = await useCases.checkPveTimeout(match.id);
    assert.equal(again.timedOut, false, 'Gọi kết thúc lần hai không chốt lại');
    assert.equal(again.match.finishedAt.toISOString(), late.match.finishedAt.toISOString());
    await assertLocked(useCases, match.id);
  });

  it('checkPveTimeout nhận thời điểm `now` truyền vào', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    const now = new Date(match.turnStartedAt.getTime() + PLAYER_TURN_LIMIT_MS);
    const result = await useCases.checkPveTimeout(match.id, now);
    assert.equal(result.timedOut, true);
  });

  it('Nước đi tới sau 60 giây bị từ chối MATCH_FINISHED và trận bị xử thua do hết giờ', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    clock.advance(PLAYER_TURN_LIMIT_MS);
    await assert.rejects(useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 2, 4)), (err) => {
      assert.equal(err.code, ERROR_CODES.MATCH_FINISHED);
      assert.equal(err.details.endReason, 'TIMEOUT');
      return true;
    });
    const saved = await repo.findById(match.id);
    assert.equal(saved.result, 'LOSS');
    assert.equal(saved.endReason, 'TIMEOUT');
    assert.equal((await repo.listMoves(match.id)).length, 0);
  });

  it('Mỗi lượt có 60 giây riêng: đồng hồ đặt lại sau mỗi nước, lượt máy không tính giờ', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    clock.advance(5 * PLAYER_TURN_LIMIT_MS);
    const botTurn = await useCases.checkPveTimeout(match.id);
    assert.equal(botTurn.timedOut, false);
    assert.equal(botTurn.remainingMs, null);

    const bot = await useCases.playBotTurn(match.id);
    clock.advance(50000);
    assert.equal((await useCases.checkPveTimeout(match.id)).remainingMs, 10000);
    const reply = generateLegalMoves(bot.match.board, 'black')[0];
    await useCases.submitPlayerMove(match.id, USER_ID, reply);
    await useCases.playBotTurn(match.id);
    clock.advance(50000);
    const check = await useCases.checkPveTimeout(match.id);
    assert.equal(check.timedOut, false);
    assert.equal(check.match.status, 'PLAYING');
  });

  it('Xử thua hết giờ dựa trên trạng thái cũ không ghi đè khi người chơi đã kịp đi', async () => {
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    await useCases.submitPlayerMove(match.id, USER_ID, mv(2, 1, 2, 4));
    const stale = await useCases.finishPveMatch(match.id, {
      result: 'LOSS',
      endReason: 'TIMEOUT',
      expectedPly: 0,
    });
    assert.equal(stale.finished, false);
    assert.equal(stale.match.status, 'PLAYING');
  });
});

describe('Chốt kết quả đúng một lần (COT-636)', () => {
  it('Đầu hàng sau khi đã chiếu bí không ghi đè kết quả THẮNG', async () => {
    const { repo, clock, useCases } = setup();
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 0, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    const match = await createWithBoard(repo, clock, board, { playerColor: 'red', sideToMove: 'red' });
    await useCases.submitPlayerMove(match.id, USER_ID, mv(7, 0, 7, 3));
    await rejectsWith(useCases.resignPveMatch(match.id, USER_ID), ERROR_CODES.MATCH_FINISHED);
    const again = await useCases.finishPveMatch(match.id, { result: 'LOSS', endReason: 'TIMEOUT' });
    assert.equal(again.finished, false);
    assert.equal(again.match.result, 'WIN');
    assert.equal(again.match.endReason, 'CHECKMATE');
  });

  it('Kết quả hoặc lý do kết thúc không hợp lệ bị từ chối', async () => {
    const { useCases } = setup();
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    await rejectsWith(
      useCases.finishPveMatch(match.id, { result: 'DRAW', endReason: 'RESIGN' }),
      ERROR_CODES.INVALID_INPUT
    );
  });
});

describe('Lịch sử đấu PvE và xem lại trận (COT-636)', () => {
  it('Chỉ liệt kê trận đã kết thúc của chính người chơi, mới nhất trước, có phân trang', async () => {
    const { clock, useCases } = setup();
    const first = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    clock.advance(1000);
    const second = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'black' });
    clock.advance(1000);
    await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' }); // đang chơi
    const others = await useCases.createPveMatch({ userId: OTHER_USER_ID, playerColor: 'red' });
    await useCases.resignPveMatch(first.id, USER_ID);
    await useCases.resignPveMatch(second.id, USER_ID);
    await useCases.resignPveMatch(others.id, OTHER_USER_ID);

    const history = await useCases.listPlayerPveHistory(USER_ID);
    assert.deepEqual(
      history.map((m) => m.id),
      [second.id, first.id]
    );
    assert.ok(history.every((m) => m.status === 'FINISHED' && m.result === 'LOSS'));
    assert.ok(history.every((m) => m.board === undefined), 'Danh sách lịch sử không kèm bàn cờ');

    const page = await useCases.listPlayerPveHistory(USER_ID, { limit: 1, offset: 1 });
    assert.deepEqual(
      page.map((m) => m.id),
      [first.id]
    );
    await rejectsWith(useCases.listPlayerPveHistory(USER_ID, { limit: 0.5 }), ERROR_CODES.INVALID_INPUT);
    await rejectsWith(useCases.listPlayerPveHistory(USER_ID, { limit: 1000 }), ERROR_CODES.INVALID_INPUT);
  });

  it('Xem lại trận: đủ nước đi theo thứ tự, dựng lại từ thế ban đầu ra đúng bàn cờ cuối', async () => {
    const { useCases } = setup(seededRandom(11));
    const playerRandom = seededRandom(99);
    const match = await useCases.createPveMatch({ userId: USER_ID, playerColor: 'red' });
    for (let i = 0; i < 6; i++) {
      const current = (await useCases.getPveMatchReplay(match.id, USER_ID)).match;
      if (current.status !== 'PLAYING') break;
      const legal = generateLegalMoves(current.board, 'red');
      await useCases.submitPlayerMove(match.id, USER_ID, legal[Math.floor(playerRandom() * legal.length)]);
      await useCases.playBotTurn(match.id);
    }
    await useCases.resignPveMatch(match.id, USER_ID);

    const replay = await useCases.getPveMatchReplay(match.id, USER_ID);
    assert.equal(replay.match.status, 'FINISHED');
    assert.equal(replay.moves.length, replay.match.ply);
    let board = createInitialBoard();
    replay.moves.forEach((m, i) => {
      assert.equal(m.ply, i + 1);
      assert.equal(m.actor, m.side === 'red' ? 'PLAYER' : 'BOT');
      board = applyMove(board, m).board;
    });
    assert.deepEqual(board, replay.match.board);

    await rejectsWith(useCases.getPveMatchReplay(match.id, OTHER_USER_ID), ERROR_CODES.NOT_MATCH_OWNER);
  });
});
