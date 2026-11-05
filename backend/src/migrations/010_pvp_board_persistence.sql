-- ====================================================================
-- Migration: 010_pvp_board_persistence.sql
-- Trước đây bàn cờ PvP chỉ nằm trong RAM (RoomManager -> room.matchState.board),
-- DB chỉ có kết quả cuối ván (pvp_matches). Server restart là mất thế cờ và
-- toàn bộ nước đi. Bảng dưới đây lưu snapshot sau mỗi nước + lịch sử nước đi.
-- Lưu ý: chạy được trên cả PostgreSQL và lớp SQLite của config/db.js
--        (không dùng BOOLEAN, JSONB, enum hay dấu chấm phẩy trong comment/câu lệnh)
-- ====================================================================

-- 1. Snapshot thế cờ mới nhất của mỗi ván PvP (1 dòng / ván, ghi đè sau mỗi nước)
CREATE TABLE IF NOT EXISTS pvp_match_states (
    match_id VARCHAR(100) PRIMARY KEY,
    room_code VARCHAR(20) NOT NULL,
    red_user_id INTEGER,
    black_user_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'PLAYING', -- PLAYING, FINISHED, ABORTED
    board_state TEXT NOT NULL, -- JSON: danh sách quân { id, color, type, position }
    current_turn VARCHAR(5) NOT NULL,
    ply INTEGER NOT NULL DEFAULT 0,
    remaining_clocks TEXT, -- JSON: { red, black } (giây)
    captured_pieces TEXT, -- JSON: { red: [], black: [] }
    end_reason VARCHAR(40),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_pvp_match_states_status CHECK (status IN ('PLAYING', 'FINISHED', 'ABORTED')),
    CONSTRAINT ck_pvp_match_states_turn CHECK (current_turn IN ('red', 'black')),
    CONSTRAINT ck_pvp_match_states_ply CHECK (ply >= 0)
);

-- 2. Lịch sử nước đi PvP (dùng để xem lại ván)
CREATE TABLE IF NOT EXISTS pvp_moves (
    id SERIAL PRIMARY KEY,
    match_id VARCHAR(100) NOT NULL REFERENCES pvp_match_states(match_id) ON DELETE CASCADE,
    ply INTEGER NOT NULL, -- Thứ tự nước đi, bắt đầu từ 1
    side VARCHAR(5) NOT NULL,
    piece_type VARCHAR(20) NOT NULL,
    from_pos VARCHAR(4) NOT NULL, -- Toạ độ dạng 'b2'
    to_pos VARCHAR(4) NOT NULL,
    captured_type VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pvp_moves_match_ply UNIQUE (match_id, ply),
    CONSTRAINT ck_pvp_moves_side CHECK (side IN ('red', 'black'))
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_states_status ON pvp_match_states (status);
CREATE INDEX IF NOT EXISTS idx_pvp_match_states_room ON pvp_match_states (room_code);
CREATE INDEX IF NOT EXISTS idx_pvp_moves_match ON pvp_moves (match_id, ply);
