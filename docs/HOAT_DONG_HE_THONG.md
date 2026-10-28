# Hệ thống Cờ Tướng hoạt động như thế nào

Tài liệu này giải thích ở mức khái niệm cách hệ thống vận hành: backend làm gì, dữ liệu đi qua mạng ra sao, và điều gì xảy ra khi mạng bị rớt. Tài liệu không đi vào chi tiết code. Khi cần, có thể mở các file được nhắc tới để xem thêm.

## 1. Tổng quan kiến trúc

Hệ thống gồm bốn phần chính:

- **Trình duyệt** (phần frontend): hiển thị bàn cờ, nhận thao tác của người chơi và gửi lên máy chủ.
- **Máy chủ backend**: một tiến trình Node.js duy nhất. Máy chủ giữ luật cờ, đồng hồ, kết quả và quyết định ai thắng.
- **PostgreSQL**: cơ sở dữ liệu lưu tài khoản, lịch sử ván đấu và các dữ liệu cần giữ lâu dài.
- **Bộ nhớ RAM của máy chủ**: giữ trạng thái các phòng đang chơi, vì cần đọc và ghi rất nhanh.

Trình duyệt và máy chủ giao tiếp qua hai kênh:

- **HTTP** (các đường dẫn `/api/...`): dùng cho những việc có dạng hỏi rồi trả lời, như đăng nhập, lấy danh sách phòng, tạo phòng, xem bạn bè.
- **WebSocket** (đường dẫn `/ws/room/<mã phòng>`): một kết nối mở liên tục giữa trình duyệt và máy chủ, dùng cho nước đi, chat, tín hiệu video và thông báo trạng thái ván.

Khi phát triển trên máy, Vite (công cụ chạy giao diện) đóng vai trò trung gian: trình duyệt gọi tới cổng 3000, Vite chuyển tiếp các đường dẫn `/api`, `/ws` và `/uploads` sang backend ở cổng 5000. Nhờ vậy trình duyệt coi như chỉ nói chuyện với một địa chỉ duy nhất. Chi tiết cấu hình xem trong [README](../README.md).

## 2. Backend hoạt động thế nào

### 2.1 Các nhóm chức năng

Các API HTTP được chia thành nhiều nhóm, mỗi nhóm lo một việc:

- **Xác thực (auth)**: đăng ký, đăng nhập, đăng nhập Google, quên mật khẩu và đặt lại mật khẩu.
- **Người dùng (user)**: xem và sửa thông tin cá nhân, đổi mật khẩu, đổi ảnh đại diện.
- **Phòng (rooms)**: tạo phòng, tìm phòng bằng mã, lấy danh sách phòng.
- **Bạn bè (friends)**: kết bạn, xem danh sách bạn bè, gửi lời mời chơi.
- **Chơi với máy (pve)**: tạo ván với máy, gửi nước đi, xem lịch sử ván.
- **Trận mẫu (matches)**: trận demo COT-615, chỉ mở khi bật chế độ demo.

### 2.2 Xác thực: đăng nhập và phiên làm việc

- Khi đăng nhập thành công, máy chủ cấp một **token** (JWT). Trình duyệt giữ token này và gửi kèm mỗi lần gọi API.
- Token có thời hạn. Máy chủ không chỉ tin vào chữ ký của token mà còn kiểm tra lại **phiên**: nếu người dùng đã đổi mật khẩu sau khi token được cấp, token cũ bị từ chối. Nếu tài khoản bị khoá, phiên cũng bị vô hiệu.
- Các kết nối WebSocket đang mở cũng được kiểm tra lại định kỳ, khoảng 30 giây một lần. Nếu phiên đã bị thu hồi, máy chủ đóng kết nối ngay với mã 1008 (lỗi chính sách), và trình duyệt hiểu đây là lỗi xác thực nên không tự kết nối lại.
- Token được gửi khi mở WebSocket qua phần tiêu đề giao thức (`Sec-WebSocket-Protocol`), không đặt trong địa chỉ URL. Lý do: địa chỉ URL dễ bị ghi vào nhật ký của máy chủ hoặc lịch sử trình duyệt.
- Mật khẩu được băm trước khi lưu. Mã đặt lại mật khẩu cũng chỉ lưu dưới dạng băm, dùng được một lần và hết hạn sau 15 phút.

### 2.3 Một ván PvP từ đầu đến cuối

Ván đấu giữa hai người chơi trong phòng đi qua các bước sau:

