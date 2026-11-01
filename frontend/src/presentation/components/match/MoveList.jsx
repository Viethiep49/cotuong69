import { useEffect, useRef } from 'react';
import { buildMoveRows, formatMove, isHistoryPartial } from '../../../domain/game/moveHistory';
import './MoveList.css';

function MoveCell({ move, side, isLatest }) {
  if (!move) {
    return <span className={`move-cell move-cell-${side} is-empty`} aria-hidden="true">…</span>;
  }
  return (
    <span
      className={`move-cell move-cell-${side}${isLatest ? ' is-latest' : ''}`}
      aria-current={isLatest ? 'true' : undefined}
      data-move-color={side}
    >
      <span className="move-side-name">{side === 'red' ? 'Đỏ' : 'Đen'} </span>
      <span className="move-text">{formatMove(move)}</span>
    </span>
  );
}

/**
 * Danh sách nước đi dạng bảng số hàng: "1. Đỏ e3→e4 | Đen a6→a5".
 * `moves` là các nước màn hình đã quan sát được (xem useMoveHistory); `totalPly` (nếu biết) cho phép báo
 * danh sách chưa đầy đủ.
 */
export default function MoveList({ moves = [], totalPly = null, title = 'Nước đi' }) {
  const rows = buildMoveRows(moves, { totalPly });
  const partial = isHistoryPartial(moves, totalPly);
  const scrollRef = useRef(null);
  const lastMoveColor = moves.length ? moves[moves.length - 1].color : null;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [moves.length]);

  return (
    <section className="move-list-card" aria-label="Lịch sử nước đi">
      <div className="move-list-heading">
        <h2>{title}</h2>
        <span className="move-list-count">{moves.length} nước</span>
      </div>
      <div className="move-list-columns" aria-hidden="true">
        <span>#</span><span>Đỏ</span><span>Đen</span>
      </div>
      <div className="move-list-scroll" ref={scrollRef}>
        {rows.length === 0 ? (
          <p className="move-list-empty">Chưa có nước đi nào.</p>
        ) : (
          <ol className="move-list" role="list" aria-label="Danh sách nước đi">
            {rows.map((row, rowIndex) => {
              const isLastRow = rowIndex === rows.length - 1;
              return (
                <li className="move-row" key={`${row.number}-${rowIndex}`} data-move-row={row.number}>
                  <span className="move-no">{row.number}.</span>
                  <MoveCell move={row.red} side="red" isLatest={isLastRow && lastMoveColor === 'red'} />
                  <MoveCell move={row.black} side="black" isLatest={isLastRow && lastMoveColor === 'black'} />
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {partial && (
        <p className="move-list-note" data-testid="move-list-partial-note">
          Lịch sử chỉ gồm các nước từ khi mở trang.
        </p>
      )}
    </section>
  );
}
