-- ====================================================================
-- Migration: 002_pve_matches.sql
-- Module: Chơi với máy - PvE (COT-634)
-- Mô tả: Bảng trận PvE (trạng thái bàn cờ, lượt đi, kết quả) và lịch sử nước đi
-- Lưu ý: chạy được trên cả PostgreSQL và lớp SQLite của config/db.js
--        (không dùng BOOLEAN, JSONB, kiểu enum hay câu lệnh chứa dấu chấm phẩy bên trong)
-- ====================================================================

-- 1. Bảng PvE_Matches (Trận đấu giữa người chơi và máy)
CREATE TABLE IF NOT EXISTS pve_matches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_color VARCHAR(5) NOT NULL,
    bot_color VARCHAR(5) NOT NULL,
    board_state TEXT NOT NULL, -- JSON bàn cờ 10x9: null hoặc { type, color }
    side_to_move VARCHAR(5) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PLAYING', -- PLAYING, FINISHED
    result VARCHAR(10), -- Theo góc nhìn người chơi: WIN, LOSS, DRAW (REV-13)
    end_reason VARCHAR(20), -- CHECKMATE, NO_LEGAL_MOVES, TIMEOUT, RESIGN, DRAW_PLY_LIMIT (REV-13)
    ply INTEGER NOT NULL DEFAULT 0, -- Số nước đã đi (cả hai bên)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT ck_pve_matches_player_color CHECK (player_color IN ('red', 'black')),
    CONSTRAINT ck_pve_matches_bot_color CHECK (bot_color IN ('red', 'black')),
    CONSTRAINT ck_pve_matches_distinct_colors CHECK (player_color <> bot_color),
    CONSTRAINT ck_pve_matches_side_to_move CHECK (side_to_move IN ('red', 'black')),
    CONSTRAINT ck_pve_matches_status CHECK (status IN ('PLAYING', 'FINISHED')),
    CONSTRAINT ck_pve_matches_result CHECK (result IS NULL OR result IN ('WIN', 'LOSS', 'DRAW')),
    CONSTRAINT ck_pve_matches_end_reason CHECK (
        end_reason IS NULL OR end_reason IN ('CHECKMATE', 'NO_LEGAL_MOVES', 'TIMEOUT', 'RESIGN', 'DRAW_PLY_LIMIT')
    ),
    CONSTRAINT ck_pve_matches_ply CHECK (ply >= 0)
);

-- 2. Bảng PvE_Moves (Lịch sử nước đi của trận PvE, dùng để xem lại ván)
CREATE TABLE IF NOT EXISTS pve_moves (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES pve_matches(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL, -- Thứ tự nước đi, bắt đầu từ 1
    side VARCHAR(5) NOT NULL, -- Màu quân đi nước này
    actor VARCHAR(10) NOT NULL, -- PLAYER hoặc BOT
    piece_type VARCHAR(1) NOT NULL,
    from_row INTEGER NOT NULL,
    from_col INTEGER NOT NULL,
    to_row INTEGER NOT NULL,
    to_col INTEGER NOT NULL,
    captured_type VARCHAR(1), -- Loại quân bị ăn (nếu có)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pve_moves_match_ply UNIQUE (match_id, ply),
    CONSTRAINT ck_pve_moves_side CHECK (side IN ('red', 'black')),
    CONSTRAINT ck_pve_moves_actor CHECK (actor IN ('PLAYER', 'BOT'))
);

CREATE INDEX IF NOT EXISTS idx_pve_matches_user ON pve_matches(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pve_matches_status ON pve_matches(status);
CREATE INDEX IF NOT EXISTS idx_pve_moves_match ON pve_moves(match_id, ply);