1. **Tạo phòng**: một người gọi API tạo phòng. Máy chủ tạo phòng trong RAM và trả về mã phòng. Mỗi người chỉ được giữ tối đa 20 phòng đang mở.
2. **Vào phòng**: người chơi mở WebSocket tới phòng. Máy chủ ghi nhận người này là người chơi (đỏ hoặc đen), hoặc khán giả nếu phòng đã đủ hai người chơi.
3. **Sẵn sàng**: mỗi người bấm sẵn sàng. Chủ phòng chỉ bắt đầu được khi cả hai đã sẵn sàng.
4. **Bắt đầu**: máy chủ tạo bàn cờ ban đầu, đặt đồng hồ mỗi bên 300 giây, và đặt thời gian cho lượt đầu tiên là 60 giây. Quân đỏ đi trước.
5. **Đi nước**: người chơi gửi nước đi qua WebSocket. Máy chủ kiểm tra nước đi có hợp luật không, cập nhật bàn cờ, rồi gửi trạng thái mới cho mọi người trong phòng. Máy chủ là **nguồn sự thật**: trình duyệt không tự quyết định một nước có hợp lệ hay không, cũng không tự tính đồng hồ.
6. **Kết thúc ván**: ván có thể kết thúc vì một trong các lý do sau:
   - bị chiếu bí (CHECKMATE),
   - không còn nước đi hợp lệ (NO_LEGAL_MOVES),
   - hết giờ (TIMEOUT),
   - một bên xin thua (RESIGN),
   - một bên mất kết nối quá lâu (DISCONNECT_TIMEOUT),
   - ván đạt giới hạn 300 nước mà chưa phân thắng bại: hoà (DRAW_PLY_LIMIT),
   - sự cố hệ thống khiến cả hai cùng mất kết nối (SYSTEM_ERROR), ván bị huỷ.
7. **Ghi kết quả**: với các ván có người thắng hoặc hoà, máy chủ tính lại điểm Elo cho cả hai người (hệ số K = 32, theo cách tính FIDE) rồi lưu kết quả vào cơ sở dữ liệu. Ván bị huỷ vì sự cố hệ thống thì **không** tính Elo.

### 2.4 Ván với máy (PvE)

Chơi với máy hoạt động đơn giản hơn PvP:

- Người chơi gửi nước đi bằng HTTP. Máy chủ kiểm tra nước đi, lưu nước đi vào cơ sở dữ liệu, rồi tính nước đi của máy và trả về ngay trong cùng một phản hồi. Nước đi và kết quả được lưu trong cùng một giao dịch, nên không có trạng thái "bàn cờ đã kết thúc nhưng ván vẫn ghi đang chơi".
- Mỗi lượt của người chơi có 60 giây. Hết giờ thì ván kết thúc.
- Một **bộ quét định kỳ** (sweeper) chạy mỗi 5 giây. Nó làm hai việc: cho máy đi nếu đến lượt máy mà máy chưa đi được (ví dụ do lỗi tạm thời), và xử thua khi người chơi hết giờ. Nhờ vậy ván không bị treo dù người chơi đã đóng trình duyệt.
- Mỗi người chỉ được có tối đa 3 ván với máy đang diễn ra.
- Trang chơi với máy có địa chỉ dạng `/?pveMatchId=<mã>`. Trang này hỏi máy chủ định kỳ vài giây một lần, và khi tải lại trang thì ván được tiếp tục từ đúng chỗ đang dở, vì mọi nước đi đều đã được lưu.

## 3. Mạng: HTTP, WebSocket, heartbeat và đồng hồ

### 3.1 Dùng HTTP hay WebSocket?

- **HTTP** phù hợp với các việc một lần, có yêu cầu và có phản hồi. Ví dụ: đăng nhập, lấy danh sách phòng.
- **WebSocket** phù hợp với việc cần máy chủ đẩy thông tin xuống ngay lập tức, mà trình duyệt không cần hỏi. Ví dụ: đối thủ vừa đi nước, có tin chat mới, đối thủ vừa rớt mạng.

### 3.2 Heartbeat: phát hiện kết nối chết

Một kết nối WebSocket có thể "chết" mà không báo gì (ví dụ điện thoại mất sóng, Wi-Fi đổi mạng). Để biết điều đó, máy chủ dùng **heartbeat**:

