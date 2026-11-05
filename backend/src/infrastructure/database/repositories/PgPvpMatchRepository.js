const defaultDb = require('../../../config/db');

/**
 * BE-18: lưu kết quả trận PvP vào PostgreSQL (trước đây chỉ nằm trong RAM).
 */
class PgPvpMatchRepository {
  constructor({ db = defaultDb } = {}) {
    this.db = db;
  }

  /**
   * @param {{matchId?:string, roomCode:string, winnerUserId?:number|null, loserUserId?:number|null,
   *          redUserId?:number|null, blackUserId?:number|null, winnerColor?:string|null, endReason:string, winnerEloChange?:number, loserEloChange?:number}} record
   */
  async create(record) {
    if (!record || !record.roomCode || !record.endReason) {
      throw new Error('Thiếu dữ liệu kết quả trận đấu.');
    }

    const res = await this.db.query(
      `INSERT INTO pvp_matches
         (match_id, room_code, winner_user_id, loser_user_id, winner_color, end_reason,
          winner_elo_change, loser_elo_change, red_user_id, black_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        record.matchId || null,
        String(record.roomCode),
        record.winnerUserId === undefined ? null : record.winnerUserId,
        record.loserUserId === undefined ? null : record.loserUserId,
        record.winnerColor || null,
        String(record.endReason),
        Number(record.winnerEloChange) || 0,
        Number(record.loserEloChange) || 0,
        // REV2-06: luôn lưu cả hai người chơi (kể cả ván hoà / huỷ không có thắng thua)
        record.redUserId === undefined ? null : record.redUserId,
        record.blackUserId === undefined ? null : record.blackUserId,
      ],
    );
    return res.rows && res.rows[0] ? Number(res.rows[0].id) : null;
  }

  async findByRoom(roomCode) {
    const res = await this.db.query(
      `SELECT id, match_id, room_code, winner_user_id, loser_user_id, winner_color,
              end_reason, winner_elo_change, loser_elo_change, red_user_id, black_user_id, finished_at
       FROM pvp_matches WHERE room_code = $1 ORDER BY id DESC`,
      [String(roomCode)],
    );
    return res.rows || [];
  }

  /**
   * Lưu (hoặc ghi đè) snapshot thế cờ mới nhất của một ván PvP.
   * Trước đây bàn cờ chỉ nằm trong RAM -> server restart là mất.
   * @param {{matchId:string, roomCode:string, redUserId?:number|null, blackUserId?:number|null,
   *          status?:'PLAYING'|'FINISHED'|'ABORTED', board:Array<object>, currentTurn:'red'|'black',
   *          ply?:number, remainingClocks?:object|null, capturedPieces?:object|null, endReason?:string|null}} state
   * @param {{query:Function}} [executor] client đang trong transaction (mặc định this.db)
   */
  async saveLiveState(state, executor = this.db) {
    if (!state || !state.matchId || !state.roomCode || !Array.isArray(state.board)) {
      throw new Error('Thiếu dữ liệu snapshot trận PvP.');
    }
    await executor.query(
      `INSERT INTO pvp_match_states
         (match_id, room_code, red_user_id, black_user_id, status, board_state, current_turn,
          ply, remaining_clocks, captured_pieces, end_reason, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
       ON CONFLICT (match_id) DO UPDATE SET
         status = excluded.status,
         board_state = excluded.board_state,
         current_turn = excluded.current_turn,
         ply = excluded.ply,
         remaining_clocks = excluded.remaining_clocks,
         captured_pieces = excluded.captured_pieces,
         end_reason = excluded.end_reason,
         updated_at = excluded.updated_at`,
      [
        String(state.matchId),
        String(state.roomCode),
        state.redUserId ?? null,
        state.blackUserId ?? null,
        state.status || 'PLAYING',
        JSON.stringify(state.board),
        state.currentTurn,
        Number(state.ply) || 0,
        state.remainingClocks ? JSON.stringify(state.remainingClocks) : null,
        state.capturedPieces ? JSON.stringify(state.capturedPieces) : null,
        state.endReason || null,
      ],
    );
  }

  /**
   * Ghi 1 nước đi + snapshot sau nước đó trong CÙNG 1 transaction để hai bảng luôn khớp.
   * Ghi lại cùng ply (retry) thì bỏ qua nước đi, chỉ cập nhật snapshot.
   * @param {{matchId:string, ply:number, side:'red'|'black', pieceType:string,
   *          from:string, to:string, capturedType?:string|null}} move
   * @param {Parameters<PgPvpMatchRepository['saveLiveState']>[0]} state
   */
  async recordMove(move, state) {
    if (!move || !move.matchId || !Number.isInteger(move.ply) || move.ply < 1) {
      throw new Error('Thiếu dữ liệu nước đi PvP.');
    }
    const client = typeof this.db.getClient === 'function' ? await this.db.getClient() : null;
    const executor = client || this.db;
    try {
      if (client) await client.query('BEGIN');
      // snapshot trước để khoá ngoại pvp_moves -> pvp_match_states luôn hợp lệ
      await this.saveLiveState(state, executor);
      await executor.query(
        `INSERT INTO pvp_moves (match_id, ply, side, piece_type, from_pos, to_pos, captured_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (match_id, ply) DO NOTHING`,
        [
          String(move.matchId),
          move.ply,
          move.side,
          String(move.pieceType),
          String(move.from),
          String(move.to),
          move.capturedType || null,
        ],
      );
      if (client) await client.query('COMMIT');
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // giữ lỗi gốc
        }
      }
      throw err;
    } finally {
      if (client) client.release();
    }
  }

  /** Snapshot mới nhất của ván (bàn cờ đã parse JSON), null nếu chưa có. */
  async findLiveState(matchId) {
    const res = await this.db.query(
      `SELECT match_id, room_code, red_user_id, black_user_id, status, board_state, current_turn,
              ply, remaining_clocks, captured_pieces, end_reason, started_at, updated_at
       FROM pvp_match_states WHERE match_id = $1`,
      [String(matchId)],
    );
    const row = res.rows && res.rows[0];
    if (!row) return null;
    return {
      matchId: row.match_id,
      roomCode: row.room_code,
      redUserId: row.red_user_id === null ? null : Number(row.red_user_id),
      blackUserId: row.black_user_id === null ? null : Number(row.black_user_id),
      status: row.status,
      board: JSON.parse(row.board_state),
      currentTurn: row.current_turn,
      ply: Number(row.ply),
      remainingClocks: row.remaining_clocks ? JSON.parse(row.remaining_clocks) : null,
      capturedPieces: row.captured_pieces ? JSON.parse(row.captured_pieces) : null,
      endReason: row.end_reason || null,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    };
  }

  /** Lịch sử nước đi của ván theo thứ tự ply. */
  async findMoves(matchId) {
    const res = await this.db.query(
      `SELECT ply, side, piece_type, from_pos, to_pos, captured_type, created_at
       FROM pvp_moves WHERE match_id = $1 ORDER BY ply ASC`,
      [String(matchId)],
    );
    return (res.rows || []).map((row) => ({
      ply: Number(row.ply),
      side: row.side,
      pieceType: row.piece_type,
      from: row.from_pos,
      to: row.to_pos,
      capturedType: row.captured_type || null,
      createdAt: row.created_at,
    }));
  }

  /**
   * Gọi lúc server khởi động: ván còn PLAYING là ván bị bỏ dở do server tắt
   * (phòng chỉ sống trong RAM nên không khôi phục được) -> đánh dấu ABORTED, không tính Elo.
   * Chỉ đúng khi chạy 1 instance (RoomManager hiện cũng chỉ hỗ trợ 1 instance).
   * @returns {Promise<number>} số ván bị huỷ
   */
  async abortUnfinished() {
    const res = await this.db.query(
      `UPDATE pvp_match_states
         SET status = 'ABORTED', end_reason = 'SERVER_RESTART', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'PLAYING'
       RETURNING match_id`,
    );
    return res.rows ? res.rows.length : 0;
  }
}

module.exports = PgPvpMatchRepository;
