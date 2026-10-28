/**
 * FE-10: sweeper định kỳ cho trận PvE.
 *
 * Trận PLAYING mà tới lượt máy (vd. server sập giữa nước của người và nước của máy, hoặc máy lỗi
 * tạm thời) -> cho máy đi; còn lại -> xét người chơi hết 60 giây (COT-636) để trận bỏ dở tự kết
 * thúc và không chiếm chỗ trong giới hạn số trận đang chơi.
 *
 * Timer dùng unref() nên không giữ process sống; tick không chồng nhau; lỗi một trận không làm
 * dừng cả lượt quét.
 */
const DEFAULT_INTERVAL_MS = 5 * 1000;
const DEFAULT_BATCH = 200;

/**
 * @param {{ service: { listPlaying: Function, advanceMatch: Function },
 *           intervalMs?: number, batch?: number, logger?: { error: Function } }} deps
 */
function createPveSweeper({ service, intervalMs = DEFAULT_INTERVAL_MS, batch = DEFAULT_BATCH, logger = console }) {
  let timer = null;
  let running = false;

  /** Quét một lượt. @returns {Promise<{ scanned: number, failed: number }>} */
  async function sweepOnce() {
    if (running) return { scanned: 0, failed: 0 };
    running = true;
    let scanned = 0;
    let failed = 0;
    try {
      const matches = await service.listPlaying({ limit: batch });
      for (const match of matches) {
        scanned += 1;
        try {
          await service.advanceMatch(match.id);
        } catch (err) {
          failed += 1;
          logger.error(`[PvE sweeper] Lỗi xử lý trận ${match.id}:`, err && err.message);
        }
      }
    } catch (err) {
      logger.error('[PvE sweeper] Lỗi quét trận:', err && err.message);
    } finally {
      running = false;
    }
    return { scanned, failed };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      sweepOnce();
    }, intervalMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, sweepOnce, isRunning: () => Boolean(timer) };
}

module.exports = { createPveSweeper, DEFAULT_INTERVAL_MS };
