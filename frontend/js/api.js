/**
 * Kỳ Đạo Online - Room API Service (COT-597)
 * Xử lý giao tiếp API phòng chơi, kiểm tra mã phòng và đồng bộ thời gian thực.
 */

const ROOM_STATUS = {
  WAITING_OPPONENT: {
    key: 'WAITING_OPPONENT',
    label: 'Đang chờ đối thủ',
    className: 'status-waiting',
    icon: '⏳'
  },
  FULL_PLAYERS: {
    key: 'FULL_PLAYERS',
    label: 'Đã đủ hai người',
    className: 'status-full',
    icon: '👥'
  },
  PLAYING: {
    key: 'PLAYING',
    label: 'Đang diễn ra',
    className: 'status-playing',
    icon: '⚔️'
  },
  WAITING_NEW_GAME: {
    key: 'WAITING_NEW_GAME',
    label: 'Chờ ván mới',
    className: 'status-rematch',
    icon: '🔄'
  },
  CLOSED: {
    key: 'CLOSED',
    label: 'Đã đóng',
    className: 'status-closed',
    icon: '🚫'
  }
};

// Dữ liệu mock ban đầu mô phỏng danh sách Public Rooms từ Backend
const INITIAL_PUBLIC_ROOMS = [
  {
    id: 1,
    code: '102938',
    name: 'Kỳ Viện Thăng Long - Đấu tập giao hữu',
    hostName: 'Trần Đại Nghĩa',
    hostAvatar: '陳',
    hostElo: 1350,
    status: 'WAITING_OPPONENT',
    isPublic: true,
    playerCount: 1,
    maxPlayers: 2,
    spectatorCount: 0,
    timeLimit: '15 phút + 10s',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  },
  {
    id: 2,
    code: '654321',
    name: 'Quán Thư Họa - Thuận Pháo đối Bình Phong Mã',
    hostName: 'Lê Văn Tám',
    hostAvatar: '黎',
    hostElo: 1420,
    status: 'FULL_PLAYERS',
    isPublic: true,
    playerCount: 2,
    maxPlayers: 2,
    spectatorCount: 1,
    timeLimit: '20 phút',
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
  },
  {
    id: 3,
    code: '789102',
    name: 'Giải Đấu Mùa Thu - Chung kết Bảng A',
    hostName: 'Nguyễn Tấn Sang',
    hostAvatar: '桑',
    hostElo: 1510,
    status: 'PLAYING',
    isPublic: true,
    playerCount: 2,
    maxPlayers: 2,
    spectatorCount: 5,
    timeLimit: '25 phút + 30s',
    createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
  },
  {
    id: 4,
    code: '456789',
    name: 'Bàn Đấu Tái Hiện Ván Cờ Thế',
    hostName: 'Phạm Hồng Thái',
    hostAvatar: '范',
    hostElo: 1200,
    status: 'WAITING_NEW_GAME',
    isPublic: true,
    playerCount: 2,
    maxPlayers: 2,
    spectatorCount: 2,
    timeLimit: '10 phút',
    createdAt: new Date(Date.now() - 40 * 60 * 1000).toISOString()
  },
  {
    id: 5,
    code: '334455',
    name: 'Giao Lưu Cao Thủ Cờ Tướng Sài Gòn',
    hostName: 'Vũ Trọng Phụng',
    hostAvatar: '武',
    hostElo: 1600,
    status: 'WAITING_OPPONENT',
    isPublic: true,
    playerCount: 1,
    maxPlayers: 2,
    spectatorCount: 0,
    timeLimit: '15 phút',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
  }
];

// Dữ liệu mock ban đầu mô phỏng danh sách Bạn bè của người dùng (COT-599)
const INITIAL_FRIENDS = [
  { id: 'f-1', username: 'tranductai', displayName: 'Trần Đức Tài', elo: 1320, isOnline: true },
  { id: 'f-2', username: 'truongviethiep', displayName: 'Trương Viết Hiệp', elo: 1400, isOnline: true },
  { id: 'f-3', username: 'nguyennhattruong', displayName: 'Nguyễn Nhật Trường', elo: 1210, isOnline: false },
  { id: 'f-4', username: 'nguyenquochung', displayName: 'Nguyễn Quốc Hưng', elo: 1180, isOnline: true },
  { id: 'f-5', username: 'lethanhquan', displayName: 'Lê Thành Quân', elo: 1290, isOnline: false }
];

