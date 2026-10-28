-- ====================================================================
-- Migration: 009_pvp_match_players.sql
-- REV2-06: ván hoà / huỷ (SYSTEM_ERROR) không có người thắng/thua nên các cột
-- winner_user_id / loser_user_id đều NULL -> dòng pvp_matches không biết ai đã chơi.
-- Luôn lưu id của cả hai bên (Đỏ và Đen), không phụ thuộc kết quả.
-- ====================================================================
ALTER TABLE pvp_matches ADD COLUMN IF NOT EXISTS red_user_id INTEGER;
ALTER TABLE pvp_matches ADD COLUMN IF NOT EXISTS black_user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_pvp_matches_red ON pvp_matches (red_user_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_black ON pvp_matches (black_user_id);
