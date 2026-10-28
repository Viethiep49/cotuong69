/**
 * Lắp ráp các use-case PvE với dependency được inject (repository, clock, nguồn random).
 * Tầng presentation (HTTP/socket, làm sau) chỉ cần gọi createPveUseCases một lần khi khởi động.
 * Trận PvE không ảnh hưởng điểm Elo: không use-case nào ở đây đọc/ghi users.elo_rating.
 */
const { makeApplyAndPersistMove } = require('./applyAndPersistMove');
const { makeCreatePveMatch } = require('./createPveMatch');
const { makeSubmitPlayerMove } = require('./submitPlayerMove');
const { makeFinishPveMatch } = require('./finishPveMatch');
const { makePlayBotTurn } = require('./playBotTurn');
const { makeResignPveMatch } = require('./resignPveMatch');
const { makeCheckPveTimeout } = require('./checkPveTimeout');
const { makeListPlayerPveHistory, makeGetPveMatchReplay } = require('./pveHistory');

/**
 * @param {{ pveMatchRepository: object, clock?: () => Date, random?: () => number }} deps
 */
function createPveUseCases({ pveMatchRepository, clock = () => new Date(), random = Math.random }) {
  const finishPveMatch = makeFinishPveMatch({ pveMatchRepository, clock });
  const applyAndPersistMove = makeApplyAndPersistMove({ pveMatchRepository, clock });
  return {
    applyAndPersistMove,
    finishPveMatch,
    createPveMatch: makeCreatePveMatch({ pveMatchRepository, clock }),
    submitPlayerMove: makeSubmitPlayerMove({
      pveMatchRepository,
      applyAndPersistMove,
      finishPveMatch,
      clock,
    }),
    playBotTurn: makePlayBotTurn({ pveMatchRepository, applyAndPersistMove, finishPveMatch, random }),
    resignPveMatch: makeResignPveMatch({ pveMatchRepository, finishPveMatch }),
    checkPveTimeout: makeCheckPveTimeout({ pveMatchRepository, finishPveMatch, clock }),
    listPlayerPveHistory: makeListPlayerPveHistory({ pveMatchRepository }),
    getPveMatchReplay: makeGetPveMatchReplay({ pveMatchRepository }),
  };
}

module.exports = { createPveUseCases };