class RoomApiService {
  constructor() {
    this.baseUrl = '/api/rooms';
    // Sử dụng in-memory mock store
    this.roomsStore = JSON.parse(JSON.stringify(INITIAL_PUBLIC_ROOMS));
    this.friendsStore = JSON.parse(JSON.stringify(INITIAL_FRIENDS));
    this.pendingInvitations = new Map(); // invitationId -> invData
    this.realtimeListeners = [];
    // FE-03: mặc định KHÔNG có ai đăng nhập. Trước đây hardcode user
    // "Nguyễn Tấn Sang" với isLoggedIn: true -> mở trang là thấy như đã đăng nhập.
    this.currentUser = null;
  }

  /**
   * Lấy thông tin người dùng đang đăng nhập
   */
  getCurrentUser() {
    // FE-03: chỉ cần có user là coi như đã đăng nhập; trước đây còn đòi field
    // isLoggedIn nên user thật trả về từ API luôn bị coi là khách.
    if (!this.currentUser) return null;
    const elo = Number.isFinite(Number(this.currentUser.elo))
      ? Number(this.currentUser.elo)
      : (Number.isFinite(Number(this.currentUser.eloRating)) ? Number(this.currentUser.eloRating) : 1000);
    return {
      ...this.currentUser,
      isLoggedIn: true,
      elo
    };
  }

  /**
   * Thiết lập thông tin người dùng (null = đăng xuất / chưa đăng nhập)
   */
  setCurrentUser(user) {
    this.currentUser = user
      ? { ...user, isLoggedIn: true }
      : null;
  }

