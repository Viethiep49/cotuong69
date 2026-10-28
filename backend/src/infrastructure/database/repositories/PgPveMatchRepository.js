/**
 * Hiện thực IPveMatchRepository trên PostgreSQL (qua config/db.js, chạy được cả lớp SQLite khi test).
 *
 * Lưu ý tương thích lớp SQLite của db.js: tham số $n được đổi thành `?` theo thứ tự xuất hiện,
 * nên mỗi câu SQL dùng mỗi tham số đúng một lần và theo thứ tự tăng dần.
 */
const defaultDb = require('../../../config/db');

const SUMMARY_COLUMNS = `id, user_id, player_color, bot_color, side_to_move, status,
  result, end_reason, ply, created_at, updated_at, finished_at, turn_started_at`;
const MATCH_COLUMNS = `${SUMMARY_COLUMNS}, board_state`;

function toDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function toMatchSummary(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    playerColor: row.player_color,
    botColor: row.bot_color,
    sideToMove: row.side_to_move,
    status: row.status,
    result: row.result || null,
    endReason: row.end_reason || null,
    ply: Number(row.ply),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    finishedAt: toDate(row.finished_at),
    // Dòng tạo trước migration 003 không có turn_started_at: coi như lượt bắt đầu ở lần cập nhật cuối
    turnStartedAt: toDate(row.turn_started_at) || toDate(row.updated_at),
  };
}

function toMatch(row) {
  return { ...toMatchSummary(row), board: JSON.parse(row.board_state) };
}

function toMoveRecord(row) {
  return {
    ply: Number(row.ply),
    side: row.side,
    actor: row.actor,
    pieceType: row.piece_type,
    from: { row: Number(row.from_row), col: Number(row.from_col) },
    to: { row: Number(row.to_row), col: Number(row.to_col) },
    capturedType: row.captured_type || null,
    createdAt: toDate(row.created_at),
  };
}

class PgPveMatchRepository {
  /**
   * @param {{ db?: { query: Function, getClient: Function } }} [deps]
   */
  constructor({ db = defaultDb } = {}) {
    this.db = db;
  }

  async create({ userId, playerColor, botColor, board, sideToMove, now }) {
    const res = await this.db.query(
      `INSERT INTO pve_matches
         (user_id, player_color, bot_color, board_state, side_to_move, status, ply,
          created_at, updated_at, turn_started_at)
       VALUES ($1, $2, $3, $4, $5, 'PLAYING', 0, $6, $7, $8)
       RETURNING id`,
      [userId, playerColor, botColor, JSON.stringify(board), sideToMove, now, now, now]
    );
    const id = res.rows && res.rows[0] ? res.rows[0].id : res.lastInsertRowid;
    return this.findById(Number(id));
  }

  async findById(matchId) {
    const res = await this.db.query(`SELECT ${MATCH_COLUMNS} FROM pve_matches WHERE id = $1`, [
      matchId,
    ]);
    return res.rows.length > 0 ? toMatch(res.rows[0]) : null;
  }

  async saveMove({ matchId, expectedPly, board, sideToMove, move, now, outcome }) {
    return this.withTransaction(async (client) => {
      // FE-10: có `outcome` ({ result, endReason, finishedAt }) thì nước đi và kết thúc trận
      // được ghi trong CÙNG transaction -> không có trạng thái "bàn cờ đã chiếu bí nhưng vẫn PLAYING"
      const updated = outcome
        ? await client.query(
            `UPDATE pve_matches
             SET board_state = $1, side_to_move = $2, ply = ply + 1, updated_at = $3, turn_started_at = $4,
                 status = 'FINISHED', result = $5, end_reason = $6, finished_at = $7
             WHERE id = $8 AND ply = $9 AND status = 'PLAYING'`,
            [
              JSON.stringify(board), sideToMove, now, now,
              outcome.result, outcome.endReason, outcome.finishedAt || now,
              matchId, expectedPly,
            ]
          )
        : await client.query(
            `UPDATE pve_matches
             SET board_state = $1, side_to_move = $2, ply = ply + 1, updated_at = $3, turn_started_at = $4
             WHERE id = $5 AND ply = $6 AND status = 'PLAYING'`,
            [JSON.stringify(board), sideToMove, now, now, matchId, expectedPly]
          );
      if (updated.rowCount !== 1) {
        return false;
      }
      await client.query(
        `INSERT INTO pve_moves
           (match_id, ply, side, actor, piece_type, from_row, from_col, to_row, to_col, captured_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          matchId,
          expectedPly + 1,
          move.side,
          move.actor,
          move.pieceType,
          move.from.row,
          move.from.col,
          move.to.row,
          move.to.col,
          move.capturedType || null,
          now,
        ]
      );
      return true;
    });
  }

  async listMoves(matchId) {
    const res = await this.db.query(
      `SELECT ply, side, actor, piece_type, from_row, from_col, to_row, to_col, captured_type, created_at
       FROM pve_moves WHERE match_id = $1 ORDER BY ply ASC`,
      [matchId]
    );
    return res.rows.map(toMoveRecord);
  }

  async finish({ matchId, result, endReason, now, expectedPly }) {
    const sql = `UPDATE pve_matches
       SET status = 'FINISHED', result = $1, end_reason = $2, finished_at = $3, updated_at = $4
       WHERE id = $5 AND status = 'PLAYING'`;
    const params = [result, endReason, now, now, matchId];
    const res =
      expectedPly === undefined
        ? await this.db.query(sql, params)
        : await this.db.query(`${sql} AND ply = $6`, [...params, expectedPly]);
    return res.rowCount === 1;
  }

  async listByUser(userId, { status, limit = 20, offset = 0 } = {}) {
    const res = status
      ? await this.db.query(
          `SELECT ${SUMMARY_COLUMNS} FROM pve_matches
           WHERE user_id = $1 AND status = $2
           ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
          [userId, status, limit, offset]
        )
      : await this.db.query(
          `SELECT ${SUMMARY_COLUMNS} FROM pve_matches
           WHERE user_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        );
    return res.rows.map(toMatchSummary);
  }

  /**
   * FE-10: số trận PLAYING của một người chơi (giới hạn số trận đồng thời).
   */
  async countPlayingByUser(userId) {
    const res = await this.db.query(
      `SELECT COUNT(*) AS total FROM pve_matches WHERE user_id = $1 AND status = 'PLAYING'`,
      [userId]
    );
    return Number(res.rows[0].total);
  }

  /**
   * FE-10: các trận đang PLAYING (không kèm bàn cờ) cho sweeper, cũ nhất trước, tối đa `limit`.
   */
  async listPlaying({ limit = 200 } = {}) {
    const res = await this.db.query(
      `SELECT ${SUMMARY_COLUMNS} FROM pve_matches
       WHERE status = 'PLAYING' ORDER BY updated_at ASC, id ASC LIMIT $1`,
      [limit]
    );
    return res.rows.map(toMatchSummary);
  }

  async withTransaction(work) {
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = { PgPveMatchRepository };
