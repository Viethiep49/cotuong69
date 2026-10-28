/**
 * Hiện thực IPveMatchRepository trong bộ nhớ, chỉ dùng cho unit test use-case.
 * Giữ cùng ngữ nghĩa với PgPveMatchRepository: dữ liệu được sao chép khi đọc/ghi
 * và saveMove chỉ ghi khi trận PLAYING và ply khớp expectedPly.
 */
const clone = (value) => JSON.parse(JSON.stringify(value));

class InMemoryPveMatchRepository {
  constructor() {
    this.matches = new Map();
    this.moves = new Map();
    this.nextId = 1;
  }

  toMatch(stored) {
    const copy = clone(stored);
    return {
      ...copy,
      createdAt: new Date(stored.createdAt),
      updatedAt: new Date(stored.updatedAt),
      finishedAt: stored.finishedAt ? new Date(stored.finishedAt) : null,
      turnStartedAt: new Date(stored.turnStartedAt),
    };
  }

  async create({ userId, playerColor, botColor, board, sideToMove, now }) {
    const id = this.nextId++;
    this.matches.set(id, {
      id,
      userId,
      playerColor,
      botColor,
      board: clone(board),
      sideToMove,
      status: 'PLAYING',
      result: null,
      endReason: null,
      ply: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      turnStartedAt: now,
    });
    this.moves.set(id, []);
    return this.findById(id);
  }

  async findById(matchId) {
    const stored = this.matches.get(Number(matchId));
    return stored ? this.toMatch(stored) : null;
  }

  async saveMove({ matchId, expectedPly, board, sideToMove, move, now, outcome }) {
    const stored = this.matches.get(Number(matchId));
    if (!stored || stored.status !== 'PLAYING' || stored.ply !== expectedPly) {
      return false;
    }
    stored.board = clone(board);
    stored.sideToMove = sideToMove;
    stored.ply += 1;
    stored.updatedAt = now;
    stored.turnStartedAt = now;
    if (outcome) {
      stored.status = 'FINISHED';
      stored.result = outcome.result;
      stored.endReason = outcome.endReason;
      stored.finishedAt = outcome.finishedAt || now;
    }
    this.moves.get(stored.id).push({ ...clone(move), ply: stored.ply, createdAt: now });
    return true;
  }

  async finish({ matchId, result, endReason, now, expectedPly }) {
    const stored = this.matches.get(Number(matchId));
    if (!stored || stored.status !== 'PLAYING') {
      return false;
    }
    if (expectedPly !== undefined && stored.ply !== expectedPly) {
      return false;
    }
    stored.status = 'FINISHED';
    stored.result = result;
    stored.endReason = endReason;
    stored.finishedAt = now;
    stored.updatedAt = now;
    return true;
  }

  async listByUser(userId, { status, limit = 20, offset = 0 } = {}) {
    return [...this.matches.values()]
      .filter((m) => String(m.userId) === String(userId) && (!status || m.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(offset, offset + limit)
      .map((m) => {
        const { board, ...summary } = this.toMatch(m);
        return summary;
      });
  }

  async countPlayingByUser(userId) {
    return [...this.matches.values()].filter(
      (m) => String(m.userId) === String(userId) && m.status === 'PLAYING'
    ).length;
  }

  async listPlaying({ limit = 200 } = {}) {
    return [...this.matches.values()]
      .filter((m) => m.status === 'PLAYING')
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)) || a.id - b.id)
      .slice(0, limit)
      .map((m) => {
        const { board, ...summary } = this.toMatch(m);
        return summary;
      });
  }

  async listMoves(matchId) {
    return (this.moves.get(Number(matchId)) || []).map((m) => ({
      ply: m.ply,
      side: m.side,
      actor: m.actor,
      pieceType: m.pieceType,
      from: { ...m.from },
      to: { ...m.to },
      capturedType: m.capturedType || null,
      createdAt: new Date(m.createdAt),
    }));
  }
}

module.exports = { InMemoryPveMatchRepository };
