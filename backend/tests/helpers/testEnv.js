// SEC-02: JWT_SECRET là bắt buộc. Đặt secret dùng cho test TRƯỚC khi nạp bất kỳ module src/ nào.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef0123456789abcdef';
// BE-11: test cũ cần endpoint trận mẫu; test riêng sẽ tắt biến này để kiểm tra mặc định
process.env.ENABLE_DEMO_MATCH = process.env.ENABLE_DEMO_MATCH || 'true';