- Cứ mỗi 5 giây, máy chủ gửi một gói "ping" ở mức giao thức WebSocket. Trình duyệt tự động trả lời bằng "pong", không cần mã ứng dụng.
- Nếu quá 10 giây mà không nhận được phản hồi, máy chủ coi kết nối đã mất, đóng socket và ghi nhận lý do là hết thời gian heartbeat.

### 3.3 Đồng hồ do máy chủ giữ

Đồng hồ là thứ không được phép tin trình duyệt. Nếu để trình duyệt tự đếm, người chơi có thể gian lận bằng cách sửa mã hoặc chặn gói tin. Vì vậy:

- Máy chủ giữ thời gian còn lại của mỗi bên và thời gian của lượt hiện tại.
- Trình duyệt chỉ hiển thị số giây mà máy chủ gửi về. Phần đếm ngược trên màn hình chỉ là giao diện.
- Khi có nước đi, máy chủ trừ thời gian đã dùng khỏi đồng hồ của bên vừa đi.

### 3.4 Chat

- Tin nhắn tối đa 500 ký tự.
- Mỗi kết nối chỉ được gửi tối đa 5 tin trong 3 giây, để chống spam.
- Khán giả được xem nhưng không được chat (đây là quyết định của nhóm).

### 3.5 Video call bằng WebRTC

- Hình và tiếng **không đi qua máy chủ**. Hai trình duyệt tự truyền dữ liệu cho nhau trực tiếp, nên máy chủ không phải băng thông cho video.
- Máy chủ chỉ làm nhiệm vụ **chuyển tín hiệu**: giúp hai bên trao đổi thông tin để thiết lập kết nối (offer, answer và các ứng viên đường truyền ICE).
- Để hai trình duyệt tìm được đường đi tới nhau, dùng máy chủ **STUN** (giúp biết địa chỉ công khai). Khi không kết nối trực tiếp được (ví dụ mạng nằm sau NAT kiểu đối xứng), cần máy chủ **TURN** làm trung gian chuyển tiếp. Cấu hình được đặt trong biến môi trường `VITE_ICE_SERVERS`.
- Cuộc gọi đổ chuông quá 60 giây mà không ai trả lời thì tự huỷ.

### 3.6 Giới hạn tốc độ (rate limit)

Một số thao tác dễ bị lạm dụng để dò mật khẩu hoặc dò mã phòng nên có giới hạn số lần:

- **Đăng nhập sai**: tối đa 10 lần trong 15 phút cho mỗi địa chỉ IP. Ngoài ra, nếu một tên đăng nhập sai nhiều lần, hệ thống chỉ làm chậm phản hồi (tối đa khoảng 2 giây) chứ không khoá hẳn tài khoản, để kẻ xấu không thể khoá người khác.
- **Đăng ký**: tối đa 5 lần trong 1 giờ.
- **Tra mã phòng**: tối đa 30 lần mỗi phút.
- Với địa chỉ IPv6, giới hạn tính theo khối /64, vì một người dùng thường có cả một dải địa chỉ và có thể đổi địa chỉ để né giới hạn.

## 4. Khi rớt mạng: phía frontend (trình duyệt)

### 4.1 Phát hiện mất kết nối

Trình duyệt biết mình mất kết nối theo ba cách:

- WebSocket bị đóng, hoặc có lỗi.
- Trình duyệt phát sự kiện "offline" khi mất mạng hẳn.
- Không nhận được heartbeat từ máy chủ trong một khoảng thời gian (xem mục 3.2).

### 4.2 Việc đầu tiên: khoá bàn cờ

Khi phát hiện mất kết nối, giao diện **khoá bàn cờ**, không cho người chơi đi nước. Lý do: nếu cho đi trong lúc mất mạng, nước đi có thể bị gửi đi lệch với trạng thái thật trên máy chủ. Giao diện hiển thị trạng thái "đang kết nối lại" để người chơi biết chuyện gì đang xảy ra.

### 4.3 Tự kết nối lại

- Trình duyệt thử kết nối lại theo kiểu **backoff** (thời gian chờ tăng dần): lần đầu chờ khoảng 0,5 giây, các lần sau chờ gấp đôi, nhưng không quá 5 giây.
- Mỗi lần chờ có **jitter** (một phần ngẫu nhiên). Nếu nhiều người cùng rớt mạng và cùng thử lại đúng một thời điểm, máy chủ sẽ bị quá tải. Ngẫu nhiên hoá giúp các lần thử lệch nhau.
- Khi trình duyệt báo lại là đã có mạng (sự kiện "online"), trình duyệt thử kết nối **ngay**, không chờ hết thời gian backoff. Tuy nhiên, trình duyệt chỉ mở khoá bàn cờ khi WebSocket thực sự đã mở. Việc báo "online" chưa chắc là kết nối đã sống lại.

