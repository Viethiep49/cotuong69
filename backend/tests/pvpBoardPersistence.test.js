require('./helpers/testEnv');
/**
 * Bàn cờ PvP trước đây chỉ nằm trong RAM (room.matchState.board) -> server restart là mất.
 * Giờ: bắt đầu ván, mỗi nước đi và lúc kết thúc đều ghi xuống pvp_match_states / pvp_moves.
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_CLIENT = 'sqlite';

const db = require('../src/config/db');
const { runMigrations } = require('../src/migrations/migrate');
const PgPvpMatchRepository = require('../src/infrastructure/database/repositories/PgPvpMatchRepository');
const { makeHub, send, sleep, playingRoom } = require('./helpers/hubHarness');

describe('Lưu bàn cờ PvP xuống DB', () => {
  let repo;

  before(async () => {
    db.initSqlite(new DatabaseSync(':memory:'));
    await runMigrations();
    repo = new PgPvpMatchRepository({ db });
  });

  after(async () => {
    await db.closePool();
  });

  test('bắt đầu ván -> có snapshot PLAYING với bàn cờ ban đầu', async () => {
    const { hub, roomManager } = makeHub({ pvpMatchRepository: repo });
    const { room } = await playingRoom(hub, roomManager);
    await hub.flushPvpPersistence(room.code);

    const state = await repo.findLiveState(room.matchId);
    assert.ok(state, 'phải có snapshot');
    assert.equal(state.status, 'PLAYING');
    assert.equal(state.ply, 0);
    assert.equal(state.currentTurn, 'red');
    assert.equal(state.board.length, 32);
    assert.equal(state.redUserId, 1);
    assert.equal(state.blackUserId, 2);
    hub.close();
  });

  test('mỗi nước đi ghi pvp_moves + cập nhật snapshot, kết thúc ván -> FINISHED', async () => {
    const { hub, roomManager } = makeHub({ pvpMatchRepository: repo });
    const { room, r, b } = await playingRoom(hub, roomManager);
    const matchId = room.matchId;

    send(r, { type: 'move', from: 'b2', to: 'b9' }); // Pháo Đỏ ăn Mã Đen (ngòi là Pháo Đen b7)
    await sleep(10);
    send(b, { type: 'move', from: 'a6', to: 'a5' });
    await sleep(10);
    await hub.flushPvpPersistence(room.code);

    const moves = await repo.findMoves(matchId);
    assert.equal(moves.length, 2);
    assert.deepEqual(
      { ply: moves[0].ply, side: moves[0].side, pieceType: moves[0].pieceType, from: moves[0].from, to: moves[0].to, capturedType: moves[0].capturedType },
      { ply: 1, side: 'red', pieceType: 'cannon', from: 'b2', to: 'b9', capturedType: 'horse' },
    );
    assert.equal(moves[1].side, 'black');
    assert.equal(moves[1].capturedType, null);

    const live = await repo.findLiveState(matchId);
    assert.equal(live.ply, 2);
    assert.equal(live.currentTurn, 'red');
    assert.deepEqual(live.board, room.matchState.board, 'snapshot phải khớp bàn cờ trong RAM');
    assert.equal(live.capturedPieces.black.length, 1);

    send(b, { type: 'resign' });
    await sleep(10);
    await hub.flushPvpPersistence(room.code);

    const finished = await repo.findLiveState(matchId);
    assert.equal(finished.status, 'FINISHED');
    assert.equal(finished.endReason, 'RESIGN');
    hub.close();
  });

  test('nước đi bị từ chối thì không ghi gì', async () => {
    const { hub, roomManager } = makeHub({ pvpMatchRepository: repo });
    const { room, r } = await playingRoom(hub, roomManager);
    send(r, { type: 'move', from: 'a3', to: 'a5' }); // Tốt đi 2 ô: sai luật
    await sleep(10);
    await hub.flushPvpPersistence(room.code);

    assert.equal((await repo.findMoves(room.matchId)).length, 0);
    assert.equal((await repo.findLiveState(room.matchId)).ply, 0);
    hub.close();
  });

  test('ghi lại cùng ply (retry) không tạo nước đi trùng', async () => {
    const state = {
      matchId: 'MATCH_RETRY', roomCode: '999999', board: [], currentTurn: 'black', ply: 1,
    };
    const move = { matchId: 'MATCH_RETRY', ply: 1, side: 'red', pieceType: 'soldier', from: 'a3', to: 'a4' };
    await repo.recordMove(move, state);
    await repo.recordMove(move, state);
    assert.equal((await repo.findMoves('MATCH_RETRY')).length, 1);
  });

  test('abortUnfinished: ván PLAYING bỏ dở -> ABORTED, ván đã xong giữ nguyên', async () => {
    const base = { roomCode: '888888', board: [], currentTurn: 'red' };
    await repo.saveLiveState({ ...base, matchId: 'MATCH_ORPHAN', status: 'PLAYING' });
    await repo.saveLiveState({ ...base, matchId: 'MATCH_DONE', status: 'FINISHED', endReason: 'CHECKMATE' });

    const count = await repo.abortUnfinished();
    assert.ok(count >= 1);

    const orphan = await repo.findLiveState('MATCH_ORPHAN');
    assert.equal(orphan.status, 'ABORTED');
    assert.equal(orphan.endReason, 'SERVER_RESTART');
    const done = await repo.findLiveState('MATCH_DONE');
    assert.equal(done.status, 'FINISHED');
    assert.equal(done.endReason, 'CHECKMATE');
  });

  test('repository cũ không có saveLiveState/recordMove -> hub vẫn chạy bình thường', async () => {
    const { hub, roomManager } = makeHub(); // mock chỉ có create()
    const { room, r } = await playingRoom(hub, roomManager);
    send(r, { type: 'move', from: 'a3', to: 'a4' });
    await sleep(10);
    assert.equal(room.matchState.currentTurn, 'black');
    hub.close();
  });
});
