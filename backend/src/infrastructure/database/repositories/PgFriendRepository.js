const defaultDb = require('../../../config/db');
const { AppError } = require('../../../core/errors/AppError');

class PgFriendRepository {
  constructor({ db = defaultDb } = {}) {
    this.db = db;
  }

  async areFriends(userIdA, userIdB) {
    if (!userIdA || !userIdB || Number(userIdA) === Number(userIdB)) return false;
    const res = await this.db.query(
      `SELECT id FROM friends
       WHERE status = 'ACCEPTED' AND (
         (user_id = $1 AND friend_id = $2) OR
         (user_id = $2 AND friend_id = $1)
       ) LIMIT 1`,
      [Number(userIdA), Number(userIdB)]
    );
    return res.rows.length > 0;
  }

  async listAcceptedFriends(userId) {
    if (!userId) return [];
    const uid = Number(userId);
    const res = await this.db.query(
      `SELECT u.id, u.username, u.display_name, u.elo_rating, u.avatar_url, u.status
       FROM friends f
       JOIN users u ON (u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END)
       WHERE (f.user_id = $1 OR f.friend_id = $1)
         AND f.status = 'ACCEPTED'
         AND u.status = 'ACTIVE'`,
      [uid]
    );

    return res.rows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      eloRating: Number(row.elo_rating ?? 1000),
      avatarUrl: row.avatar_url || null,
      status: row.status,
    }));
  }

  /**
   * REV-09: tìm quan hệ theo CẢ HAI chiều. Sau migration 005, index duy nhất là đối xứng
   * (A,B) = (B,A) nên ON CONFLICT (user_id, friend_id) không bắt được trường hợp chèn chiều ngược.
   */
  async findRelation(userIdA, userIdB) {
    const res = await this.db.query(
      `SELECT id, user_id, friend_id, status FROM friends
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
       LIMIT 1`,
      [Number(userIdA), Number(userIdB)]
    );
    const row = res.rows && res.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      friendId: Number(row.friend_id),
      status: row.status,
    };
  }

  /**
   * Thêm quan hệ bạn bè. Nếu quan hệ đã tồn tại (theo bất kỳ chiều nào) thì trả về
   * bản ghi đó, không chèn thêm.
   * @returns {Promise<{id:number,userId:number,friendId:number,status:string}>}
   */
  async addFriend(userId, friendId, status = 'ACCEPTED') {
    const u1 = Number(userId);
    const u2 = Number(friendId);
    if (u1 === u2) throw new Error('Không thể kết bạn với chính mình.');

    const existing = await this.findRelation(u1, u2);
    if (existing) return existing;

    try {
      const res = await this.db.query(
        `INSERT INTO friends (user_id, friend_id, status)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [u1, u2, status]
      );
      const id = res.rows && res.rows[0] ? Number(res.rows[0].id) : null;
      return { id, userId: u1, friendId: u2, status };
    } catch (err) {
      // Hai request đồng thời cùng chèn -> một bên dính unique violation
      const isUnique = (err && err.code === '23505')
        || /UNIQUE constraint failed/i.test((err && err.message) || '');
      if (isUnique) {
        throw new AppError('ALREADY_FRIENDS', 'Hai người đã có quan hệ bạn bè.');
      }
      throw err;
    }
  }
}

module.exports = PgFriendRepository;
