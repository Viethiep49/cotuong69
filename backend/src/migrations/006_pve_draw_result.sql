-- BE-20: cho phép kết quả hoà (DRAW) trong PvE.
-- pg-only: SQLite không hỗ trợ ALTER TABLE ... DROP/ADD CONSTRAINT.
ALTER TABLE pve_matches DROP CONSTRAINT IF EXISTS ck_pve_matches_result;
-- pg-only
ALTER TABLE pve_matches ADD CONSTRAINT ck_pve_matches_result
  CHECK (result IS NULL OR result IN ('WIN', 'LOSS', 'DRAW'));
