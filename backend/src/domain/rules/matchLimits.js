/**
 * REV-13: giới hạn số nước đi (ply) chung cho PvP (Room) và PvE.
 * Đạt giới hạn mà chưa phân thắng bại -> ván HOÀ (endReason DRAW_PLY_LIMIT).
 * Cấu hình bằng biến môi trường MAX_PLY_PER_MATCH (mặc định 300).
 */
const MAX_PLY_PER_MATCH = Number(process.env.MAX_PLY_PER_MATCH || 300);
const DRAW_PLY_LIMIT = 'DRAW_PLY_LIMIT';

module.exports = { MAX_PLY_PER_MATCH, DRAW_PLY_LIMIT };