  /**
   * Tạo phòng chơi mới (Công khai hoặc Riêng tư) - COT-598
   * Tiêu chí chấp nhận 1: Form có Tên Room và lựa chọn Công khai/Riêng tư.
   * Tiêu chí chấp nhận 2: Không gửi request nếu Tên Room để trống hoặc không hợp lệ.
   * Tiêu chí chấp nhận 3: Không tạo nhiều phòng do bấm liên tục.
   * Tiêu chí chấp nhận 4: Tạo thành công đưa người dùng vào phòng với vai trò Chủ phòng.
   */
  async createRoom({ name, isPrivate = false, password = null, maxSpectators = 10 } = {}) {
    // 1. Chỉ cho phép người dùng đã đăng nhập tạo phòng
    const user = this.getCurrentUser();
    if (!user) {
      const err = new Error('Yêu cầu đăng nhập để tạo phòng.');
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    // 2. Kiểm tra Tên Room (bắt buộc, không để trống, kiểm tra độ dài 3-50 ký tự)
    if (name === undefined || name === null || typeof name !== 'string') {
      const err = new Error('Tên phòng không được để trống.');
      err.code = 'INVALID_NAME';
      throw err;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      const err = new Error('Tên phòng không được để trống.');
      err.code = 'INVALID_NAME';
      throw err;
    }

    if (trimmedName.length < 3 || trimmedName.length > 50) {
      const err = new Error('Tên phòng phải có độ dài từ 3 đến 50 ký tự.');
      err.code = 'INVALID_NAME_LENGTH';
      throw err;
    }

    // 3. Sinh mã phòng 6 chữ số duy nhất
    let code;
    let attempts = 0;
    do {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      attempts++;
    } while (this.roomsStore.some(r => r.code === code) && attempts < 100);

    const isPublic = !Boolean(isPrivate);
    const newRoom = {
      code,
      name: trimmedName,
      hostId: user.id || 'user-host',
      hostName: user.displayName || user.username || 'Chủ phòng',
      hostElo: user.elo || 1200,
      opponentId: null,
      opponentName: null,
      status: 'WAITING_OPPONENT',
      playerCount: 1,
      maxPlayers: 2,
      spectatorCount: 0,
      maxSpectators,
      timeControl: '15m + 10s',
      isPublic,
      isPrivate: Boolean(isPrivate),
      password: password && String(password).trim() ? String(password).trim() : null,
      createdAt: new Date().toISOString()
    };

    this.roomsStore.unshift(newRoom);

    // Phát sự kiện realtime cho sảnh chờ nếu là phòng công khai
    if (isPublic) {
      const eventPayload = {
        type: 'ROOM_CREATED',
        room: newRoom,
        roomCode: code
      };
      this.realtimeListeners.forEach(listener => {
        try { listener(eventPayload); } catch (e) { console.error(e); }
      });
    }

    return {
      success: true,
      message: 'Tạo phòng cờ thành công.',
      room: newRoom,
      role: 'HOST',
      roleMessage: 'Bạn là Chủ phòng! Vị trí Đối thủ đang trống, hãy mời kỳ thủ vào thi đấu.'
    };
  }

  /**
   * Lấy danh sách các Room Công khai (Public Rooms)
   * Tiêu chí chấp nhận 1: Danh sách hiển thị đúng các Room Public và trạng thái.
   * Lọc bỏ room đã đóng (CLOSED).
   */
  async getPublicRooms() {
    try {
      // Giả lập độ trễ mạng nhẹ nếu cần
      return this.roomsStore.filter(room => room.isPublic && room.status !== 'CLOSED');
    } catch (error) {
      console.error('Lỗi khi tải danh sách phòng:', error);
      throw new Error('Không thể tải danh sách phòng từ máy chủ.');
    }
  }

  /**
   * Tham gia phòng bằng mã 6 chữ số
   * Tiêu chí chấp nhận 3: Nhập đúng mã 6 số tham gia phòng thành công.
   * Tiêu chí chấp nhận 4: Hiển thị lỗi rõ ràng khi phòng không tồn tại hoặc đã đóng.
   * @param {string} roomCode - Mã phòng 6 ký tự số
   */
  async joinRoomByCode(roomCode) {
    if (!roomCode || typeof roomCode !== 'string') {
      throw new Error('Mã phòng không được để trống.');
    }

    const trimmedCode = roomCode.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      throw new Error('Mã phòng phải bao gồm đúng 6 chữ số (0-9).');
    }

    // Tìm phòng trong store
    const room = this.roomsStore.find(r => r.code === trimmedCode);

    if (!room) {
      throw new Error(`Phòng mang mã [${trimmedCode}] không tồn tại trên hệ thống.`);
    }

    if (room.status === 'CLOSED') {
      throw new Error(`Phòng [${trimmedCode}] đã đóng hoặc đã bị hủy.`);
    }

    // Phân vai trò dựa theo trạng thái phòng
    let assignedRole = 'PLAYER';
    let roleMessage = 'Bạn được phân vào ghế Người Chơi 2 để thi đấu!';

    if (room.status === 'WAITING_OPPONENT') {
      assignedRole = 'PLAYER';
      roleMessage = 'Bạn đã sẵn sàng ở vị trí Người Chơi 2!';
    } else if (['FULL_PLAYERS', 'PLAYING', 'WAITING_NEW_GAME'].includes(room.status)) {
      assignedRole = 'SPECTATOR';
      roleMessage = 'Phòng đã đủ 2 kỳ thủ. Bạn tham gia với vai trò Khán Giả theo dõi!';
    }

    return {
      success: true,
      room,
      role: assignedRole,
      roleMessage
    };
  }

  /**
   * Đăng ký callback khi trạng thái phòng thay đổi theo thời gian thực
   * Tiêu chí chấp nhận 2: Khi trạng thái thay đổi, giao diện cập nhật theo Backend.
   */
  onRealtimeUpdate(callback) {
    if (typeof callback === 'function') {
      this.realtimeListeners.push(callback);
    }
  }

  /**
   * Giả lập sự kiện Backend phát tín hiệu đổi trạng thái phòng (Realtime Event)
   * Dùng cho test và demonstration
   */
  emitRoomStateChange(roomCode, newStatus, additionalData = {}) {
    const roomIndex = this.roomsStore.findIndex(r => r.code === roomCode);
    if (roomIndex !== -1) {
      this.roomsStore[roomIndex].status = newStatus;
      Object.assign(this.roomsStore[roomIndex], additionalData);

      const eventPayload = {
        type: newStatus === 'CLOSED' ? 'ROOM_CLOSED' : 'ROOM_UPDATED',
        room: this.roomsStore[roomIndex],
        roomCode
      };

      this.realtimeListeners.forEach(listener => listener(eventPayload));
    }
  }