### 4.4 Khi nào thì dừng hẳn

Không phải lỗi nào cũng nên thử lại. Trình duyệt **dừng hẳn**, không thử lại, khi máy chủ đóng kết nối với các mã:

- 1008: chính sách bị vi phạm, thường là phiên đăng nhập đã bị thu hồi.
- 4001: không vào được phòng (phòng đầy hoặc không hợp lệ).
- 4003: bị chủ phòng đá khỏi phòng.

Với lỗi HTTP, các mã 4xx (trừ 408 và 429) cũng được coi là lỗi không nên thử lại. Mã 4008 (heartbeat hết thời gian) thì ngược lại: đây là mất mạng thoáng qua, nên trình duyệt vẫn thử lại.

### 4.5 Đồng bộ lại sau khi nối lại

Khi kết nối được khôi phục, máy chủ gửi cho trình duyệt một **bản chụp trạng thái** của ván: bàn cờ, quân đã bị ăn, đồng hồ, lượt đi, và có đang bị chiếu hay không. Trình duyệt dựng lại bàn cờ từ bản chụp này, nên không cần giữ lại lịch sử các nước đã trôi qua. Đây là lý do bàn cờ đồng bộ đúng dù người chơi đã rớt mạng vài giây.

Trình duyệt cũng bỏ qua mọi tin nhắn đến từ socket cũ đã bị thay thế. Nhờ vậy một kết nối cũ đến muộn không ghi đè trạng thái mới.

### 4.6 Video call khi rớt mạng

Cuộc gọi video kết thúc khi kết nối WebRTC báo lỗi (failed), hoặc khi đối phương rời cuộc gọi. Phía máy chủ, khi WebSocket của một người bị đóng, máy chủ coi như người đó đã rời cuộc gọi và báo cho bên còn lại với lý do đối thủ mất kết nối. Vì vậy dù hình và tiếng đi trực tiếp giữa hai trình duyệt, rớt tín hiệu WebSocket vẫn làm cuộc gọi kết thúc.

## 5. Khi rớt mạng: phía backend (máy chủ)

### 5.1 Máy chủ phát hiện thế nào

Máy chủ biết người chơi rớt mạng theo hai cách: heartbeat không được trả lời trong 10 giây, hoặc socket bị đóng. Lúc này máy chủ **không kết thúc ván ngay**. Một người rớt mạng vài giây là chuyện rất thường gặp (chuyển từ Wi-Fi sang 4G, vào đường hầm...), nên hệ thống cho một khoảng thời gian để quay lại.

### 5.2 Tạm dừng ván và trừ thời gian

- Ván được **tạm dừng**. Đồng hồ không chạy nữa.
- Máy chủ tính thời gian đã dùng của lượt đang chạy và trừ khỏi đồng hồ tổng của bên đang đi. Phần thời gian còn lại của lượt được lưu lại. Khi quay lại, lượt không được reset về 60 giây mới, nên người chơi không được lợi từ việc rớt mạng.
- Máy chủ bắt đầu **đếm ngược 60 giây** riêng cho bên vừa rớt. Mỗi bên có bộ đếm riêng, nên nếu cả hai cùng rớt, hai bộ đếm chạy độc lập.
- Máy chủ thông báo cho mọi người trong phòng (đối thủ và khán giả) rằng một người vừa mất kết nối và còn bao nhiêu giây để quay lại.

### 5.3 Tình huống: quay lại kịp

Nếu người chơi kết nối lại trong 60 giây:

- Máy chủ huỷ bộ đếm của bên đó.
- Gửi cho người vừa quay lại bản chụp trạng thái ván (xem mục 4.5).
- Ván tiếp tục từ đúng chỗ đã dừng, với thời gian còn lại.

### 5.4 Tình huống: quá 60 giây không quay lại

- Máy chủ coi như bên đó **thua** vì mất kết nối quá thời gian quy định, lý do là DISCONNECT_TIMEOUT.
- Ván được kết thúc theo đúng quy trình ghi kết quả: tính Elo và lưu vào cơ sở dữ liệu.
- Ghế của người rớt mạng được giải phóng.

### 5.5 Tình huống: cả hai cùng rớt

