const defaultDb = require('../../../config/db');

function toDate(val) {
  if (!val) return null;
  return val instanceof Date ? val : new Date(val);
}

function toUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    passwordHash: row.password_hash,
    eloRating: Number(row.elo_rating ?? 1000),
    avatarUrl: row.avatar_url || null,
    status: row.status || 'ACTIVE',
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    passwordChangedAt: toDate(row.password_changed_at),
  };
}

class PgUserRepository {
  constructor({ db = defaultDb } = {}) {
    this.db = db;
  }

  async findByUsername(username) {
    if (!username) return null;
    const res = await this.db.query(
      `SELECT id, username, display_name, email, password_hash, elo_rating, avatar_url, status, created_at, updated_at, password_changed_at
       FROM users WHERE username = $1 LIMIT 1`,
      [username.trim()]
    );
    return res.rows.length > 0 ? toUser(res.rows[0]) : null;
  }

  async findByEmail(email) {
    if (!email) return null;
    const res = await this.db.query(
      `SELECT id, username, display_name, email, password_hash, elo_rating, avatar_url, status, created_at, updated_at, password_changed_at
       FROM users WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    return res.rows.length > 0 ? toUser(res.rows[0]) : null;
  }

  async findById(id) {
    if (!id) return null;
    const res = await this.db.query(
      `SELECT id, username, display_name, email, password_hash, elo_rating, avatar_url, status, created_at, updated_at, password_changed_at
       FROM users WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    return res.rows.length > 0 ? toUser(res.rows[0]) : null;
  }

  async create({ username, displayName, email, passwordHash, eloRating = 1000, avatarUrl = null, status = 'ACTIVE' }) {
    await this.db.query(
      `INSERT INTO users (username, display_name, email, password_hash, elo_rating, avatar_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username.trim(), displayName.trim(), email.trim().toLowerCase(), passwordHash, eloRating, avatarUrl, status]
    );
    return await this.findByUsername(username.trim());
  }

  async updatePassword(userId, passwordHash) {
    await this.db.query(
      `UPDATE users SET password_hash = $1, password_changed_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [passwordHash, Number(userId)]
    );
    return await this.findById(userId);
  }

  async updateProfile(userId, { displayName, avatarUrl } = {}) {
    if (displayName !== undefined && avatarUrl !== undefined) {
      await this.db.query(
        `UPDATE users SET display_name = $1, avatar_url = $2 WHERE id = $3`,
        [displayName, avatarUrl, Number(userId)]
      );
    } else if (displayName !== undefined) {
      await this.db.query(
        `UPDATE users SET display_name = $1 WHERE id = $2`,
        [displayName, Number(userId)]
      );
    } else if (avatarUrl !== undefined) {
      await this.db.query(
        `UPDATE users SET avatar_url = $1 WHERE id = $2`,
        [avatarUrl, Number(userId)]
      );
    }
    return await this.findById(userId);
  }

  async updateElo(userId, eloRating) {
    await this.db.query(
      `UPDATE users SET elo_rating = $1 WHERE id = $2`,
      [Number(eloRating), Number(userId)]
    );
    return await this.findById(userId);
  }

  /**
   * BE-03: cộng/trừ Elo theo DELTA (không ghi đè giá trị tuyệt đối) cho 2 người
   * trong CÙNG một transaction — tránh ghi sai khi trạng thái trong RAM đã cũ.
   * @param {{userId:number, delta:number}} first
   * @param {{userId:number, delta:number}} second
   */
  async addEloPair(first, second) {
    const apply = async (query, { userId, delta }) => {
      const numericDelta = Number.isFinite(Number(delta)) ? Math.round(Number(delta)) : 0;
      await query(
        `UPDATE users
         SET elo_rating = CASE WHEN elo_rating + $1 < 0 THEN 0 ELSE elo_rating + $1 END
         WHERE id = $2`,
        [numericDelta, Number(userId)]
      );
    };

    const client = typeof this.db.getClient === 'function' ? await this.db.getClient() : null;
    if (!client) {
      const query = (text, params) => this.db.query(text, params);
      await apply(query, first);
      await apply(query, second);
      return;
    }

    try {
      await client.query('BEGIN');
      const query = (text, params) => client.query(text, params);
      await apply(query, first);
      await apply(query, second);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = PgUserRepository;