  /**
   * ===================================================================
   * COT-599: Giao diện Danh sách bạn bè và nút Chia sẻ liên kết mời phòng
   * ===================================================================
   */

  /**
   * Lấy danh sách bạn bè của người dùng (kèm trạng thái Trực tuyến/Ngoại tuyến)
   * Tiêu chí chấp nhận 1: Danh sách bạn bè hiển thị đúng trạng thái Trực tuyến/Ngoại tuyến.
   */
  async getFriendsList() {
    return JSON.parse(JSON.stringify(this.friendsStore));
  }

  /**
   * Thiết lập trạng thái Online/Offline cho bạn bè (dùng cho test / realtime presence)
   */
  setFriendOnlineStatus(friendId, isOnline) {
    const friend = this.friendsStore.find(f => f.id === friendId);
    if (friend) {
      friend.isOnline = Boolean(isOnline);
    }
  }

  /**
   * Gửi lời mời bạn bè vào phòng cờ trực tiếp
   * Tiêu chí chấp nhận 1: Chỉ cho phép gửi lời mời tới bạn bè đang Trực tuyến.
   * Tiêu chí chấp nhận 2: Gửi lời mời hiển thị đếm ngược 60 giây cho Chủ phòng.
   * Tiêu chí chấp nhận 3: Giao diện KHÔNG được khóa hay giữ trước vị trí Đối thủ khi đang chờ phản hồi.
   * @param {string} friendId - ID bạn bè nhận lời mời
   * @param {string} roomCode - Mã phòng 6 ký tự
   */
  async sendFriendInvitation(friendId, roomCode) {
    if (!friendId) {
      throw new Error('Vui lòng chọn bạn bè để gửi lời mời.');
    }

    const friend = this.friendsStore.find(f => f.id === friendId);
    if (!friend) {
      throw new Error('Người bạn này không tồn tại trong danh sách bạn bè.');
    }

    // Phạm vi: Chỉ cho phép bấm Mời với bạn bè đang Trực tuyến
    if (!friend.isOnline) {
      const err = new Error(`Kỳ thủ "${friend.displayName}" hiện đang Ngoại tuyến, không thể nhận lời mời.`);
      err.code = 'FRIEND_OFFLINE';
      throw err;
    }

    if (!roomCode) {
      throw new Error('Mã phòng không hợp lệ.');
    }

    const room = this.roomsStore.find(r => r.code === roomCode);
    if (!room) {
      throw new Error(`Không tìm thấy phòng cờ với mã [${roomCode}].`);
    }

    if (room.status === 'CLOSED') {
      throw new Error(`Phòng [${roomCode}] đã đóng, không thể gửi lời mời.`);
    }

    const invitationId = `inv_${Date.now()}_${friendId}`;
    const expiresAt = Date.now() + 60 * 1000; // TTL 60 giây

    const invitation = {
      id: invitationId,
      friendId,
      friendName: friend.displayName,
      roomCode,
      status: 'PENDING',
      countdown: 60,
      expiresAt,
      createdAt: new Date().toISOString()
    };

    this.pendingInvitations.set(invitationId, invitation);

    // Tiêu chí 3: KHÔNG giữ chỗ Đối thủ cho người được mời (room.opponentId vẫn giữ nguyên null)
    // Người khác vẫn có thể vào hoặc ghế đấu vẫn ở trạng thái trống.

    return {
      success: true,
      message: `Đã gửi lời mời tới "${friend.displayName}"!`,
      invitation
    };
  }

  /**
   * Hủy lời mời trực tiếp khi đang chờ phản hồi
   * Phạm vi: Có nút Hủy lời mời cho Chủ phòng khi lời mời còn đang chờ.
   */
  async cancelFriendInvitation(invitationId) {
    if (!invitationId) {
      throw new Error('Mã lời mời không hợp lệ.');
    }

    const exists = this.pendingInvitations.has(invitationId);
    if (exists) {
      this.pendingInvitations.delete(invitationId);
    }

    return {
      success: true,
      message: 'Đã hủy lời mời thành công.'
    };
  }

