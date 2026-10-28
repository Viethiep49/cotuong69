/**
 * Tiện ích tính toán điểm Elo theo chuẩn FIDE với hệ số K = 32 (COT-595)
 */
function calculateElo(playerRating, opponentRating, score, k = 32) {
  // BE-03: Elo 0 là hợp lệ — không được âm thầm đổi thành 1000
  const pRating = Number.isFinite(Number(playerRating)) ? Number(playerRating) : 1000;
  const oRating = Number.isFinite(Number(opponentRating)) ? Number(opponentRating) : 1000;

  const numericScore = Number(score);
  if (![0, 0.5, 1].includes(numericScore)) {
    throw new Error('Điểm số của ván đấu chỉ được là 0, 0.5 hoặc 1.');
  }

  const numericK = Number.isFinite(Number(k)) && Number(k) > 0 ? Number(k) : 32;

  // Kỳ vọng điểm số (Expected Score): E = 1 / (1 + 10 ^ ((R_opp - R_player) / 400))
  const expected = 1 / (1 + Math.pow(10, (oRating - pRating) / 400));

  // Điểm thay đổi: ΔR = round(K * (Score - Expected))
  const change = Math.round(numericK * (numericScore - expected));
  const newRating = Math.max(0, pRating + change);

  return {
    oldRating: pRating,
    newRating,
    change,
    expected,
  };
}

module.exports = {
  calculateElo,
};
