# KIẾN TRÚC CLEAN ARCHITECTURE - FRONTEND (REACT + VITE)

Dự án Frontend được xây dựng bằng **React (SPA)** theo chuẩn **Clean Architecture**, phân tách độc lập giữa giao diện người dùng (UI), logic nghiệp vụ (Use Cases), mô hình miền (Domain Entities) và các dịch vụ bên ngoài (API, WebSocket, WebRTC).

---

## 🏛️ Sơ Đồ Cấu Trúc Thư Mục Frontend

```text
frontend/src/
├── core/                               # Cấu hình chung, constants, helpers
│   ├── config/                         # env config, API base URL, WebSocket URL
│   ├── constants/                      # BoardCoordinates, PieceTypes, SocketEvents, SoundKeys
│   └── utils/                          # FormatElo, DateTime, SoundPlayer
│
├── domain/                             # [TẦNG 1] DOMAIN: Nghiệp vụ cốt lõi & Luật cờ
│   ├── entities/                       # User, Room, Match, Move, Piece, Board, Friend, Message
│   ├── value-objects/                  # GameStatus, PlayerColor, Coordinate, Timer, RoomRole
│   └── repositories/                   # Giao diện: IAuthRepository, IRoomRepository, IGameGateway, IFriendRepository
│
├── application/                        # [TẦNG 2] APPLICATION: Use Cases & Custom Hooks kết nối UI
│   ├── use-cases/
│   │   ├── auth/                       # LoginUseCase, RegisterUseCase, ResetPasswordUseCase
│   │   ├── room/                       # CreateRoomUseCase, JoinRoomByLinkUseCase, LeaveRoomUseCase
│   │   ├── game/                       # MakeMoveUseCase, CalculateLegalMovesUseCase, SurrenderUseCase
│   │   └── friends/                    # InviteFriendUseCase, AcceptInviteUseCase
│   └── hooks/                          # useAuth, useGame, useLobby, useFriends, useSocket, useWebRTC
│
├── infrastructure/                     # [TẦNG 3] INFRASTRUCTURE: Hiện thực hóa kỹ thuật & Driver ngoài
│   ├── api/                            # Gọi REST API (Fetch/Axios): AuthApi, UserApi, RoomApi, FriendApi
│   ├── realtime/                       # SocketClient (WebSocket/Socket.io), WebRtcClient (Video Call)
│   ├── storage/                        # LocalStorageService (Token, Session)
│   └── sound/                          # Trình phát âm thanh nước cờ, ăn quân, chiếu tướng
│
└── presentation/                       # [TẦNG 4] PRESENTATION: Giao diện React
    ├── components/                     # UI Components chia theo tính năng
    │   ├── common/                     # Button, Input, Modal, Toast, Avatar, Badge, Spinner
    │   ├── board/                      # ChessBoard, PieceView, BoardCoordinates, MoveHistory
    │   ├── room/                       # RoomCard, PlayerSlot, SpectatorList, InviteModal
    │   ├── lobby/                      # RoomList, UserProfileBar, GameModeSelector
    │   └── chat/                       # ChatBox, MessageItem, EmojiPicker
    ├── layouts/                        # MainLayout, GameLayout, AuthLayout
    ├── pages/                          # LoginPage, RegisterPage, ForgotPasswordPage, LobbyPage, RoomPage, GamePage, ProfilePage
    ├── contexts/                       # AuthContext, SocketContext, NotificationContext
    └── routes/                         # AppRoutes, ProtectedRoute (chặn truy cập khi chưa đăng nhập)
```

---

## 💡 Ưu Điểm Khi Áp Dụng Clean Architecture Cho Frontend
1. **Dễ Kiểm Thử (Testability)**: Thuật toán kiểm tra nước đi hợp lệ của Tướng/Mã/Pháo (Domain) có thể test độc lập 100% bằng Jest/Node mà không cần render UI React.
2. **Độc Lập UI Framework**: Nếu sau này đổi thư viện UI (từ CSS thuần sang Tailwind hoặc chuyển sang React Native), toàn bộ logic Use Cases và Domain được giữ nguyên 100%.
3. **Phân Công Song Song (Nhóm 7 người)**:
   - Thành viên làm giao diện (FE UI) tập trung ở `presentation/components` và `presentation/pages`.
   - Thành viên làm luật cờ/realtime tập trung ở `domain/entities` và `application/use-cases/game`.