  /**
   * Lấy thông tin lời mời đang chờ (kiểm tra còn hiệu lực 60s không)
   */
  getPendingInvitation(invitationId) {
    const inv = this.pendingInvitations.get(invitationId);
    if (!inv) return null;

    if (Date.now() > inv.expiresAt) {
      this.pendingInvitations.delete(invitationId);
      return null;
    }

    const remainingSec = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 1000));
    return {
      ...inv,
      countdown: remainingSec
    };
  }

  /**
   * Sinh liên kết và công cụ chia sẻ phòng chơi
   * Tiêu chí chấp nhận 4: Sao chép link và mã phòng hoạt động tốt, mở sẵn app MXH.
   * @param {string} roomCode - Mã phòng 6 chữ số
   */
  generateShareLinks(roomCode) {
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) 
      ? window.location.origin 
      : 'https://cotuong69.vn';

    const cleanCode = String(roomCode).replace(/^#/, '').trim();
    const shareUrl = `${origin}/room/${cleanCode}`;

    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedTitle = encodeURIComponent(`Giao lưu Cờ Tướng cùng tôi tại phòng cờ #${cleanCode} trên Kỳ Đạo Online!`);

    return {
      code: cleanCode,
      url: shareUrl,
      facebookUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      messengerUrl: `fb-messenger://share?link=${encodedUrl}`,
      zaloUrl: `https://zalo.me/share?url=${encodedUrl}&title=${encodedTitle}`
    };
  }

  // =========================================================================
  // COT-603: Xử lý luồng tự động tham gia phòng khi người dùng mở liên kết mời
  // =========================================================================

  /**
   * Lưu thông tin phòng cần vào trong phiên (sessionStorage & in-memory)
   */
  savePendingRoomInvite(roomCode) {
    if (!roomCode) return;
    const cleanCode = String(roomCode).replace(/^#/, '').trim();
    this.sessionPendingInvite = cleanCode;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem('cotuong_pending_room_invite', cleanCode);
      } catch (e) {
        console.warn('Lỗi ghi sessionStorage:', e);
      }
    }
  }

  /**
   * Lấy thông tin phòng đã lưu trong phiên
   */
  getPendingRoomInvite() {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const stored = window.sessionStorage.getItem('cotuong_pending_room_invite');
        if (stored) return stored;
      } catch (e) {}
    }
    return this.sessionPendingInvite || null;
  }

  /**
   * Xóa thông tin phòng đã lưu trong phiên sau khi hoàn tất xử lý
   */
  clearPendingRoomInvite() {
    this.sessionPendingInvite = null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem('cotuong_pending_room_invite');
      } catch (e) {}
    }
  }

  /**
   * Phân tích và trích xuất mã phòng từ đường dẫn hoặc URL bất kỳ
   * Hỗ trợ các định dạng:
   *  - /room/:code
   *  - https://domain.com/room/:code
   *  - ?roomCode=:code hoặc ?room=:code
   *  - #/room/:code
   */
  extractRoomCodeFromUrl(urlOrPath) {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;

    // 1. Dạng /room/123456 hoặc /room/123456?abc=1
    const matchPath = urlOrPath.match(/\/room\/(\d{6})(?:[/?#]|$)/i);
    if (matchPath) return matchPath[1];

    // 2. Dạng query parameter ?roomCode=123456 hoặc ?room=123456
    const matchQuery = urlOrPath.match(/[?&](?:roomCode|room|code)=(\d{6})(?:[&?#]|$)/i);
    if (matchQuery) return matchQuery[1];

    // 3. Nếu truyền trực tiếp mã 6 số
    const cleanCode = urlOrPath.trim();
    if (/^\d{6}$/.test(cleanCode)) return cleanCode;

    return null;
  }

  /**
   * COT-603 AC 1: Xử lý khi người dùng mở đường dẫn mời vào phòng (`/room/:code`)
   * - Nếu đã đăng nhập: Tiếp tục luồng tham gia phòng bình thường.
   * - Nếu chưa đăng nhập: Chuyển hướng tới màn hình Đăng nhập, lưu lại phòng trong phiên.
   */
  async handleOpenRoomLink(urlOrPath) {
    const roomCode = this.extractRoomCodeFromUrl(urlOrPath);
    if (!roomCode) {
      const err = new Error('Đường dẫn phòng không hợp lệ hoặc mã phòng không đúng định dạng 6 số.');
      err.code = 'INVALID_ROOM_LINK';
      throw err;
    }

    const user = this.getCurrentUser();

    // 1. Trường hợp người dùng chưa đăng nhập -> Chuyển hướng màn hình Đăng nhập & lưu phiên
    if (!user) {
      this.savePendingRoomInvite(roomCode);
      return {
        action: 'REDIRECT_LOGIN',
        redirectUrl: `/login?redirect=/room/${roomCode}`,
        pendingRoomCode: roomCode,
        message: 'Yêu cầu đăng nhập trước khi tham gia phòng chơi.'
      };
    }

    // 2. Trường hợp người dùng đã đăng nhập -> Tham gia phòng bình thường
    return await this.joinRoomFromInvite(roomCode);
  }

  /**
   * COT-603 AC 2 & AC 3: Thực hiện tham gia phòng từ link mời
   * - Nếu phòng còn hợp lệ: Đưa người dùng trở lại đúng phòng chơi đó.
   * - Nếu phòng đã đóng hoặc không còn tồn tại: Báo lỗi "Room không còn khả dụng".
   * - Vai trò do máy chủ xác định theo trạng thái mới nhất (không dùng dữ liệu cũ).
   */
  async joinRoomFromInvite(roomCode) {
    const cleanCode = String(roomCode).trim();
    const room = this.roomsStore.find(r => r.code === cleanCode);

    // Tiêu chí 3: Phòng không tồn tại hoặc đã đóng thì hiển thị "Room không còn khả dụng"
    if (!room || room.status === 'CLOSED') {
      const err = new Error('Room không còn khả dụng.');
      err.code = 'ROOM_UNAVAILABLE';
      throw err;
    }

    // Xác định vai trò theo trạng thái mới nhất từ hệ thống
    let assignedRole = 'PLAYER';
    let assignedSide = 'BLACK';
    let roleMessage = 'Bạn tham gia phòng với vai trò Kỳ thủ Đối thủ (Quân Đen)!';

    if (room.status === 'WAITING_OPPONENT' && !room.opponentId) {
      assignedRole = 'PLAYER';
      assignedSide = 'BLACK';
      roleMessage = 'Bạn tham gia phòng với vai trò Kỳ thủ Đối thủ (Quân Đen)!';
    } else {
      assignedRole = 'SPECTATOR';
      assignedSide = null;
      roleMessage = 'Phòng đã đủ 2 kỳ thủ. Bạn tham gia phòng với vai trò Khán giả theo dõi ván cờ!';
    }

    return {
      action: 'JOIN_SUCCESS',
      success: true,
      room,
      role: assignedRole,
      side: assignedSide,
      canMove: assignedRole === 'PLAYER',
      roleMessage
    };
  }

  /**
   * COT-603 AC 2: Sau khi người dùng đăng nhập thành công
   * Kiểm tra lại thông tin phòng đã lưu trong phiên và tự động đưa vào phòng.
   */
  async handlePostLoginRoomRedirect() {
    const pendingRoomCode = this.getPendingRoomInvite();
    if (!pendingRoomCode) {
      return { hasPending: false };
    }

    // Xóa khỏi session để không kích hoạt lặp lại
    this.clearPendingRoomInvite();

    try {
      const joinResult = await this.joinRoomFromInvite(pendingRoomCode);
      return {
        hasPending: true,
        pendingRoomCode,
        ...joinResult
      };
    } catch (err) {
      return {
        hasPending: true,
        pendingRoomCode,
        success: false,
        error: err.message || 'Room không còn khả dụng.',
        code: err.code || 'ROOM_UNAVAILABLE'
      };
    }
  }
}

// Xuất service cho browser hoặc Node.js test
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RoomApiService, ROOM_STATUS, INITIAL_PUBLIC_ROOMS, INITIAL_FRIENDS };
} else {
  window.RoomApiService = RoomApiService;
  window.ROOM_STATUS = ROOM_STATUS;
  window.INITIAL_FRIENDS = INITIAL_FRIENDS;
}
