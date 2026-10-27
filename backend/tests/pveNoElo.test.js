require('./helpers/testEnv.js');
/**
 * COT-636: Trận PvE KHÔNG cập nhật Elo.
 * Chạy toàn bộ luồng PvE trên PgPveMatchRepository + SQLite in-memory (giống db.test.js) và khẳng định
 * users.elo_rating giữ nguyên sau khi thắng, thua, đầu hàng, hết giờ; đồng thời ghi lại mọi câu SQL
 * mà luồng PvE thực thi để chắc chắn không có câu nào chạm tới bảng users / cột elo_rating.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const { createEmptyBoard } = require('../src/domain/rules/board');
const { generateLegalMoves } = require('../src/domain/rules/moveGenerator');
const { PgPveMatchRepository } = require('../src/infrastructure/database/repositories/PgPveMatchRepository');
const { createPveUseCases } = require('../src/application/use-cases/game/pve');
const { PLAYER_TURN_LIMIT_MS } = require('../src/domain/entities/PveMatch');
const { put, mv, createFakeClock } = require('./helpers/pveFixtures');

const STARTING_ELO = 1234;

/** Bọc db để ghi lại mọi câu SQL được thực thi */
function createRecordingDb(executed) {
  return {
    query: (text, params) => {
      executed.push(text);
      return db.query(text, params);
    },
    getClient: async () => {
      const client = await db.getClient();
      return {
        query: (text, params) => {
          executed.push(text);
          return client.query(text, params);
        },
        release: () => client.release(),
      };
    },
  };
}

describe('Trận PvE không cập nhật Elo (COT-636)', () => {
  let userId;
  let executed;
  let repo;
  let clock;

  const eloOf = async () => {
    const res = await db.query('SELECT elo_rating FROM users WHERE id = $1', [userId]);
    return res.rows[0].elo_rating;
  };

  const useCasesWith = (random = () => 0) =>
    createPveUseCases({ pveMatchRepository: repo, clock, random });

  const createWithBoard = (board, { playerColor, sideToMove }) =>
    repo.create({
      userId,
      playerColor,
      botColor: playerColor === 'red' ? 'black' : 'red',
      board,
      sideToMove,
      now: clock().toISOString(),
    });

  const assertEloUntouched = async () => {
    assert.equal(await eloOf(), STARTING_ELO, 'elo_rating phải giữ nguyên');
    const touching = executed.filter((sql) => /\busers\b|elo/i.test(sql));
    assert.deepEqual(touching, [], 'Luồng PvE không được truy vấn bảng users / cột elo_rating');
  };

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    await db.query('INSERT INTO users (username, display_name, email, elo_rating) VALUES ($1, $2, $3, $4)', [
      'pve_elo_player',
      'Kỳ Thủ PvE',
      'pve_elo@cotuong.vn',
      STARTING_ELO,
    ]);
    const res = await db.query('SELECT id FROM users WHERE username = $1', ['pve_elo_player']);
    userId = res.rows[0].id;
  });

  after(async () => {
    await db.closePool();
  });

  beforeEach(() => {
    executed = [];
    repo = new PgPveMatchRepository({ db: createRecordingDb(executed) });
    clock = createFakeClock();
  });

  it('Thắng (chiếu bí máy): Elo giữ nguyên', async () => {
    const board = createEmptyBoard();
    put(board, 0, 4, 'K', 'red');
    put(board, 7, 0, 'R', 'red');
    put(board, 9, 3, 'K', 'black');
    const match = await createWithBoard(board, { playerColor: 'red', sideToMove: 'red' });
    const { match: finished } = await useCasesWith().submitPlayerMove(match.id, userId, mv(7, 0, 7, 3));
    assert.equal(finished.result, 'WIN');
    assert.equal(finished.endReason, 'CHECKMATE');
    await assertEloUntouched();
  });

  it('Thua (máy chiếu bí): Elo giữ nguyên', async () => {
    const board = createEmptyBoard();
    put(board, 9, 4, 'K', 'black');
    put(board, 2, 0, 'R', 'black');
    put(board, 0, 3, 'K', 'red');
    const legal = generateLegalMoves(board, 'black');
    const index = legal.findIndex((m) => m.from.row === 2 && m.from.col === 0 && m.to.row === 2 && m.to.col === 3);
    const match = await createWithBoard(board, { playerColor: 'red', sideToMove: 'black' });
    const result = await useCasesWith(() => (index + 0.5) / legal.length).playBotTurn(match.id);
    assert.equal(result.match.result, 'LOSS');
    assert.equal(result.match.endReason, 'CHECKMATE');
    await assertEloUntouched();
  });

  it('Đầu hàng: Elo giữ nguyên', async () => {
    const useCases = useCasesWith();
    const match = await useCases.createPveMatch({ userId, playerColor: 'red' });
    await useCases.submitPlayerMove(match.id, userId, mv(2, 1, 2, 4));
    await useCases.playBotTurn(match.id);
    const resigned = await useCases.resignPveMatch(match.id, userId);
    assert.equal(resigned.result, 'LOSS');
    assert.equal(resigned.endReason, 'RESIGN');
    await assertEloUntouched();
  });

  it('Hết giờ: Elo giữ nguyên', async () => {
    const useCases = useCasesWith();
    const match = await useCases.createPveMatch({ userId, playerColor: 'red' });
    clock.advance(PLAYER_TURN_LIMIT_MS);
    const result = await useCases.checkPveTimeout(match.id);
    assert.equal(result.timedOut, true);
    assert.equal(result.match.result, 'LOSS');
    assert.equal(result.match.endReason, 'TIMEOUT');
    await assertEloUntouched();
  });

  it('Mã nguồn luồng PvE không tham chiếu tới Elo', () => {
    const files = [
      ...fs
        .readdirSync(path.join(__dirname, '../src/application/use-cases/game/pve'))
        .map((f) => path.join(__dirname, '../src/application/use-cases/game/pve', f)),
      path.join(__dirname, '../src/infrastructure/database/repositories/PgPveMatchRepository.js'),
    ];
    for (const file of files) {
      const code = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(code, /elo/i, `${path.basename(file)} không được tham chiếu Elo`);
    }
  });
});
