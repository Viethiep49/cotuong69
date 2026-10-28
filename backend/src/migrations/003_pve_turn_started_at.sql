-- ====================================================================
-- Migration: 003_pve_turn_started_at.sql
-- Module: Chơi với máy - PvE (COT-636)
-- Mô tả: Lưu thời điểm bắt đầu lượt hiện tại để xử lý người chơi hết 60 giây cho một lượt
-- ====================================================================

ALTER TABLE pve_matches ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMP WITH TIME ZONE;

UPDATE pve_matches SET turn_started_at = updated_at WHERE turn_started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pve_matches_user_status ON pve_matches(user_id, status);
