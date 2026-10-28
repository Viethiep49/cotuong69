// SEC-02: JWT_SECRET là bắt buộc. Đặt secret dùng cho test TRƯỚC khi nạp bất kỳ module src/ nào.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-0123456789abcdef0123456789abcdef';
// Đặt NODE_ENV=test trước khi dotenv nạp backend/.env (dotenv không ghi đè biến đã có), để test ở máy
// cá nhân chạy giống CI, không phụ thuộc NODE_ENV=development trong .env (vd miễn rate limit loopback)
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// BE-11: test cũ cần endpoint trận mẫu; test riêng sẽ tắt biến này để kiểm tra mặc định
process.env.ENABLE_DEMO_MATCH = process.env.ENABLE_DEMO_MATCH || 'true';
// BE-13: hạ bcrypt cost cho test chạy nhanh (production dùng 12)
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || '10';