Đây là trường hợp khó nhất, và hệ thống xử lý như sau:

- Mỗi bên có cửa sổ 60 giây riêng. Nếu bên A hết hạn trước mà bên B vẫn còn trong cửa sổ của mình, ván **chưa bị huỷ**. Máy chủ đánh dấu bên A đã hết hạn và chờ.
- Nếu bên B quay lại kịp, B thắng vì A không quay lại trong thời gian quy định.
- Nếu cả hai đều hết hạn mà không ai quay lại, ván bị **huỷ** với lý do SYSTEM_ERROR. Không ai thắng và **không tính Elo**, vì lỗi nằm ở phía hệ thống chứ không phải ở người chơi.

### 5.6 Ghế và chủ phòng

- Khi một người vừa vào phòng qua HTTP nhưng chưa mở WebSocket, ghế của họ được giữ khoảng 30 giây. Hết thời gian mà vẫn chưa kết nối thì ghế được trả lại cho người khác.
- Nếu chủ phòng rời đi khi ván chưa bắt đầu, quyền chủ phòng được chuyển cho người khác trong phòng.

### 5.7 Máy chủ khởi động lại

Nếu máy chủ bị tắt hoặc khởi động lại, **toàn bộ phòng và ván đang chơi trong RAM sẽ mất**. Đây là hạn chế đã biết của thiết kế hiện tại (xem mục 6). Ván PvP chưa kết thúc sẽ không được khôi phục, còn ván với máy thì không bị mất vì mỗi nước đã được lưu vào cơ sở dữ liệu.

Tóm tắt dòng thời gian khi một người rớt mạng giữa ván PvP:

| Thời điểm | Điều gì xảy ra |
|---|---|
| 0 giây | Socket đóng hoặc heartbeat không được trả lời |
| Tới 10 giây | Máy chủ coi là mất kết nối, tạm dừng ván, bắt đầu đếm ngược 60 giây, báo cho cả phòng |
| Trong 60 giây | Nếu quay lại: gửi bản chụp, ván tiếp tục với thời gian còn lại |
| Sau 60 giây | Nếu chưa quay lại: đối thủ thắng (DISCONNECT_TIMEOUT), tính Elo |

Phía trình duyệt của người rớt mạng, trong lúc đó: khoá bàn cờ, thử kết nối lại theo backoff, và đồng bộ lại khi nối được.

## 6. Bộ nhớ (RAM) và cơ sở dữ liệu

Hệ thống chia dữ liệu thành hai nơi, với mục đích khác nhau.

### 6.1 Những gì nằm trong RAM của máy chủ

RAM được dùng vì các thông tin này thay đổi liên tục và cần đọc ghi rất nhanh:

- **Phòng PvP** và trạng thái ván: bàn cờ, đồng hồ, lượt đi, người chơi trong phòng.
- **Kết nối WebSocket**: ai đang kết nối, với phòng nào, với vai trò gì.
- **Người đang online** và **lời mời trực tiếp** giữa hai người.
- **Bộ đếm giới hạn tốc độ** (rate limit): mỗi khoá có danh sách thời điểm đã thử. Tối đa 10 000 khoá được theo dõi.
- **Cache chống tạo phòng trùng**: nếu cùng một yêu cầu tạo phòng gửi lại trong vòng 3 giây, máy chủ trả lại kết quả cũ thay vì tạo thêm phòng.
- **Bộ đếm thời gian**: đếm ngược mất kết nối, heartbeat, bộ đếm lượt đi.
- **Bộ nhớ tạm kiểm tra phiên**: ghi lần cuối đã kiểm tra phiên của mỗi token, để không kiểm tra quá dày.

Các thông tin này được dọn định kỳ để bộ nhớ không phình mãi:

- Phòng không còn ai sau 30 phút thì bị xoá. Phòng đã kết thúc sau 60 phút thì bị xoá. Phòng còn có người kết nối thì không bao giờ bị xoá.
- Bộ quét phòng chạy mỗi 60 giây.
- Lời mời trực tiếp quá 60 giây thì hết hạn.
- Bộ quét ván với máy chạy mỗi 5 giây.

**Mất khi khởi động lại**: toàn bộ những gì trên đây. Người dùng phải đăng nhập lại, phòng và ván PvP đang chơi không còn.

### 6.2 Những gì nằm trong PostgreSQL

Cơ sở dữ liệu giữ những gì cần tồn tại lâu dài:

- **Người dùng**: thông tin tài khoản, điểm Elo, trạng thái tài khoản, thời điểm đổi mật khẩu gần nhất (dùng để vô hiệu token cũ).
- **Vai trò người dùng** và **định danh OAuth** (liên kết với tài khoản Google).
- **Mã đặt lại mật khẩu**: lưu dưới dạng băm, dùng được một lần, hết hạn sau 15 phút.
- **Mã OTP**: mã 6 số dùng trong luồng quên mật khẩu.
- **Bạn bè**.
- **Ván với máy**: thông tin ván và từng nước đi. Mỗi nước được lưu cùng lúc với việc cập nhật trạng thái ván, trong một giao dịch, nên dữ liệu luôn nhất quán.
- **Ván PvP**: kết quả ván đã kết thúc, gồm cả hai người chơi và lý do kết thúc. Chỉ ghi khi ván kết thúc.

Một số điểm về cách làm việc với cơ sở dữ liệu:

- Các file migration (trong thư mục `backend/src/migrations`) tạo và sửa bảng theo thứ tự. Mỗi file chạy trong một giao dịch riêng, và việc ghi lịch sử migration nằm trong cùng giao dịch đó. Nếu một file lỗi thì không có gì bị ghi dở.
- Khi chạy migration, máy chủ dùng **khoá tư vấn** (advisory lock) của PostgreSQL để đảm bảo nếu có hai tiến trình cùng chạy thì chỉ một tiến trình thực hiện, tiến trình kia chờ rồi kiểm tra lại.
- Bộ test của backend không cần PostgreSQL. Test dùng cơ sở dữ liệu SQLite nằm trong bộ nhớ, nên chạy nhanh và độc lập.

### 6.3 Vì sao chia như vậy

Điểm chung của hai nơi: RAM nhanh nhưng mất khi tắt máy chủ, còn cơ sở dữ liệu chậm hơn một chút nhưng bền. Vì vậy, thông tin cần cho việc chơi theo thời gian thực (bàn cờ, đồng hồ) để trong RAM, còn kết quả và dữ liệu tài khoản đi vào cơ sở dữ liệu. Với ván PvP, kết quả chỉ ghi khi ván kết thúc. Với ván PvE, mỗi nước được ghi ngay, nên ván có thể được tiếp tục sau khi tải lại trang hoặc khởi động lại máy chủ.

## 7. Bảng tóm tắt các con số chính

| Nội dung | Giá trị |
|---|---|
| Heartbeat: gửi ping | mỗi 5 giây |
| Heartbeat: coi là mất kết nối | sau 10 giây không có phản hồi |
| Kiểm tra lại phiên của kết nối đang mở | khoảng 30 giây một lần |
| Cửa sổ kết nối lại (mỗi bên) | 60 giây |
| Thời gian mỗi lượt đi (PvP và PvE) | 60 giây |
| Tổng đồng hồ mỗi bên (PvP) | 300 giây |
| Giới hạn số nước, hoà khi đạt | 300 nước (ply) |
| Backoff khi kết nối lại (frontend) | từ 0,5 giây, tăng gấp đôi, tối đa 5 giây, có jitter |
| Đồng hồ mỗi bên của trận demo COT-615 | 600 giây (có thể đổi, từ 30 đến 3600) |
| Ván demo mới sau khi ván trước kết thúc | sau 10 giây |
| Phòng trống bị xoá | sau 30 phút |
| Phòng đã kết thúc bị xoá | sau 60 phút |
| Số phòng tối đa mỗi người | 20 |
| Mã phòng công khai | 6 chữ số |
| Mã phòng riêng tư | 10 ký tự |
| Giữ ghế khi đã vào phòng qua HTTP nhưng chưa mở WebSocket | khoảng 30 giây |
| Ván với máy đang diễn ra tối đa | 3 ván mỗi người |
| Bộ quét ván với máy | mỗi 5 giây |
| Chat: độ dài tối đa | 500 ký tự |
| Chat: giới hạn tốc độ | 5 tin trong 3 giây mỗi kết nối |
| Đổ chuông cuộc gọi video | tối đa 60 giây |
| Đăng nhập sai | 10 lần trong 15 phút mỗi IP |
| Đăng ký | 5 lần mỗi giờ |
| Tra mã phòng | 30 lần mỗi phút |
| Mã đặt lại mật khẩu | dùng một lần, hết hạn sau 15 phút |
| Elo | khởi điểm 1000, hệ số K = 32 |
