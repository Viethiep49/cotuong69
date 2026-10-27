require('./helpers/testEnv.js');
/**
 * COT-634: PgPveMatchRepository chạy trên SQLite in-memory (giống db.test.js)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const { createInitialBoard } = require('../src/domain/rules/board');
const { PgPveMatchRepository } = require('../src/infrastructure/database/repositories/PgPveMatchRepository');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { ERROR_CODES } = require('../src/core/errors/AppError');
const { mv, createFakeClock, snapshot, assertUnchanged } = require('./helpers/pveFixtures');

const NOW = '2026-01-01T00:00:00.000Z';

describe('PgPveMatchRepository trên SQLite in-memory (COT-634)', () => {
  let repo;
  let userId;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    await db.query('INSERT INTO users (username, display_name, email) VALUES ($1, $2, $3)', [
      'pve_player',
      'Kỳ Thủ PvE',
      'pve@cotuong.vn',
    ]);
    const res = await db.query('SELECT id FROM users WHERE username = $1', ['pve_player']);
    userId = res.rows[0].id;
    repo = new PgPveMatchRepository({ db });
  });

  after(async () => {
    await db.closePool();
  });

  const newMatch = () =>
    repo.create({
      userId,
      playerColor: 'red',
      botColor: 'black',
      board: createInitialBoard(),
      sideToMove: 'red',
      now: NOW,
    });

  it('Tạo trận và đọc lại đúng các trường, bàn cờ lưu dạng JSON', async () => {
    const match = await newMatch();
    assert.ok(Number.isInteger(match.id));
    assert.equal(match.userId, userId);
    assert.equal(match.playerColor, 'red');
    assert.equal(match.botColor, 'black');
    assert.equal(match.sideToMove, 'red');
    assert.equal(match.status, 'PLAYING');
    assert.equal(match.result, null);
    assert.equal(match.endReason, null);
    assert.equal(match.ply, 0);
    assert.deepEqual(match.board, createInitialBoard());
    assert.equal(match.createdAt.toISOString(), NOW);
    assert.equal(match.finishedAt, null);
    assert.equal(await repo.findById(match.id + 1000), null);
  });

  it('saveMove đúng ply: cập nhật bàn cờ, lượt, ply và ghi pve_moves', async () => {
    const match = await newMatch();
    const board = createInitialBoard();
    board[2][4] = board[2][1];
    board[2][1] = null;
    const ok = await repo.saveMove({
      matchId: match.id,
      expectedPly: 0,
      board,
      sideToMove: 'black',
      move: { side: 'red', actor: 'PLAYER', pieceType: 'C', from: { row: 2, col: 1 }, to: { row: 2, col: 4 }, capturedType: null },
      now: '2026-01-01T00:00:05.000Z',
    });
    assert.equal(ok, true);

    const saved = await repo.findById(match.id);
    assert.equal(saved.ply, 1);
    assert.equal(saved.sideToMove, 'black');
    assert.deepEqual(saved.board, board);
    assert.equal(saved.updatedAt.toISOString(), '2026-01-01T00:00:05.000Z');

    const moves = await repo.listMoves(match.id);
    assert.deepEqual(moves, [
      {
        ply: 1,
        side: 'red',
        actor: 'PLAYER',
        pieceType: 'C',
        from: { row: 2, col: 1 },
        to: { row: 2, col: 4 },
        capturedType: null,
        createdAt: new Date('2026-01-01T00:00:05.000Z'),
      },
    ]);
  });

  it('saveMove sai ply hoặc trận không còn PLAYING thì không ghi gì', async () => {
    const match = await newMatch();
    const before = await snapshot(repo, match.id);
    const attempt = (expectedPly) =>
      repo.saveMove({
        matchId: match.id,
        expectedPly,
        board: createInitialBoard(),
        sideToMove: 'black',
        move: { side: 'red', actor: 'PLAYER', pieceType: 'C', from: { row: 2, col: 1 }, to: { row: 2, col: 4 }, capturedType: null },
        now: NOW,
      });
    assert.equal(await attempt(3), false);
    await assertUnchanged(repo, match.id, before);

    await db.query("UPDATE pve_matches SET status = 'FINISHED' WHERE id = $1", [match.id]);
    assert.equal(await attempt(0), false);
    const after = await repo.listMoves(match.id);
    assert.equal(after.length, 0);
  });

  it('finish chỉ chốt kết quả khi trận còn PLAYING, lần sau không ghi đè (COT-635)', async () => {
    const match = await newMatch();
    const first = await repo.finish({
      matchId: match.id,
      result: 'WIN',
      endReason: 'CHECKMATE',
      now: '2026-01-01T00:10:00.000Z',
    });
    assert.equal(first, true);
    const second = await repo.finish({
      matchId: match.id,
      result: 'LOSS',
      endReason: 'RESIGN',
      now: '2026-01-01T00:20:00.000Z',
    });
    assert.equal(second, false);

    const saved = await repo.findById(match.id);
    assert.equal(saved.status, 'FINISHED');
    assert.equal(saved.result, 'WIN');
    assert.equal(saved.endReason, 'CHECKMATE');
    assert.equal(saved.finishedAt.toISOString(), '2026-01-01T00:10:00.000Z');
  });

  it('Lượt máy với repository Pg: đi đúng một nước hợp lệ, gọi lặp không đi thêm (COT-635)', async () => {
    const useCases = createPveUseCases({
      pveMatchRepository: repo,
      clock: createFakeClock(),
      random: () => 0.5,
    });
    const match = await useCases.createPveMatch({ userId, playerColor: 'black' });
    const first = await useCases.playBotTurn(match.id, { expectedPly: 0 });
    assert.equal(first.played, true);
    const again = await useCases.playBotTurn(match.id, { expectedPly: 0 });
    assert.equal(again.played, false);
    const moves = await repo.listMoves(match.id);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].actor, 'BOT');
    assert.equal(moves[0].side, 'red');
    const saved = await repo.findById(match.id);
    assert.equal(saved.ply, 1);
    assert.equal(saved.sideToMove, 'black');
  });

  it('turnStartedAt được đặt khi tạo trận và đặt lại sau mỗi nước đi (COT-636)', async () => {
    const match = await newMatch();
    assert.equal(match.turnStartedAt.toISOString(), NOW);
    await repo.saveMove({
      matchId: match.id,
      expectedPly: 0,
      board: createInitialBoard(),
      sideToMove: 'black',
      move: { side: 'red', actor: 'PLAYER', pieceType: 'C', from: { row: 2, col: 1 }, to: { row: 2, col: 4 }, capturedType: null },
      now: '2026-01-01T00:00:42.000Z',
    });
    const saved = await repo.findById(match.id);
    assert.equal(saved.turnStartedAt.toISOString(), '2026-01-01T00:00:42.000Z');
  });

  it('finish kèm expectedPly không chốt khi ply đã thay đổi (COT-636)', async () => {
    const match = await newMatch();
    const stale = await repo.finish({
      matchId: match.id,
      result: 'LOSS',
      endReason: 'TIMEOUT',
      now: NOW,
      expectedPly: 5,
    });
    assert.equal(stale, false);
    assert.equal((await repo.findById(match.id)).status, 'PLAYING');
    const ok = await repo.finish({ matchId: match.id, result: 'LOSS', endReason: 'TIMEOUT', now: NOW, expectedPly: 0 });
    assert.equal(ok, true);
  });

  it('listByUser lọc theo người chơi và trạng thái, mới nhất trước, có phân trang (COT-636)', async () => {
    await db.query('INSERT INTO users (username, display_name, email) VALUES ($1, $2, $3)', [
      'pve_history',
      'Lịch Sử',
      'pve_history@cotuong.vn',
    ]);
    const owner = (await db.query('SELECT id FROM users WHERE username = $1', ['pve_history'])).rows[0].id;
    const ids = [];
    for (const [i, status] of ['FINISHED', 'PLAYING', 'FINISHED'].entries()) {
      const created = await repo.create({
        userId: owner,
        playerColor: 'red',
        botColor: 'black',
        board: createInitialBoard(),
        sideToMove: 'red',
        now: `2026-02-0${i + 1}T00:00:00.000Z`,
      });
      if (status === 'FINISHED') {
        await repo.finish({ matchId: created.id, result: 'WIN', endReason: 'RESIGN', now: NOW });
      }
      ids.push(created.id);
    }

    const finished = await repo.listByUser(owner, { status: 'FINISHED' });
    assert.deepEqual(
      finished.map((m) => m.id),
      [ids[2], ids[0]]
    );
    assert.equal(finished[0].board, undefined);
    assert.equal(finished[0].result, 'WIN');
    const all = await repo.listByUser(owner);
    assert.deepEqual(
      all.map((m) => m.id),
      [ids[2], ids[1], ids[0]]
    );
    const page = await repo.listByUser(owner, { limit: 1, offset: 1 });
    assert.deepEqual(
      page.map((m) => m.id),
      [ids[1]]
    );
  });

  it('Use-case submitPlayerMove dùng repository Pg: nước hợp lệ được lưu, nước sai không đổi CSDL', async () => {
    const useCases = createPveUseCases({ pveMatchRepository: repo, clock: createFakeClock() });
    const match = await useCases.createPveMatch({ userId, playerColor: 'red' });

    const before = await snapshot(repo, match.id);
    await assert.rejects(
      useCases.submitPlayerMove(match.id, userId, mv(0, 0, 5, 0)),
      (err) => err.code === ERROR_CODES.ILLEGAL_MOVE
    );
    await assertUnchanged(repo, match.id, before);

    await useCases.submitPlayerMove(match.id, userId, mv(2, 1, 9, 1));
    const saved = await repo.findById(match.id);
    assert.equal(saved.ply, 1);
    assert.equal(saved.sideToMove, 'black');
    const moves = await repo.listMoves(match.id);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].capturedType, 'H');
  });
});