---

## Bàn cờ Match COT-615 / COT-616

`presentation/components/board/XiangqiBoard` nhận `pieces` dưới dạng mảng quân `{ id, color, type, position }`, trong đó `color` là `red` hoặc `black`, `type` là `general`, `advisor`, `elephant`, `horse`, `chariot`, `cannon` hoặc `soldier`, và `position` là tọa độ như `e0`. Khi máy chủ cấp vai trò người chơi và đang tới lượt, component hỗ trợ click chọn-đích và kéo-thả qua Pointer Events (chuột/cảm ứng). Chỉ quân được chọn được highlight; UI không render danh sách, marker hay vòng tròn gợi ý nước đi. Góc nhìn quân Đen đảo ánh xạ hiển thị, còn tọa độ gửi đi vẫn dùng hệ chuẩn `a0`–`i9`.

Màn hình tải snapshot qua `GET /api/matches/:matchId` và nhận trạng thái/đồng hồ/nước đi qua WebSocket `ws(s)://<host>/api/matches/:matchId/ws`. Client chỉ gửi `{ type: "move", from, to }`; server kiểm tra lượt, quyền phe và luật trước khi phát trạng thái mới. Trong lúc chờ phản hồi client khóa gửi nước đi tiếp. Lỗi không cập nhật bàn cờ; thông báo lỗi được hiển thị. Bàn cờ SVG dùng nhiều lớp màu/vân gỗ, bóng tiếp xúc và chi tiết vát sáng cho quân; nước đi trượt theo thay đổi tọa độ và ô đi gần nhất được đánh dấu nhẹ. Có thể bật góc nhìn phối cảnh nhẹ trong cài đặt; mặc định là nhìn thẳng để giữ tọa độ rõ. Âm thanh bước/ăn quân phát một lần khi `lastMove` thay đổi trong trạng thái được server broadcast, nên người chơi và khán giả cùng nhận âm thanh; có thể bật/tắt trong cài đặt trận. Khi `lastMove.captured` là `true`, bàn cờ phát hiệu ứng loé sáng, quân bị bắt co mờ dần và vòng va chạm tại ô đích; hiệu ứng chỉ chạy khi nhận nước mới, không chạy lại theo các bản cập nhật đồng hồ. Khay quân đã mất hiển thị các quân bị bắt kể từ lúc client kết nối; lịch sử trước khi vào trận không có trong giao thức hiện tại.

Giao diện cảnh báo Chiếu đọc `check` (boolean) và `checkedColor` (`red`/`black`) từ trạng thái server; nếu chỉ có `check: true`, bên bị chiếu được lấy từ `currentTurn`. Khi trạng thái mới báo `check: false`, cảnh báo và highlight được xóa. `moveResult.check` chỉ phản hồi riêng cho người vừa đi và cho phép giao diện của họ cập nhật ngay. Để mọi người chơi và khán giả cùng thấy/cập nhật cảnh báo đúng theo tiêu chí COT-621, backend cần broadcast các trường `check` và `checkedColor` trong mọi message `state`; backend demo hiện tại chưa broadcast các trường này.

Backend hiện cung cấp Match mẫu trong bộ nhớ cho `COT-615`; trạng thái được khởi tạo lại khi tiến trình backend khởi động. Để thử nghiệm, hai kết nối WebSocket đầu tiên được cấp lần lượt phe Đỏ và Đen, các kết nối khác là khán giả. Đây **không phải xác thực danh tính**; không dùng cơ chế cấp phe mẫu này cho production. Trận mẫu chưa nối vào room lifecycle hoặc database. Thay thế cơ chế này bằng vai trò từ phiên đăng nhập/phòng thật trước khi triển khai production.
