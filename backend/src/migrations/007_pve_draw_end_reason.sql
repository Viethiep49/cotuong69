-- REV-13: cho phép end_reason DRAW_PLY_LIMIT trong PvE (hoà do đạt giới hạn số nước đi).
-- pg-only: SQLite không hỗ trợ ALTER TABLE ... DROP/ADD CONSTRAINT. Schema SQLite dùng cho
-- test đã được đồng bộ trực tiếp trong 002_pve_matches.sql.
ALTER TABLE pve_matches DROP CONSTRAINT IF EXISTS ck_pve_matches_end_reason;
-- pg-only
ALTER TABLE pve_matches ADD CONSTRAINT ck_pve_matches_end_reason
  CHECK (end_reason IS NULL OR end_reason IN ('CHECKMATE', 'NO_LEGAL_MOVES', 'TIMEOUT', 'RESIGN', 'DRAW_PLY_LIMIT'));
