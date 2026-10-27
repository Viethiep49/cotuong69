const FILES = 'abcdefghi';

function parsePosition(position) {
  // SEC-03: chỉ chấp nhận chữ thường ('e3'); toạ độ in hoa trước đây lọt qua rồi gây lỗi
  if (typeof position !== 'string' || !/^[a-i][0-9]$/.test(position)) {
    return null;
  }
  return { file: FILES.indexOf(position[0].toLowerCase()), rank: Number(position[1]) };
}

function positionOf(file, rank) {
  return `${FILES[file]}${rank}`;
}

function pieceAt(pieces, file, rank) {
  return pieces.find((piece) => {
    const position = parsePosition(piece.position);
    return position?.file === file && position.rank === rank;
  });
}

function insideBoard(file, rank) {
  return file >= 0 && file <= 8 && rank >= 0 && rank <= 9;
}

function inPalace(color, file, rank) {
  return file >= 3 && file <= 5 &&
    (color === 'red' ? rank >= 0 && rank <= 2 : rank >= 7 && rank <= 9);
}

function countBetween(pieces, from, to) {
  const fileStep = Math.sign(to.file - from.file);
  const rankStep = Math.sign(to.rank - from.rank);
  let file = from.file + fileStep;
  let rank = from.rank + rankStep;
  let count = 0;

  while (file !== to.file || rank !== to.rank) {
    if (pieceAt(pieces, file, rank)) count += 1;
    file += fileStep;
    rank += rankStep;
  }
  return count;
}

function isPseudoLegal(piece, from, to, pieces, ignoreTargetSide = false) {
  if (!insideBoard(to.file, to.rank) || (from.file === to.file && from.rank === to.rank)) {
    return false;
  }

  const target = pieceAt(pieces, to.file, to.rank);
  if (!ignoreTargetSide && target?.color === piece.color) return false;

  const fileDistance = Math.abs(to.file - from.file);
  const rankDistance = Math.abs(to.rank - from.rank);
  const sameLine = from.file === to.file || from.rank === to.rank;

  switch (piece.type) {
    case 'general':
      if (fileDistance + rankDistance === 1 && inPalace(piece.color, to.file, to.rank)) return true;
      return target?.type === 'general' && from.file === to.file &&
        countBetween(pieces, from, to) === 0;
    case 'advisor':
      return fileDistance === 1 && rankDistance === 1 && inPalace(piece.color, to.file, to.rank);
    case 'elephant': {
      if (fileDistance !== 2 || rankDistance !== 2) return false;
      const ownSide = piece.color === 'red' ? to.rank <= 4 : to.rank >= 5;
      return ownSide && !pieceAt(pieces, (from.file + to.file) / 2, (from.rank + to.rank) / 2);
    }
    case 'horse': {
      if (!((fileDistance === 2 && rankDistance === 1) || (fileDistance === 1 && rankDistance === 2))) {
        return false;
      }
      const legFile = fileDistance === 2 ? from.file + Math.sign(to.file - from.file) : from.file;
      const legRank = rankDistance === 2 ? from.rank + Math.sign(to.rank - from.rank) : from.rank;
      return !pieceAt(pieces, legFile, legRank);
    }
    case 'chariot':
      return sameLine && countBetween(pieces, from, to) === 0;
    case 'cannon': {
      if (!sameLine) return false;
      const screens = countBetween(pieces, from, to);
      return target ? screens === 1 : screens === 0;
    }
    case 'soldier': {
      const forward = piece.color === 'red' ? 1 : -1;
      if (fileDistance === 0 && to.rank - from.rank === forward) return true;
      const crossedRiver = piece.color === 'red' ? from.rank >= 5 : from.rank <= 4;
      return crossedRiver && rankDistance === 0 && fileDistance === 1;
    }
    default:
      return false;
  }
}

function isInCheck(pieces, color) {
  const general = pieces.find((piece) => piece.color === color && piece.type === 'general');
  if (!general) return true;
  const target = parsePosition(general.position);

  return pieces.some((attacker) => {
    if (attacker.color === color) return false;
    const from = parsePosition(attacker.position);
    return from && isPseudoLegal(attacker, from, target, pieces, true);
  });
}

function canMoveLegally(pieces, piece, from, to) {
  if (!isPseudoLegal(piece, from, to, pieces)) return false;
  if (pieceAt(pieces, to.file, to.rank)?.type === 'general') return false;

  const targetPosition = positionOf(to.file, to.rank);
  const nextPieces = pieces
    .filter((candidate) => candidate.id !== piece.id && candidate.position !== targetPosition)
    .concat({ ...piece, position: targetPosition });
  return !isInCheck(nextPieces, piece.color);
}

function getLegalMoveError(pieces, color, fromPosition, toPosition) {
  const from = parsePosition(fromPosition);
  const to = parsePosition(toPosition);
  if (!from || !to) return 'Tọa độ ô cờ không hợp lệ.';

  const piece = pieceAt(pieces, from.file, from.rank);
  if (!piece) return 'Ô nguồn không có quân cờ.';
  if (piece.color !== color) return 'Bạn chỉ được đi quân thuộc phe của mình.';
  if (pieceAt(pieces, to.file, to.rank)?.color === color) return 'Ô đích đang có quân cùng phe.';
  if (!isPseudoLegal(piece, from, to, pieces)) return 'Nước đi không đúng luật của quân cờ.';

  const target = pieceAt(pieces, to.file, to.rank);
  if (target?.type === 'general') return 'Không được bắt Tướng trực tiếp.';
  if (!canMoveLegally(pieces, piece, from, to)) return 'Nước đi khiến Tướng phe bạn bị chiếu.';
  return null;
}

function hasLegalMove(pieces, color) {
  for (const piece of pieces) {
    if (piece.color !== color) continue;
    const from = parsePosition(piece.position);
    for (let file = 0; file <= 8; file += 1) {
      for (let rank = 0; rank <= 9; rank += 1) {
        if (canMoveLegally(pieces, piece, from, { file, rank })) return true;
      }
    }
  }
  return false;
}

module.exports = {
  getLegalMoveError,
  hasLegalMove,
  isInCheck,
  parsePosition,
  positionOf,
};
