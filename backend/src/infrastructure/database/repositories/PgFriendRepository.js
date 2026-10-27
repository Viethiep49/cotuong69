const defaultDb = require('../../../config/db');

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

  async addFriend(userId, friendId, status = 'ACCEPTED') {
    const u1 = Number(userId);
    const u2 = Number(friendId);
    if (u1 === u2) throw new Error('Không thể kết bạn với chính mình.');

    await this.db.query(
      `INSERT INTO friends (user_id, friend_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, friend_id) DO UPDATE SET status = EXCLUDED.status`,
      [u1, u2, status]
    );
    return true;
  }
}

module.exports = PgFriendRepository;
