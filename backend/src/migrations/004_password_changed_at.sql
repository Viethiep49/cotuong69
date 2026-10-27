-- BE-02: mốc đổi mật khẩu gần nhất, dùng để thu hồi JWT cũ sau khi reset mật khẩu
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP WITH TIME ZONE;

-- Cho phép tra cứu token theo hash nhanh
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens (token);
