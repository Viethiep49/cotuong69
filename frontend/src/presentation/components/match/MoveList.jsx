import { useEffect, useId, useRef } from 'react';
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
      {/* Ký hiệu → và × chỉ để nhìn; trình đọc màn hình đọc câu "e3 đến e4, ăn quân" */}
      <span className="move-text" aria-hidden="true">{formatMove(move)}</span>
      <span className="move-side-name">{`${move.from} đến ${move.to}${move.captured ? ', ăn quân' : ''}`}</span>
    </span>
  );
}

/**
 * Danh sách nước đi dạng bảng số hàng: "1. Đỏ e3→e4 | Đen a6→a5".
 * `moves` là các nước màn hình đã quan sát được (xem useMoveHistory, mỗi nước có `ply`); `totalPly` (nếu biết)
 * cho phép báo danh sách chưa đầy đủ. Nước bị thiếu ở giữa hiện thành hàng "…".
 */
export default function MoveList({ moves = [], totalPly = null, title = 'Nước đi' }) {
  const headingId = useId();
  const rows = buildMoveRows(moves);
  const partial = isHistoryPartial(moves, totalPly);
  const scrollRef = useRef(null);
  const lastMove = moves.length ? moves[moves.length - 1] : null;
  const latestRowNumber = lastMove ? Math.ceil(lastMove.ply / 2) : null;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [moves.length]);

  const emptyText = partial ? 'Chưa ghi nhận nước nào từ khi mở trang.' : 'Chưa có nước đi nào.';
  const countText = partial
    ? (moves.length ? `${moves.length} / ${totalPly} nước` : null)
    : `${moves.length} nước`;

  return (
    <section className="move-list-card" aria-labelledby={headingId}>
      <div className="move-list-heading">
        <h2 id={headingId}>{title}</h2>
        {countText && <span className="move-list-count">{countText}</span>}
      </div>
      <div className="move-list-columns" aria-hidden="true">
        <span>#</span><span>Đỏ</span><span>Đen</span>
      </div>
      <div className="move-list-scroll" ref={scrollRef} tabIndex={0} role="group" aria-labelledby={headingId}>
        {rows.length === 0 ? (
          <p className="move-list-empty">{emptyText}</p>
        ) : (
          <ol className="move-list" role="list" aria-label="Danh sách nước đi">
            {rows.map((row) => {
              if (row.gap) {
                const count = row.to - row.from + 1;
                return (
                  <li className="move-row move-row-gap" key={`gap-${row.from}`} data-move-gap={`${row.from}-${row.to}`}>
                    <span className="move-no" aria-hidden="true">…</span>
                    <span className="move-gap-text">
                      {count === 1 ? `Thiếu hàng ${row.from}` : `Thiếu hàng ${row.from}–${row.to}`}
                    </span>
                  </li>
                );
              }
              const isLatestRow = row.number === latestRowNumber;
              return (
                <li className="move-row" key={row.number} data-move-row={row.number}>
                  <span className="move-no">{row.number}.</span>
                  <MoveCell move={row.red} side="red" isLatest={isLatestRow && lastMove.color === 'red'} />
                  <MoveCell move={row.black} side="black" isLatest={isLatestRow && lastMove.color === 'black'} />
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
