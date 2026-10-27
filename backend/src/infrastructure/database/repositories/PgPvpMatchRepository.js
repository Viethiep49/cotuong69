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
   *          winnerColor?:string|null, endReason:string, winnerEloChange?:number, loserEloChange?:number}} record
   */
  async create(record) {
    if (!record || !record.roomCode || !record.endReason) {
      throw new Error('Thiếu dữ liệu kết quả trận đấu.');
    }

    const res = await this.db.query(
      `INSERT INTO pvp_matches
         (match_id, room_code, winner_user_id, loser_user_id, winner_color, end_reason,
          winner_elo_change, loser_elo_change)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      ],
    );
    return res.rows && res.rows[0] ? Number(res.rows[0].id) : null;
  }

  async findByRoom(roomCode) {
    const res = await this.db.query(
      `SELECT id, match_id, room_code, winner_user_id, loser_user_id, winner_color,
              end_reason, winner_elo_change, loser_elo_change, finished_at
       FROM pvp_matches WHERE room_code = $1 ORDER BY id DESC`,
      [String(roomCode)],
    );
    return res.rows || [];
  }
}

module.exports = PgPvpMatchRepository;
