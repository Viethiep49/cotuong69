// SEC-02: JWT_SECRET là bắt buộc. Đặt secret dùng cho test TRƯỚC khi nạp bất kỳ module src/ nào.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef0123456789abcdef';
