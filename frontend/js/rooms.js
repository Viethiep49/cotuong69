/**
 * Kỳ Đạo Online - Room Controller & UI Logic (COT-597)
 * Điều khiển hiển thị danh sách phòng, validation form tìm kiếm 6 số, và điều hướng.
 */

// BE-14: định dạng mã phòng — PHẢI trùng src/domain/roomCode.js (test room-code kiểm tra hai bản giống nhau).
//  - Công khai: 6 chữ số
//  - Riêng tư : 10 ký tự Crockford base32 (0-9, A-Z trừ I, L, O, U)
const PUBLIC_ROOM_CODE = /^\d{6}$/;
const PRIVATE_ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Bỏ khoảng trắng/gạch ngang, chuyển chữ hoa. */
function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

function isValidRoomCode(raw) {
  const code = normalizeRoomCode(raw);
  return PUBLIC_ROOM_CODE.test(code) || PRIVATE_ROOM_CODE.test(code);
}

/** Khi đang gõ: chỉ giữ chữ/số, tự viết hoa, tối đa 10 ký tự. */
function sanitizeRoomCodeInput(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 10);
}

document.addEventListener('DOMContentLoaded', () => {
  const apiService = new window.RoomApiService();

  // State quản lý phòng ở Client
  let currentRooms = [];
  let activeFilter = 'ALL';
  let searchQuery = '';

  // DOM Elements
  const roomsGrid = document.getElementById('roomsGrid');
  const roomsLoading = document.getElementById('roomsLoading');
  const roomsEmpty = document.getElementById('roomsEmpty');
  const totalRoomsCountEl = document.getElementById('totalRoomsCount');
  const waitingRoomsCountEl = document.getElementById('waitingRoomsCount');
  const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
  const filterSearchInput = document.getElementById('filterSearchInput');
  const filterTabsContainer = document.getElementById('statusFilterTabs');
  
  // Join by code elements
  const joinCodeForm = document.getElementById('joinCodeForm');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const joinBtn = document.getElementById('joinBtn');
  const codeErrorMessage = document.getElementById('codeErrorMessage');

  // Counts Elements
  const countAllEl = document.getElementById('countAll');
  const countWaitingEl = document.getElementById('countWaiting');
  const countFullEl = document.getElementById('countFull');
  const countPlayingEl = document.getElementById('countPlaying');
  const countRematchEl = document.getElementById('countRematch');

  // Modal Elements
  const roomModal = document.getElementById('roomModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalRoomCode = document.getElementById('modalRoomCode');
  const modalRoomName = document.getElementById('modalRoomName');
  const modalHostName = document.getElementById('modalHostName');
  const modalOpponentName = document.getElementById('modalOpponentName');
  const modalRoomStatus = document.getElementById('modalRoomStatus');
  const modalUserRole = document.getElementById('modalUserRole');
  const modalRoleNotice = document.getElementById('modalRoleNotice');
  const enterRoomBtn = document.getElementById('enterRoomBtn');

  // COT-598: Create Room Modal Elements
  const createRoomModalBtn = document.getElementById('createRoomModalBtn');
  const emptyCreateBtn = document.getElementById('emptyCreateBtn');
  const createRoomModal = document.getElementById('createRoomModal');
  const closeCreateRoomModalBtn = document.getElementById('closeCreateRoomModalBtn');
  const cancelCreateRoomBtn = document.getElementById('cancelCreateRoomBtn');
  const createRoomForm = document.getElementById('createRoomForm');
  const roomNameInput = document.getElementById('roomNameInput');
  const roomNameError = document.getElementById('roomNameError');
  const optPublic = document.getElementById('optPublic');
  const optPrivate = document.getElementById('optPrivate');
  const optPublicLabel = document.getElementById('optPublicLabel');
  const optPrivateLabel = document.getElementById('optPrivateLabel');
  const roomPasswordGroup = document.getElementById('roomPasswordGroup');
  const roomPasswordInput = document.getElementById('roomPasswordInput');
  const submitCreateRoomBtn = document.getElementById('submitCreateRoomBtn');
  const createRoomSpinner = document.getElementById('createRoomSpinner');
  const createRoomBtnText = document.getElementById('createRoomBtnText');

  // Lock flag chống duplicate submission khi tạo phòng (AC 3)
  let isCreatingRoom = false;

  // COT-599: Quản lý chia sẻ phòng & Mời bạn bè
  let currentActiveRoomCode = '';
  let friendsList = [];
  let friendSearchKeyword = '';
  const activeInvitationTimers = new Map(); // friendId -> { timerId, remainingSec, invitationId }

  // COT-599: Share & Friend Invite DOM Elements
  const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
  const copyRoomLinkBtn = document.getElementById('copyRoomLinkBtn');
  const shareFbBtn = document.getElementById('shareFbBtn');
  const shareMessengerBtn = document.getElementById('shareMessengerBtn');
  const shareZaloBtn = document.getElementById('shareZaloBtn');
  const openFriendInviteModalBtn = document.getElementById('openFriendInviteModalBtn');
  const friendInviteModal = document.getElementById('friendInviteModal');
  const closeFriendInviteModalBtn = document.getElementById('closeFriendInviteModalBtn');
  const closeFriendModalFooterBtn = document.getElementById('closeFriendModalFooterBtn');
  const onlineFriendsCountEl = document.getElementById('onlineFriendsCount');
  const totalFriendsCountEl = document.getElementById('totalFriendsCount');
  const friendSearchInput = document.getElementById('friendSearchInput');
  const friendsListContainer = document.getElementById('friendsListContainer');

  // COT-603: Login Modal & Auth State DOM Elements
  const userProfileBar = document.getElementById('userProfileBar');
  const headerLogoutBtn = document.getElementById('headerLogoutBtn');
  const openLoginModalBtn = document.getElementById('openLoginModalBtn');
  const loginModal = document.getElementById('loginModal');
  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const cancelLoginBtn = document.getElementById('cancelLoginBtn');
  const loginForm = document.getElementById('loginForm');
  const loginUsernameInput = document.getElementById('loginUsernameInput');
  const loginPasswordInput = document.getElementById('loginPasswordInput');
  const loginUsernameError = document.getElementById('loginUsernameError');
  const loginPasswordError = document.getElementById('loginPasswordError');
  const submitLoginBtn = document.getElementById('submitLoginBtn');
  const loginSpinner = document.getElementById('loginSpinner');
  const loginBtnText = document.getElementById('loginBtnText');
  const loginPendingRoomBanner = document.getElementById('loginPendingRoomBanner');
  const pendingRoomCodeDisplay = document.getElementById('pendingRoomCodeDisplay');

  // COT-583: Forgot & Reset Password DOM Elements
  const openForgotPasswordLink = document.getElementById('openForgotPasswordLink');
  const forgotPasswordModal = document.getElementById('forgotPasswordModal');
  const closeForgotPasswordModalBtn = document.getElementById('closeForgotPasswordModalBtn');
  const backToLoginFromForgotBtn = document.getElementById('backToLoginFromForgotBtn');
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotEmailInput = document.getElementById('forgotEmailInput');
  const forgotEmailError = document.getElementById('forgotEmailError');
  const forgotStatusBanner = document.getElementById('forgotStatusBanner');
  const forgotStatusMsg = document.getElementById('forgotStatusMsg');
  const submitForgotBtn = document.getElementById('submitForgotBtn');
  const forgotSpinner = document.getElementById('forgotSpinner');
  const forgotBtnText = document.getElementById('forgotBtnText');

  const resetPasswordModal = document.getElementById('resetPasswordModal');
  const closeResetPasswordModalBtn = document.getElementById('closeResetPasswordModalBtn');
  const backToLoginFromResetBtn = document.getElementById('backToLoginFromResetBtn');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const resetTokenInput = document.getElementById('resetTokenInput');
  const newPasswordInput = document.getElementById('newPasswordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const newPasswordError = document.getElementById('newPasswordError');
  const confirmPasswordError = document.getElementById('confirmPasswordError');
  const resetTokenErrorBanner = document.getElementById('resetTokenErrorBanner');
  const resetTokenErrorTitle = document.getElementById('resetTokenErrorTitle');
  const resetTokenErrorMsg = document.getElementById('resetTokenErrorMsg');
  const resetSuccessBanner = document.getElementById('resetSuccessBanner');
  const resetSuccessMsg = document.getElementById('resetSuccessMsg');
  const resetInputsArea = document.getElementById('resetInputsArea');
  const submitResetBtn = document.getElementById('submitResetBtn');
  const resetSpinner = document.getElementById('resetSpinner');
  const resetBtnText = document.getElementById('resetBtnText');
  const chkLength = document.getElementById('chkLength');
  const chkAlphaNum = document.getElementById('chkAlphaNum');
  // COT-579: Register Modal DOM Elements
  const registerModal = document.getElementById('registerModal');
  const closeRegisterModalBtn = document.getElementById('closeRegisterModalBtn');
  const openRegisterFromLoginLink = document.getElementById('openRegisterFromLoginLink');
  const openLoginFromRegisterLink = document.getElementById('openLoginFromRegisterLink');
  const registerForm = document.getElementById('registerForm');
  const registerUsernameInput = document.getElementById('registerUsernameInput');
  const registerDisplayNameInput = document.getElementById('registerDisplayNameInput');
  const registerEmailInput = document.getElementById('registerEmailInput');
  const registerPasswordInput = document.getElementById('registerPasswordInput');
  const registerConfirmPasswordInput = document.getElementById('registerConfirmPasswordInput');
  const registerUsernameError = document.getElementById('registerUsernameError');
  const registerDisplayNameError = document.getElementById('registerDisplayNameError');
  const registerEmailError = document.getElementById('registerEmailError');
  const registerPasswordError = document.getElementById('registerPasswordError');
  const registerConfirmPasswordError = document.getElementById('registerConfirmPasswordError');
  const registerSuccessBanner = document.getElementById('registerSuccessBanner');
  const registerSuccessMsg = document.getElementById('registerSuccessMsg');
  const registerInputsArea = document.getElementById('registerInputsArea');
  const submitRegisterBtn = document.getElementById('submitRegisterBtn');
  const registerSpinner = document.getElementById('registerSpinner');
  const registerBtnText = document.getElementById('registerBtnText');
  const regChkLength = document.getElementById('regChkLength');
  const regChkAlphaNum = document.getElementById('regChkAlphaNum');
  const regChkMatch = document.getElementById('regChkMatch');

  // COT-580: OAuth Buttons & Errors
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const oauthGeneralError = document.getElementById('oauthGeneralError');
  const loginGeneralError = document.getElementById('loginGeneralError');

  // COT-585: Profile Modal DOM Elements
  const profileModal = document.getElementById('profileModal');
  const closeProfileModalBtn = document.getElementById('closeProfileModalBtn');
  const cancelProfileBtn = document.getElementById('cancelProfileBtn');
  const profileForm = document.getElementById('profileForm');
  const profileUsernameInput = document.getElementById('profileUsernameInput');
  const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
  const profileEmailInput = document.getElementById('profileEmailInput');
  const profileEloDisplay = document.getElementById('profileEloDisplay');
  const profileAvatarInput = document.getElementById('profileAvatarInput');
  const chooseAvatarBtn = document.getElementById('chooseAvatarBtn');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileAvatarFallback = document.getElementById('profileAvatarFallback');
  const profileDisplayNameError = document.getElementById('profileDisplayNameError');
  const profileAvatarError = document.getElementById('profileAvatarError');
  const profileSuccessBanner = document.getElementById('profileSuccessBanner');
  const submitProfileBtn = document.getElementById('submitProfileBtn');
  const profileSpinner = document.getElementById('profileSpinner');
  const profileBtnText = document.getElementById('profileBtnText');
  let selectedAvatarFile = null;
  let selectedAvatarPreviewUrl = null;

  // Khởi tạo các Service
  const authService = typeof window !== 'undefined' && window.AuthService ? new window.AuthService({
    onAuthStateChanged: (user) => {
      apiService.setCurrentUser(user);
      updateUserAuthUi();
    }
  }) : null;

  const userProfileService = typeof window !== 'undefined' && window.UserProfileService ? new window.UserProfileService({
    onProfileUpdated: (updatedUser) => {
      apiService.setCurrentUser(updatedUser);
      updateUserAuthUi();
    }
  }) : null;

  const passwordResetService = typeof window !== 'undefined' && window.PasswordResetService ? new window.PasswordResetService() : null;

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // COT-630: Chat DOM Elements & State
  const roomChatSection = document.getElementById('roomChatSection');
  const roomModalChatMessages = document.getElementById('roomModalChatMessages');
  const roomModalChatForm = document.getElementById('roomModalChatForm');
  const roomChatInput = document.getElementById('roomChatInput');
  const roomChatSendBtn = document.getElementById('roomChatSendBtn');
  const roomChatCharCounter = document.getElementById('roomChatCharCounter');
  const roomChatErrorTooltip = document.getElementById('roomChatErrorTooltip');

  const floatingChatWidget = document.getElementById('floatingChatWidget');
  const floatingOpenChatBtn = document.getElementById('floatingOpenChatBtn');
  const floatingChatPanel = document.getElementById('floatingChatPanel');
  const floatingCloseChatBtn = document.getElementById('floatingCloseChatBtn');
  const floatingChatMessages = document.getElementById('floatingChatMessages');
  const floatingChatForm = document.getElementById('floatingChatForm');
  const floatingChatInput = document.getElementById('floatingChatInput');
  const floatingChatSendBtn = document.getElementById('floatingChatSendBtn');
  const floatingCharCounter = document.getElementById('floatingCharCounter');
  const floatingChatError = document.getElementById('floatingChatError');
  const floatingChatUnread = document.getElementById('floatingChatUnread');
  const floatingChatRoomTitle = document.getElementById('floatingChatRoomTitle');

  let activeChatService = null;
  let unsubscribeChatEvents = null; // FE-05: hàm huỷ đăng ký onChatEvent hiện tại

  /**
   * Khởi tạo ứng dụng
   */
  async function init() {
    setupEventListeners();
    if (authService) {
      try {
        const sessionRes = await authService.restoreSession();
        if (sessionRes && sessionRes.isAuthenticated && sessionRes.user) {
          apiService.setCurrentUser(sessionRes.user);
        } else {
          // FE-03: không có phiên hợp lệ -> coi là khách
          apiService.setCurrentUser(null);
        }
      } catch {
        apiService.setCurrentUser(null);
      }
    }
    updateUserAuthUi();
    await loadRooms();
    setupRealtimeSubscription();
    await checkAndHandleInviteLinkOnLoad();
    checkAndHandleResetTokenOnLoad();
  }

  /**
   * Đăng ký các sự kiện người dùng
   */
  function setupEventListeners() {
    // Form tham gia bằng mã 6 số
    joinCodeForm.addEventListener('submit', handleJoinByCodeSubmit);

    // Validate realtime khi người dùng nhập mã phòng
    roomCodeInput.addEventListener('input', (e) => {
      // BE-14: phòng công khai 6 số, phòng riêng tư 10 ký tự base32 -> giữ chữ/số, tự viết hoa, tối đa 10
      e.target.value = sanitizeRoomCodeInput(e.target.value);
      clearInputError();
    });

    // COT-598: Mở Modal Tạo phòng chơi
    if (createRoomModalBtn) {
      createRoomModalBtn.addEventListener('click', openCreateRoomModal);
    }
    if (emptyCreateBtn) {
      emptyCreateBtn.addEventListener('click', openCreateRoomModal);
    }

    // Đóng Modal Tạo phòng
    if (closeCreateRoomModalBtn) {
      closeCreateRoomModalBtn.addEventListener('click', closeCreateRoomModal);
    }
    if (cancelCreateRoomBtn) {
      cancelCreateRoomBtn.addEventListener('click', closeCreateRoomModal);
    }
    if (createRoomModal) {
      createRoomModal.addEventListener('click', (e) => {
        if (e.target === createRoomModal) closeCreateRoomModal();
      });
    }

    // Toggle lựa chọn Công khai / Riêng tư
    if (optPublic && optPrivate) {
      optPublic.addEventListener('change', () => {
        if (optPublic.checked) {
          optPublicLabel?.classList.add('selected');
          optPrivateLabel?.classList.remove('selected');
          if (roomPasswordGroup) roomPasswordGroup.style.display = 'none';
        }
      });

      optPrivate.addEventListener('change', () => {
        if (optPrivate.checked) {
          optPrivateLabel?.classList.add('selected');
          optPublicLabel?.classList.remove('selected');
          if (roomPasswordGroup) roomPasswordGroup.style.display = 'flex';
        }
      });
    }

    // Realtime clear lỗi khi gõ tên phòng
    if (roomNameInput) {
      roomNameInput.addEventListener('input', clearCreateRoomError);
    }

    // Submit Form Tạo phòng chơi (COT-598)
    if (createRoomForm) {
      createRoomForm.addEventListener('submit', handleCreateRoomSubmit);
    }

    // Nút làm mới danh sách
    refreshRoomsBtn.addEventListener('click', async () => {
      refreshRoomsBtn.classList.add('rotating');
      await loadRooms();
      showToast('Đã làm mới danh sách phòng chơi!', 'success');
      setTimeout(() => refreshRoomsBtn.classList.remove('rotating'), 600);
    });

    // Lọc theo từ khóa tìm kiếm
    filterSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderRooms();
    });

    // Bộ lọc theo trạng thái phòng
    filterTabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.filter-tab');
      if (!tab) return;

      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      activeFilter = tab.getAttribute('data-filter');
      renderRooms();
    });

    // Đóng Modal Xem phòng / Vào phòng
    closeModalBtn.addEventListener('click', closeModal);
    roomModal.addEventListener('click', (e) => {
      if (e.target === roomModal) closeModal();
    });

    enterRoomBtn.addEventListener('click', () => {
      showToast('Đang chuyển hướng vào bàn cờ...', 'success');
      setTimeout(() => {
        closeModal();
      }, 1000);
    });

    // COT-599: Nút sao chép mã và link mời phòng
    if (copyRoomCodeBtn) {
      copyRoomCodeBtn.addEventListener('click', handleCopyRoomCode);
    }
    if (copyRoomLinkBtn) {
      copyRoomLinkBtn.addEventListener('click', handleCopyRoomLink);
    }

    // COT-599: Mở và đóng Modal Mời bạn bè
    if (openFriendInviteModalBtn) {
      openFriendInviteModalBtn.addEventListener('click', openFriendInviteModal);
    }
    if (closeFriendInviteModalBtn) {
      closeFriendInviteModalBtn.addEventListener('click', closeFriendInviteModal);
    }
    if (closeFriendModalFooterBtn) {
      closeFriendModalFooterBtn.addEventListener('click', closeFriendInviteModal);
    }
    if (friendInviteModal) {
      friendInviteModal.addEventListener('click', (e) => {
        if (e.target === friendInviteModal) closeFriendInviteModal();
      });
    }

    // COT-630: Chat Event Listeners
    if (floatingOpenChatBtn) {
      floatingOpenChatBtn.addEventListener('click', toggleFloatingChat);
    }
    if (floatingCloseChatBtn) {
      floatingCloseChatBtn.addEventListener('click', toggleFloatingChat);
    }
    if (roomModalChatForm) {
      roomModalChatForm.addEventListener('submit', handleRoomChatSubmit);
    }
    if (floatingChatForm) {
      floatingChatForm.addEventListener('submit', handleFloatingChatSubmit);
    }
    if (roomChatInput) {
      roomChatInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        if (roomChatCharCounter) roomChatCharCounter.textContent = `${len}/255`;
        if (roomChatErrorTooltip) roomChatErrorTooltip.style.display = 'none';
      });
    }
    if (floatingChatInput) {
      floatingChatInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        if (floatingCharCounter) floatingCharCounter.textContent = `${len}/255`;
        if (floatingChatError) floatingChatError.style.display = 'none';
      });
    }

    // COT-599: Tìm kiếm bạn bè trong danh sách
    if (friendSearchInput) {
      friendSearchInput.addEventListener('input', (e) => {
        friendSearchKeyword = e.target.value.trim().toLowerCase();
        renderFriendsList();
      });
    }

    // COT-599: Event delegation cho nút Mời đấu và Hủy mời trong danh sách bạn bè
    if (friendsListContainer) {
      friendsListContainer.addEventListener('click', async (e) => {
        const inviteBtn = e.target.closest('.btn-invite-friend');
        if (inviteBtn && !inviteBtn.disabled) {
          const friendId = inviteBtn.getAttribute('data-friend-id');
          await handleInviteFriend(friendId);
          return;
        }

        const cancelBtn = e.target.closest('.btn-cancel-invite');
        if (cancelBtn) {
          const friendId = cancelBtn.getAttribute('data-friend-id');
          const invId = cancelBtn.getAttribute('data-inv-id');
          await handleCancelInvitation(friendId, invId);
          return;
        }
      });
    }

    // COT-603: Auth & Login Modal Events
    if (headerLogoutBtn) {
      headerLogoutBtn.addEventListener('click', handleLogout);
    }
    if (openLoginModalBtn) {
      openLoginModalBtn.addEventListener('click', () => openLoginModal());
    }
    if (closeLoginModalBtn) {
      closeLoginModalBtn.addEventListener('click', closeLoginModal);
    }
    if (cancelLoginBtn) {
      cancelLoginBtn.addEventListener('click', closeLoginModal);
    }
    if (loginModal) {
      loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) closeLoginModal();
      });
    }
    if (loginForm) {
      loginForm.addEventListener('submit', handleLoginSubmit);
    }

    // COT-579: Chuyển đổi giữa Đăng nhập và Đăng ký
    if (openRegisterFromLoginLink) {
      openRegisterFromLoginLink.addEventListener('click', () => {
        closeLoginModal();
        openRegisterModal();
      });
    }
    if (openLoginFromRegisterLink) {
      openLoginFromRegisterLink.addEventListener('click', () => {
        closeRegisterModal();
        openLoginModal();
      });
    }
    if (closeRegisterModalBtn) {
      closeRegisterModalBtn.addEventListener('click', closeRegisterModal);
    }
    if (registerModal) {
      registerModal.addEventListener('click', (e) => {
        if (e.target === registerModal) closeRegisterModal();
      });
    }
    if (registerForm) {
      registerForm.addEventListener('submit', handleRegisterSubmit);
    }
    if (registerPasswordInput && registerConfirmPasswordInput) {
      registerPasswordInput.addEventListener('input', updateRegisterChecklist);
      registerConfirmPasswordInput.addEventListener('input', updateRegisterChecklist);
    }

    // COT-580 / SEC-05: Sự kiện nút Đăng nhập nhanh Google (Facebook đã bỏ)
    if (googleLoginBtn) {
      // SEC-05: chỉ hiện nút Google khi đã cấu hình client id
      if (getGoogleClientId()) {
        googleLoginBtn.style.display = 'inline-flex';
      } else {
        googleLoginBtn.style.display = 'none';
      }
      googleLoginBtn.addEventListener('click', () => handleOAuthLogin('google'));
    }

    // COT-585: Sự kiện Hồ sơ cá nhân & Đổi Avatar
    if (userProfileBar) {
      userProfileBar.style.cursor = 'pointer';
      userProfileBar.addEventListener('click', (e) => {
        if (e.target === headerLogoutBtn || e.target.closest('#headerLogoutBtn')) return;
        openProfileModal();
      });
    }
    if (closeProfileModalBtn) {
      closeProfileModalBtn.addEventListener('click', closeProfileModal);
    }
    if (cancelProfileBtn) {
      cancelProfileBtn.addEventListener('click', closeProfileModal);
    }
    if (profileModal) {
      profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) closeProfileModal();
      });
    }
    if (chooseAvatarBtn && profileAvatarInput) {
      chooseAvatarBtn.addEventListener('click', () => profileAvatarInput.click());
    }
    if (profileAvatarInput) {
      profileAvatarInput.addEventListener('change', handleAvatarFileSelect);
    }
    if (profileForm) {
      profileForm.addEventListener('submit', handleProfileSubmit);
    }

    // COT-583: Sự kiện Quên mật khẩu & Đặt lại mật khẩu
    if (openForgotPasswordLink) {
      openForgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        closeLoginModal();
        openForgotPasswordModal();
      });
    }
    if (closeForgotPasswordModalBtn) {
      closeForgotPasswordModalBtn.addEventListener('click', closeForgotPasswordModal);
    }
    if (backToLoginFromForgotBtn) {
      backToLoginFromForgotBtn.addEventListener('click', () => {
        closeForgotPasswordModal();
        openLoginModal();
      });
    }
    if (forgotPasswordModal) {
      forgotPasswordModal.addEventListener('click', (e) => {
        if (e.target === forgotPasswordModal) closeForgotPasswordModal();
      });
    }
    if (forgotPasswordForm) {
      forgotPasswordForm.addEventListener('submit', handleForgotPasswordSubmit);
    }

    if (closeResetPasswordModalBtn) {
      closeResetPasswordModalBtn.addEventListener('click', closeResetPasswordModal);
    }
    if (backToLoginFromResetBtn) {
      backToLoginFromResetBtn.addEventListener('click', () => {
        closeResetPasswordModal();
        openLoginModal();
      });
    }
    if (resetPasswordModal) {
      resetPasswordModal.addEventListener('click', (e) => {
        if (e.target === resetPasswordModal) closeResetPasswordModal();
      });
    }
    if (resetPasswordForm) {
      resetPasswordForm.addEventListener('submit', handleResetPasswordSubmit);
    }

    // Dynamic password checklist feedback
    if (newPasswordInput && confirmPasswordInput) {
      const updateChecklist = () => {
        const pass = newPasswordInput.value || '';
        const confirm = confirmPasswordInput.value || '';
        const isLen = pass.length >= 8;
        const isAlphaNum = /[A-Za-z]/.test(pass) && /\d/.test(pass);
        const isMatch = confirm.length > 0 && pass === confirm;

        if (chkLength) {
          chkLength.className = `checklist-item ${isLen ? 'valid' : ''}`;
          const icon = chkLength.querySelector('.chk-icon');
          if (icon) icon.textContent = isLen ? '✓' : '○';
        }
        if (chkAlphaNum) {
          chkAlphaNum.className = `checklist-item ${isAlphaNum ? 'valid' : ''}`;
          const icon = chkAlphaNum.querySelector('.chk-icon');
          if (icon) icon.textContent = isAlphaNum ? '✓' : '○';
        }
        if (chkMatch) {
          chkMatch.className = `checklist-item ${isMatch ? 'valid' : ''}`;
          const icon = chkMatch.querySelector('.chk-icon');
          if (icon) icon.textContent = isMatch ? '✓' : '○';
        }
      };
      newPasswordInput.addEventListener('input', updateChecklist);
      confirmPasswordInput.addEventListener('input', updateChecklist);
    }

    // COT-584: Điều hướng các khối tính năng Sảnh chờ
    const navPlayOnlineCard = document.getElementById('navPlayOnlineCard');
    const navPlayAiCard = document.getElementById('navPlayAiCard');
    const navFriendsCard = document.getElementById('navFriendsCard');

    if (navPlayOnlineCard) {
      navPlayOnlineCard.addEventListener('click', () => {
        document.querySelectorAll('.lobby-mode-card').forEach(c => c.classList.remove('is-active'));
        navPlayOnlineCard.classList.add('is-active');
        const roomsContainer = document.querySelector('.rooms-container');
        if (roomsContainer) {
          roomsContainer.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    if (navPlayAiCard) {
      navPlayAiCard.addEventListener('click', () => {
        document.querySelectorAll('.lobby-mode-card').forEach(c => c.classList.remove('is-active'));
        navPlayAiCard.classList.add('is-active');
        openPveModal();
      });
    }

    // COT-638: PvE Start Modal Event Listeners
    const pveStartModal = document.getElementById('pveStartModal');
    const closePveStartModalBtn = document.getElementById('closePveStartModalBtn');
    const cancelPveStartBtn = document.getElementById('cancelPveStartBtn');
    const pveStartForm = document.getElementById('pveStartForm');
    const pveSelectRed = document.getElementById('pveSelectRed');
    const pveSelectBlack = document.getElementById('pveSelectBlack');
    const pveSelectRedLabel = document.getElementById('pveSelectRedLabel');
    const pveSelectBlackLabel = document.getElementById('pveSelectBlackLabel');
    const pveStartError = document.getElementById('pveStartError');
    const submitStartPveBtn = document.getElementById('submitStartPveBtn');
    const pveStartSpinner = document.getElementById('pveStartSpinner');
    const pveStartBtnText = document.getElementById('pveStartBtnText');

    // FE-10: instance PveApiService DUY NHẤT của trang (tạo trận, đi quân, xin thua đều dùng chung)
    let pveSharedApi = null;
    function getPveApi() {
      if (!pveSharedApi && typeof window.PveApiService === 'function') {
        pveSharedApi = new window.PveApiService();
      }
      return pveSharedApi;
    }

    function openPveModal() {
      if (!pveStartModal) return;
      if (pveStartError) {
        pveStartError.textContent = '';
        pveStartError.style.display = 'none';
      }
      pveStartModal.style.display = 'flex';
    }

    function closePveModal() {
      if (!pveStartModal) return;
      pveStartModal.style.display = 'none';
      if (pveStartError) {
        pveStartError.textContent = '';
        pveStartError.style.display = 'none';
      }
    }

    window.openPveModal = openPveModal;

    if (closePveStartModalBtn) closePveStartModalBtn.addEventListener('click', closePveModal);
    if (cancelPveStartBtn) cancelPveStartBtn.addEventListener('click', closePveModal);
    if (pveStartModal) {
      pveStartModal.addEventListener('click', (e) => {
        if (e.target === pveStartModal) closePveModal();
      });
    }

    if (pveSelectRed && pveSelectBlack) {
      pveSelectRed.addEventListener('change', () => {
        if (pveSelectRed.checked) {
          pveSelectRedLabel?.classList.add('is-selected');
          pveSelectBlackLabel?.classList.remove('is-selected');
        }
      });
      pveSelectBlack.addEventListener('change', () => {
        if (pveSelectBlack.checked) {
          pveSelectBlackLabel?.classList.add('is-selected');
          pveSelectRedLabel?.classList.remove('is-selected');
        }
      });
    }

    if (pveStartForm) {
      pveStartForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const selectedColor = pveSelectBlack && pveSelectBlack.checked ? 'black' : 'red';

        // Khóa nút để tránh tạo nhiều trận do bấm liên tục
        if (submitStartPveBtn) submitStartPveBtn.disabled = true;
        if (pveStartSpinner) pveStartSpinner.style.display = 'inline-block';
        if (pveStartBtnText) pveStartBtnText.textContent = 'Đang khởi tạo trận...';
        if (pveStartError) pveStartError.style.display = 'none';

        try {
          // FE-10: MỘT instance dùng chung cho tạo trận / xin thua (không tạo instance tạm)
          const pveApi = getPveApi();
          if (!pveApi) {
            throw new Error('Hệ thống máy chủ PvE chưa sẵn sàng.');
          }
          if (apiService.getCurrentUser && !apiService.getCurrentUser()) {
            throw new Error('Bạn cần đăng nhập để chơi với máy.');
          }

          const response = await pveApi.createPveMatch({ playerColor: selectedColor });
          if (response && response.success) {
            closePveModal();
            const colorText = selectedColor === 'red' ? 'Đỏ (bạn đi trước)' : 'Đen (máy đi trước)';
            showToast(`Khởi tạo trận đấu PvE phe ${colorText} thành công!`, 'success');

            const event = new CustomEvent('cotuong:pve-started', { detail: response.match });
            window.dispatchEvent(event);
          }
        } catch (err) {
          if (pveStartError) {
            pveStartError.textContent = err.message || 'Không thể tạo trận với máy.';
            pveStartError.style.display = 'block';
          }
          showToast(err.message || 'Lỗi tạo trận với máy.', 'error');
        } finally {
          if (submitStartPveBtn) submitStartPveBtn.disabled = false;
          if (pveStartSpinner) pveStartSpinner.style.display = 'none';
          if (pveStartBtnText) pveStartBtnText.textContent = '⚔️ Bắt Đầu Ván Đấu';
        }
      });
    }

    // COT-640: Khởi tạo các DOM elements & Event listeners cho Xin thua và Kết quả trận PvE
    const pveGameActionBar = document.getElementById('pveGameActionBar');
    const pveResignBtn = document.getElementById('pveResignBtn');
    const pveResignConfirmModal = document.getElementById('pveResignConfirmModal');
    const closePveResignModalBtn = document.getElementById('closePveResignModalBtn');
    const pveCancelResignBtn = document.getElementById('pveCancelResignBtn');
    const pveConfirmResignBtn = document.getElementById('pveConfirmResignBtn');
    const pveResignSpinner = document.getElementById('pveResignSpinner');
    const pveResignError = document.getElementById('pveResignError');

    const pveMatchResultModal = document.getElementById('pveMatchResultModal');
    const pveResultCard = document.getElementById('pveResultCard');
    const pveResultHeaderIcon = document.getElementById('pveResultHeaderIcon');
    const closePveResultModalBtn = document.getElementById('closePveResultModalBtn');
    const pveResultBadge = document.getElementById('pveResultBadge');
    const pveResultOutcomeIcon = document.getElementById('pveResultOutcomeIcon');
    const pveResultTitleText = document.getElementById('pveResultTitleText');
    const pveResultSubtitle = document.getElementById('pveResultSubtitle');
    const pveResultReason = document.getElementById('pveResultReason');
    const pveResultPlayerSide = document.getElementById('pveResultPlayerSide');
    const pveResultBackToLobbyBtn = document.getElementById('pveResultBackToLobbyBtn');
    const pveResultNewGameBtn = document.getElementById('pveResultNewGameBtn');

    let currentPveMatch = null;

    function openPveResignModal() {
      if (!pveResignConfirmModal) return;
      if (pveResignError) {
        pveResignError.textContent = '';
        pveResignError.style.display = 'none';
      }
      pveResignConfirmModal.style.display = 'flex';
    }

    function closePveResignModal() {
      if (!pveResignConfirmModal) return;
      pveResignConfirmModal.style.display = 'none';
    }

    function renderPveResultModal(match) {
      if (!pveMatchResultModal || !match) return;

      const isWin = match.result === 'WIN';
      const isDraw = match.result === 'DRAW';
      const isLoss = !isWin && !isDraw;

      const resultTitle = isWin ? 'Chiến Thắng' : isDraw ? 'Hòa Cờ' : 'Thất Bại';
      const icon = isWin ? '🏆' : isDraw ? '🤝' : '⚔️';
      const subtitle = isWin
        ? 'Chúc mừng bạn đã xuất sắc đánh bại máy chủ AI!'
        : isDraw
          ? 'Ván đấu bất phân thắng bại giữa bạn và máy chủ AI.'
          : 'Bạn đã để thua ván cờ này trước máy chủ AI.';

      const themeClass = isWin ? 'theme-win' : isDraw ? 'theme-draw' : 'theme-loss';
      const badgeClass = isWin ? 'result-win' : isDraw ? 'result-draw' : 'result-loss';

      if (pveResultCard) {
        pveResultCard.className = `modal-card modal-card-result ${themeClass}`;
      }
      if (pveResultBadge) {
        pveResultBadge.className = `result-outcome-badge ${badgeClass}`;
      }
      if (pveResultHeaderIcon) pveResultHeaderIcon.textContent = icon;
      if (pveResultOutcomeIcon) pveResultOutcomeIcon.textContent = icon;
      if (pveResultTitleText) pveResultTitleText.textContent = resultTitle;
      if (pveResultSubtitle) pveResultSubtitle.textContent = subtitle;

      // Lý do kết thúc
      const reasonLabels = {
        CHECKMATE: 'Chiếu bí',
        NO_LEGAL_MOVES: 'Hết nước đi',
        STALEMATE: 'Hết nước đi',
        TIMEOUT: 'Hết thời gian',
        RESIGN: 'Đầu hàng',
        DRAW_PLY_LIMIT: 'Hết giới hạn số nước đi',
      };
      if (pveResultReason) {
        pveResultReason.textContent = reasonLabels[match.endReason] || 'Kết thúc ván đấu';
      }

      // Phe người chơi
      if (pveResultPlayerSide) {
        pveResultPlayerSide.textContent = match.playerColor === 'red' ? '🔴 Bên Đỏ' : '⚫ Bên Đen';
      }

      pveMatchResultModal.style.display = 'flex';
    }

    function closePveResultModal() {
      if (!pveMatchResultModal) return;
      pveMatchResultModal.style.display = 'none';
    }

    window.openPveResignModal = openPveResignModal;
    window.closePveResignModal = closePveResignModal;
    window.renderPveResultModal = renderPveResultModal;
    window.closePveResultModal = closePveResultModal;

    if (pveResignBtn) {
      pveResignBtn.addEventListener('click', () => {
        openPveResignModal();
      });
    }

    if (closePveResignModalBtn) closePveResignModalBtn.addEventListener('click', closePveResignModal);
    if (pveCancelResignBtn) pveCancelResignBtn.addEventListener('click', closePveResignModal);
    if (pveResignConfirmModal) {
      pveResignConfirmModal.addEventListener('click', (e) => {
        if (e.target === pveResignConfirmModal) closePveResignModal();
      });
    }

    if (pveConfirmResignBtn) {
      pveConfirmResignBtn.addEventListener('click', async () => {
        if (pveConfirmResignBtn) pveConfirmResignBtn.disabled = true;
        if (pveResignSpinner) pveResignSpinner.style.display = 'inline-block';
        if (pveResignError) pveResignError.style.display = 'none';

        try {
          const pveApi = getPveApi();
          if (!pveApi || !currentPveMatch) {
            throw new Error('Không có ván đấu nào đang diễn ra để xin thua.');
          }
          let response;
          try {
            response = await pveApi.resignMatch(currentPveMatch.id);
          } catch (resignError) {
            // FE-10: KHÔNG tự bịa kết quả. Chỉ riêng trường hợp máy chủ báo ván đã kết thúc
            // (vd. hết giờ trước khi bấm) thì lấy kết quả THẬT từ máy chủ; lỗi khác hiện nguyên lỗi.
            if (resignError && resignError.code === 'MATCH_FINISHED') {
              response = await pveApi.getMatch(currentPveMatch.id);
            } else {
              throw resignError;
            }
          }

          if (response && response.success) {
            currentPveMatch = response.match;
            closePveResignModal();
            renderPveResultModal(response.match);
            showToast(
              response.match.endReason === 'RESIGN' ? 'Bạn đã xác nhận đầu hàng ván đấu.' : 'Ván đấu đã kết thúc trước đó.',
              'info'
            );
          }
        } catch (err) {
          if (pveResignError) {
            pveResignError.textContent = err.message || 'Lỗi khi gửi yêu cầu đầu hàng';
            pveResignError.style.display = 'block';
          }
        } finally {
          if (pveConfirmResignBtn) pveConfirmResignBtn.disabled = false;
          if (pveResignSpinner) pveResignSpinner.style.display = 'none';
        }
      });
    }

    if (closePveResultModalBtn) closePveResultModalBtn.addEventListener('click', closePveResultModal);
    if (pveMatchResultModal) {
      pveMatchResultModal.addEventListener('click', (e) => {
        if (e.target === pveMatchResultModal) closePveResultModal();
      });
    }

    if (pveResultBackToLobbyBtn) {
      pveResultBackToLobbyBtn.addEventListener('click', () => {
        closePveResultModal();
        if (pveGameActionBar) pveGameActionBar.style.display = 'none';
        currentPveMatch = null;
        showToast('Đã trở về sảnh chờ.', 'info');
      });
    }

    if (pveResultNewGameBtn) {
      pveResultNewGameBtn.addEventListener('click', () => {
        closePveResultModal();
        openPveModal();
      });
    }

    window.addEventListener('cotuong:pve-started', (e) => {
      currentPveMatch = e.detail;
      if (pveGameActionBar) pveGameActionBar.style.display = 'flex';
      const statusText = document.getElementById('pveBotStatusText');
      if (statusText) {
        statusText.textContent = `Ván cờ với Máy đang diễn ra (${currentPveMatch.playerColor === 'red' ? 'Bạn cầm Đỏ' : 'Bạn cầm Đen'})`;
      }
    });

    if (navFriendsCard) {
      navFriendsCard.addEventListener('click', () => {
        document.querySelectorAll('.lobby-mode-card').forEach(c => c.classList.remove('is-active'));
        navFriendsCard.classList.add('is-active');
        if (typeof openFriendInviteModal === 'function') {
          openFriendInviteModal();
        }
      });
    }
  }

  /**
   * Tải danh sách phòng từ API Service
   * Tiêu chí chấp nhận 1: Danh sách hiển thị đúng các Room Public và trạng thái.
   */
  async function loadRooms() {
    setLoading(true);
    try {
      currentRooms = await apiService.getPublicRooms();
      updateBadgeCounts();
      renderRooms();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Đăng ký lắng nghe sự kiện Realtime từ Server
   * Tiêu chí chấp nhận 2: Khi trạng thái thay đổi, giao diện cập nhật theo Backend.
   * Phạm vi: Room đang diễn ra vẫn hiển thị; Room đóng tự biến mất.
   */
  function setupRealtimeSubscription() {
    apiService.onRealtimeUpdate((event) => {
      if (event.type === 'ROOM_CLOSED') {
        // Tự động xóa phòng đã đóng khỏi danh sách
        currentRooms = currentRooms.filter(r => r.code !== event.roomCode);
        showToast(`Phòng [${event.roomCode}] đã đóng và được gỡ khỏi danh sách.`, 'info');
      } else if (event.type === 'ROOM_UPDATED') {
        const index = currentRooms.findIndex(r => r.code === event.room.code);
        if (index !== -1) {
          currentRooms[index] = event.room;
        } else if (event.room.isPublic && event.room.status !== 'CLOSED') {
          currentRooms.unshift(event.room);
        }
        // REV-16: showToast đã tự escape -> không escape thêm (tránh hiện `&amp;`)
        showToast(`Trạng thái phòng [${event.room.code}] đã được cập nhật: ${window.ROOM_STATUS[event.room.status]?.label || event.room.status}`, 'info');
      }

      updateBadgeCounts();
      renderRooms();
    });
  }

  /**
   * Xử lý gửi Form tham gia phòng bằng mã 6 số
   * Tiêu chí chấp nhận 3: Nhập đúng mã 6 số tham gia phòng thành công.
   * Tiêu chí chấp nhận 4: Hiển thị lỗi rõ ràng khi phòng không tồn tại hoặc đã đóng.
   * Quy tắc phạm vi: Không gửi request khi mã trống hoặc sai định dạng.
   */
  async function handleJoinByCodeSubmit(e) {
    e.preventDefault();
    clearInputError();

    // REV-16: bắt buộc đăng nhập mới được vào phòng bằng mã
    if (!requireLoginToJoin()) return;

    const rawCode = normalizeRoomCode(roomCodeInput.value);

    // Validate 1: Kiểm tra mã trống
    if (!rawCode) {
      showInputError('Vui lòng nhập mã phòng (6 chữ số, hoặc 10 ký tự nếu là phòng riêng tư).');
      return;
    }

    // Validate 2: BE-14 — 6 chữ số (công khai) HOẶC 10 ký tự base32 Crockford (riêng tư), không phân biệt hoa/thường
    if (!isValidRoomCode(rawCode)) {
      showInputError(
        /^\d+$/.test(rawCode)
          ? 'Mã phòng không hợp lệ! Mã phòng công khai gồm đúng 6 chữ số (ví dụ: 102938).'
          : 'Mã phòng không hợp lệ! Mã phòng riêng tư gồm đúng 10 ký tự chữ và số (ví dụ: 7K3M9QX2AB).'
      );
      return;
    }

    // Sau khi validate hợp lệ, gửi request lên Backend
    joinBtn.disabled = true;
    joinBtn.classList.add('loading');

    try {
      const response = await apiService.joinRoomByCode(rawCode);

      if (response.success) {
        // Điều hướng vào đúng phòng và hiển thị vai trò theo response từ máy chủ
        openRoomModal(response.room, response.role, response.roleMessage);
        roomCodeInput.value = '';
      }
    } catch (error) {
      // Hiển thị lỗi rõ ràng khi phòng không tồn tại hoặc đã đóng
      showInputError(error.message);
      showToast(error.message, 'error');
    } finally {
      joinBtn.disabled = false;
      joinBtn.classList.remove('loading');
    }
  }

  /**
   * Hiển thị lỗi ngay dưới ô nhập mã
   */
  function showInputError(msg) {
    codeErrorMessage.textContent = msg;
    roomCodeInput.classList.add('is-invalid');
    roomCodeInput.focus();
  }

  /**
   * Xóa thông báo lỗi ô nhập mã
   */
  function clearInputError() {
    codeErrorMessage.textContent = '';
    roomCodeInput.classList.remove('is-invalid');
  }

  /**
   * Render danh sách phòng theo bộ lọc và tìm kiếm
   */
  function renderRooms() {
    let filtered = currentRooms.filter(room => {
      // Lọc theo trạng thái tab
      if (activeFilter !== 'ALL' && room.status !== activeFilter) {
        return false;
      }

      // Lọc theo từ khóa tìm kiếm (tên phòng hoặc tên chủ phòng hoặc mã phòng)
      if (searchQuery) {
        const matchName = room.name.toLowerCase().includes(searchQuery);
        const matchHost = room.hostName.toLowerCase().includes(searchQuery);
        const matchCode = room.code.includes(searchQuery);
        return matchName || matchHost || matchCode;
      }

      return true;
    });

    // Cập nhật trạng thái hiển thị
    if (filtered.length === 0) {
      roomsGrid.innerHTML = '';
      roomsEmpty.style.display = 'block';
      return;
    }

    roomsEmpty.style.display = 'none';

    // Tạo HTML cho từng thẻ phòng
    roomsGrid.innerHTML = filtered.map(room => {
      const statusMeta = window.ROOM_STATUS[room.status] || {
        label: room.status,
        className: 'status-waiting',
        icon: 'ℹ️'
      };

      const isFullOrPlaying = ['FULL_PLAYERS', 'PLAYING'].includes(room.status);
      const actionText = isFullOrPlaying ? 'Vào Xem (Khán Giả)' : 'Tham Gia Ngay';
      const btnClass = isFullOrPlaying ? 'btn-secondary' : 'btn-primary';

      return `
        <article class="room-card" data-room-code="${escapeHtml(room.code)}">
          <div>
            <div class="room-card-header">
              <span class="room-code-tag">#${escapeHtml(room.code)}</span>
              <span class="status-badge ${escapeHtml(statusMeta.className)}">
                <span>${escapeHtml(statusMeta.icon)}</span>
                <span>${escapeHtml(statusMeta.label)}</span>
              </span>
            </div>

            <h3 class="room-title" title="${escapeHtml(room.name)}">${escapeHtml(room.name)}</h3>
            
            <div class="room-host">
              <span>Chủ phòng:</span>
              <strong>${escapeHtml(room.hostName)}</strong>
              <span class="user-elo">(${Number(room.hostElo) || 0} Elo)</span>
            </div>

            <div class="room-meta-info">
              <div class="meta-item" title="Người chơi trong phòng">
                <span>👤</span>
                <span>${Number(room.playerCount) || 0}/${Number(room.maxPlayers) || 0} Kỳ thủ</span>
              </div>
              <div class="meta-item" title="Khán giả đang theo dõi">
                <span>👁️</span>
                <span>${Number(room.spectatorCount) || 0} Khán giả</span>
              </div>
              <div class="meta-item" title="Thời gian ván đấu">
                <span>⏱️</span>
                <span>${escapeHtml(room.timeLimit)}</span>
              </div>
            </div>
          </div>

          <div class="room-card-footer">
            <button class="btn ${btnClass} join-room-btn" data-code="${escapeHtml(room.code)}">
              <span>${actionText}</span>
              <span>→</span>
            </button>
          </div>
        </article>
      `;
    }).join('');

    // Gắn sự kiện click trực tiếp vào nút Tham Gia trên thẻ phòng
    document.querySelectorAll('.join-room-btn').forEach(button => {
      button.addEventListener('click', async (e) => {
        const code = e.currentTarget.getAttribute('data-code');
        await directJoinRoom(code);
      });
    });
  }

  /**
   * REV-16: chặn khách vào phòng; hiện form đăng nhập + thông báo.
   * @returns {boolean} true nếu đã đăng nhập
   */
  function requireLoginToJoin() {
    if (apiService.getCurrentUser()) return true;
    openLoginModal();
    showToast('Vui lòng đăng nhập để vào phòng.', 'warning');
    return false;
  }

  /**
   * Tham gia phòng trực tiếp từ nút trên thẻ phòng
   */
  async function directJoinRoom(code) {
    // REV-16: bắt buộc đăng nhập mới được vào phòng
    if (!requireLoginToJoin()) return;
    try {
      const response = await apiService.joinRoomByCode(code);
      if (response.success) {
        openRoomModal(response.room, response.role, response.roleMessage);
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  /**
   * Mở Modal điều hướng vào phòng
   * Tiêu chí chấp nhận 3: Điều hướng vào đúng phòng và hiển thị vai trò theo response từ máy chủ.
   * Tiêu chí chấp nhận 4 (COT-598): Tạo thành công đưa người dùng vào phòng với vai trò Chủ phòng, hiển thị vị trí Đối thủ đang trống và mã 6 số.
   */
  function openRoomModal(room, role, roleMessage) {
    const statusMeta = window.ROOM_STATUS[room.status] || { label: room.status, className: '' };

    if (modalRoomCode) modalRoomCode.textContent = `#${room.code}`;
    if (modalRoomName) modalRoomName.textContent = room.name || 'Phòng cờ';
    if (modalHostName) modalHostName.textContent = room.hostName || 'Chủ phòng';
    
    // Hiển thị vị trí Đối thủ (COT-598)
    if (modalOpponentName) {
      if (room.opponentName) {
        modalOpponentName.textContent = room.opponentName;
        modalOpponentName.className = 'opponent-badge';
      } else {
        modalOpponentName.textContent = 'Đang trống (Chờ kỳ thủ ghép trận)';
        modalOpponentName.className = 'opponent-badge empty-slot';
      }
    }

    if (modalRoomStatus) {
      modalRoomStatus.textContent = statusMeta.label;
      modalRoomStatus.className = `status-badge ${statusMeta.className}`;
    }

    if (modalUserRole) {
      if (role === 'HOST') {
        modalUserRole.textContent = 'CHỦ PHÒNG (HOST - QUÂN ĐỎ)';
        modalUserRole.className = 'role-badge role-player';
      } else if (role === 'PLAYER') {
        modalUserRole.textContent = 'KỲ THỦ (NGƯỜI CHƠI 2 - QUÂN ĐEN)';
        modalUserRole.className = 'role-badge role-player';
      } else {
        modalUserRole.textContent = 'KHÁN GIẢ (QUAN SÁT VIÊN)';
        modalUserRole.className = 'role-badge role-spectator';
      }
    }

    if (modalRoleNotice) modalRoleNotice.textContent = roleMessage;

    // COT-599: Cập nhật mã phòng đang mở và đường dẫn chia sẻ mạng xã hội
    currentActiveRoomCode = room.code;
    const shareLinks = apiService.generateShareLinks(room.code);
    if (shareFbBtn) shareFbBtn.href = shareLinks.facebookUrl;
    if (shareMessengerBtn) shareMessengerBtn.href = shareLinks.messengerUrl;
    if (shareZaloBtn) shareZaloBtn.href = shareLinks.zaloUrl;

    roomModal.style.display = 'flex';

    // COT-630: Khởi tạo khung chat và kiểm tra phân quyền hiển thị (AC 2 & AC 3)
    setupRoomChat(room, role);
  }

  function closeModal() {
    roomModal.style.display = 'none';
    if (floatingChatWidget && (!activeChatService || !activeChatService.isChatAllowed())) {
      floatingChatWidget.style.display = 'none';
    }
  }

  /**
   * ===================================================================
   * COT-599: Giao diện Danh sách bạn bè và nút Chia sẻ liên kết mời phòng
   * ===================================================================
   */

  /**
   * Sao chép mã phòng 6 chữ số
   * Tiêu chí chấp nhận 4: Nút "Sao chép mã phòng" kèm toast thông báo thành công.
   */
  async function handleCopyRoomCode() {
    if (!currentActiveRoomCode) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentActiveRoomCode);
      }
      showToast(`Đã sao chép mã phòng [#${currentActiveRoomCode}] vào bộ nhớ tạm!`, 'success');
    } catch {
      showToast(`Mã phòng của bạn: ${currentActiveRoomCode}`, 'info');
    }
  }

  /**
   * Sao chép liên kết mời phòng
   * Tiêu chí chấp nhận 4: Nút "Sao chép link mời" kèm toast thông báo thành công.
   */
  async function handleCopyRoomLink() {
    if (!currentActiveRoomCode) return;
    const shareInfo = apiService.generateShareLinks(currentActiveRoomCode);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareInfo.url);
      }
      showToast(`Đã sao chép link mời [${shareInfo.url}] vào bộ nhớ tạm!`, 'success');
    } catch {
      showToast(`Link mời: ${shareInfo.url}`, 'info');
    }
  }

  /**
   * Mở Modal Danh sách bạn bè để mời vào phòng
   * Tiêu chí chấp nhận 1: Mở danh sách bạn bè kèm trạng thái Trực tuyến/Ngoại tuyến.
   */
  async function openFriendInviteModal() {
    try {
      friendsList = await apiService.getFriendsList();
      friendSearchKeyword = '';
      if (friendSearchInput) friendSearchInput.value = '';
      renderFriendsList();
      if (friendInviteModal) friendInviteModal.style.display = 'flex';
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function closeFriendInviteModal() {
    if (friendInviteModal) {
      friendInviteModal.style.display = 'none';
    }
  }

  /**
   * Render danh sách bạn bè (Trực tuyến / Ngoại tuyến)
   * Tiêu chí chấp nhận 1: Hiển thị đúng trạng thái Trực tuyến/Ngoại tuyến.
   * Tiêu chí chấp nhận 2: Gửi lời mời hiển thị đếm ngược 60 giây cho Chủ phòng.
   * Tiêu chí chấp nhận 3: Giao diện KHÔNG được khóa hay giữ trước vị trí Đối thủ.
   */
  function renderFriendsList() {
    if (!friendsListContainer) return;

    let filtered = [...friendsList];
    if (friendSearchKeyword) {
      filtered = filtered.filter(f => 
        (f.displayName && f.displayName.toLowerCase().includes(friendSearchKeyword)) ||
        (f.username && f.username.toLowerCase().includes(friendSearchKeyword))
      );
    }

    // Sắp xếp: Trực tuyến lên trước, sau đó đến Ngoại tuyến
    filtered.sort((a, b) => (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0));

    // Thống kê số lượng
    const onlineCount = friendsList.filter(f => f.isOnline).length;
    if (onlineFriendsCountEl) onlineFriendsCountEl.textContent = onlineCount;
    if (totalFriendsCountEl) totalFriendsCountEl.textContent = friendsList.length;

    if (filtered.length === 0) {
      friendsListContainer.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          Không tìm thấy bạn bè nào phù hợp.
        </div>
      `;
      return;
    }

    friendsListContainer.innerHTML = filtered.map(friend => {
      const isOnline = Boolean(friend.isOnline);
      const initial = (friend.displayName || friend.username || 'K').charAt(0).toUpperCase();
      const inviteInfo = activeInvitationTimers.get(friend.id);

      let actionHtml = '';
      if (inviteInfo) {
        // Đang có lời mời chờ phản hồi (đếm ngược 60 giây)
        actionHtml = `
          <div class="waiting-invite-box">
            <span class="waiting-countdown">⏳ <strong id="cd-${escapeHtml(friend.id)}">${Number(inviteInfo.remainingSec) || 0}s</strong></span>
            <button class="btn-cancel-invite" data-friend-id="${escapeHtml(friend.id)}" data-inv-id="${escapeHtml(inviteInfo.invitationId)}">
              Hủy mời
            </button>
          </div>
        `;
      } else if (isOnline) {
        actionHtml = `
          <button class="btn btn-gold btn-invite-friend" data-friend-id="${escapeHtml(friend.id)}">
            Mời đấu
          </button>
        `;
      } else {
        actionHtml = `
          <button class="btn btn-secondary btn-invite-friend" disabled title="Kỳ thủ hiện đang ngoại tuyến">
            Ngoại tuyến
          </button>
        `;
      }

      return `
        <div class="friend-item" data-id="${escapeHtml(friend.id)}">
          <div class="friend-profile-wrap">
            <div class="friend-avatar-wrap">
              <div class="friend-avatar">${escapeHtml(initial)}</div>
              <span class="friend-status-dot ${isOnline ? 'online' : 'offline'}"></span>
            </div>
            <div class="friend-details">
              <span class="friend-name">${escapeHtml(friend.displayName || friend.username)}</span>
              <div class="friend-meta">
                <span>Elo: <strong>${Number(friend.elo) || 1200}</strong></span>
                <span>•</span>
                <span class="friend-status-text ${isOnline ? 'online' : 'offline'}">
                  ${isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}
                </span>
              </div>
            </div>
          </div>
          <div class="friend-action-box">
            ${actionHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Xử lý gửi lời mời tới bạn bè đang Trực tuyến
   * Tiêu chí chấp nhận 2: Gửi lời mời hiển thị đếm ngược 60 giây cho Chủ phòng.
   * Tiêu chí chấp nhận 3: Giao diện KHÔNG được khóa hay giữ trước vị trí Đối thủ.
   */
  async function handleInviteFriend(friendId) {
    if (!currentActiveRoomCode) {
      showToast('Không xác định được phòng cờ để mời.', 'error');
      return;
    }

    try {
      const res = await apiService.sendFriendInvitation(friendId, currentActiveRoomCode);

      if (res.success) {
        showToast(res.message + ' (Đang chờ phản hồi 60s)', 'success');

        let remainingSec = 60;
        const invId = res.invitation.id;

        const timerId = setInterval(() => {
          remainingSec--;
          const item = activeInvitationTimers.get(friendId);
          if (item) {
            item.remainingSec = remainingSec;
          }

          const countdownEl = document.getElementById(`cd-${friendId}`);
          if (countdownEl) {
            countdownEl.textContent = `${remainingSec}s`;
          }

          if (remainingSec <= 0) {
            clearInterval(timerId);
            activeInvitationTimers.delete(friendId);
            renderFriendsList();
            showToast(`Lời mời gửi tới "${res.invitation.friendName}" đã hết hạn phản hồi (60s).`, 'info');
          }
        }, 1000);

        activeInvitationTimers.set(friendId, {
          timerId,
          remainingSec,
          invitationId: invId
        });

        renderFriendsList();
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  /**
   * Xử lý hủy lời mời khi đang chờ phản hồi
   */
  async function handleCancelInvitation(friendId, invitationId) {
    const timerInfo = activeInvitationTimers.get(friendId);
    if (timerInfo && timerInfo.timerId) {
      clearInterval(timerInfo.timerId);
    }
    activeInvitationTimers.delete(friendId);

    try {
      if (invitationId) {
        await apiService.cancelFriendInvitation(invitationId);
      }
      showToast('Đã hủy lời mời thi đấu thành công.', 'info');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      renderFriendsList();
    }
  }

  /**
   * ===================================================================
   * COT-598: Code Modal Tạo phòng chơi (Công khai / Riêng tư)
   * ===================================================================
   */

  /**
   * Mở Modal Tạo phòng chơi
   * Phạm vi: Chỉ hiển thị/cho phép thao tác khi người dùng đã đăng nhập.
   */
  function openCreateRoomModal() {
    const currentUser = apiService.getCurrentUser();
    if (!currentUser) {
      showToast('Vui lòng đăng nhập để tạo phòng chơi.', 'error');
      return;
    }

    // Reset Form
    if (roomNameInput) {
      roomNameInput.value = '';
    }
    clearCreateRoomError();

    if (optPublic) optPublic.checked = true;
    optPublicLabel?.classList.add('selected');
    optPrivateLabel?.classList.remove('selected');

    if (roomPasswordGroup) roomPasswordGroup.style.display = 'none';
    if (roomPasswordInput) roomPasswordInput.value = '';

    if (createRoomModal) {
      createRoomModal.style.display = 'flex';
      setTimeout(() => roomNameInput?.focus(), 60);
    }
  }

  /**
   * Đóng Modal Tạo phòng chơi
   */
  function closeCreateRoomModal() {
    if (createRoomModal) {
      createRoomModal.style.display = 'none';
    }
    clearCreateRoomError();
  }

  /**
   * Xử lý gửi Form Tạo phòng chơi
   * Tiêu chí chấp nhận 1: Form có Tên Room và lựa chọn Công khai/Riêng tư.
   * Tiêu chí chấp nhận 2: Không gửi request nếu Tên Room để trống hoặc không hợp lệ.
   * Tiêu chí chấp nhận 3: Không tạo nhiều phòng do bấm liên tục (Lock button / Spinner).
   * Tiêu chí chấp nhận 4: Tạo thành công đưa người dùng vào phòng với vai trò Chủ phòng.
   */
  async function handleCreateRoomSubmit(e) {
    e.preventDefault();
    clearCreateRoomError();

    // Tiêu chí 3: Chặn tạo nhiều phòng do bấm liên tục (Double submit lock)
    if (isCreatingRoom) {
      return;
    }

    const rawName = roomNameInput ? roomNameInput.value.trim() : '';

    // Tiêu chí 2: Không gửi request nếu Tên Room để trống
    // FE-03: bắt buộc đăng nhập mới được tạo phòng
    if (!apiService.getCurrentUser()) {
      closeCreateRoomModal();
      openLoginModal();
      showToast('Vui lòng đăng nhập để tạo phòng.', 'warning');
      return;
    }

    if (!rawName) {
      showCreateRoomError('Tên phòng không được để trống.');
      roomNameInput?.focus();
      return;
    }

    if (rawName.length < 3 || rawName.length > 50) {
      showCreateRoomError('Tên phòng phải có độ dài từ 3 đến 50 ký tự.');
      roomNameInput?.focus();
      return;
    }

    const isPrivate = optPrivate ? optPrivate.checked : false;
    const password = (isPrivate && roomPasswordInput) ? roomPasswordInput.value.trim() : null;

    // Bắt đầu gửi yêu cầu: Khóa nút và hiển thị trạng thái đang xử lý
    isCreatingRoom = true;
    if (submitCreateRoomBtn) submitCreateRoomBtn.disabled = true;
    if (createRoomSpinner) createRoomSpinner.style.display = 'inline-block';
    if (createRoomBtnText) createRoomBtnText.textContent = 'Đang tạo phòng...';

    try {
      const response = await apiService.createRoom({
        name: rawName,
        isPrivate,
        password
      });

      if (response.success) {
        closeCreateRoomModal();
        await loadRooms();
        showToast(`Tạo phòng cờ "${response.room.name}" thành công!`, 'success');

        // Tiêu chí 4: Điều hướng người tạo vào Room với vai trò Chủ phòng
        openRoomModal(response.room, response.role, response.roleMessage);
      }
    } catch (error) {
      showCreateRoomError(error.message);
      showToast(error.message, 'error');
    } finally {
      isCreatingRoom = false;
      if (submitCreateRoomBtn) submitCreateRoomBtn.disabled = false;
      if (createRoomSpinner) createRoomSpinner.style.display = 'none';
      if (createRoomBtnText) createRoomBtnText.textContent = '+ Tạo Phòng Ngay';
    }
  }

  function showCreateRoomError(message) {
    if (roomNameError) {
      roomNameError.textContent = message;
      roomNameError.style.display = 'block';
    }
    if (roomNameInput) {
      roomNameInput.classList.add('input-error');
    }
  }

  function clearCreateRoomError() {
    if (roomNameError) {
      roomNameError.textContent = '';
      roomNameError.style.display = 'none';
    }
    if (roomNameInput) {
      roomNameInput.classList.remove('input-error');
    }
  }

  /**
   * Cập nhật các con số thống kê trên thanh lọc
   */
  function updateBadgeCounts() {
    const total = currentRooms.length;
    const waiting = currentRooms.filter(r => r.status === 'WAITING_OPPONENT').length;
    const full = currentRooms.filter(r => r.status === 'FULL_PLAYERS').length;
    const playing = currentRooms.filter(r => r.status === 'PLAYING').length;
    const rematch = currentRooms.filter(r => r.status === 'WAITING_NEW_GAME').length;

    totalRoomsCountEl.textContent = total;
    waitingRoomsCountEl.textContent = waiting;

    countAllEl.textContent = total;
    countWaitingEl.textContent = waiting;
    countFullEl.textContent = full;
    countPlayingEl.textContent = playing;
    countRematchEl.textContent = rematch;
  }

  function setLoading(isLoading) {
    roomsLoading.style.display = isLoading ? 'block' : 'none';
    if (isLoading) roomsEmpty.style.display = 'none';
  }

  /**
   * Hiển thị thông báo Toast
   */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(string) {
    return String(string)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * FE-04: chỉ chấp nhận URL ảnh an toàn (https hoặc /uploads/... hoặc data:image).
   * Trả chuỗi rỗng nếu không hợp lệ để tránh chèn URL lạ vào thuộc tính src.
   */
  function safeAvatarUrl(url) {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) return '';
    if (raw.startsWith('/uploads/') && !raw.includes('..')) return raw;
    if (/^https:\/\//i.test(raw)) return raw;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
    return '';
  }

  /** FE-04: ảnh đại diện an toàn cho innerHTML (rỗng -> hiện ký tự đầu tên) */
  function avatarMarkup(url, fallbackText) {
    const safeUrl = safeAvatarUrl(url);
    if (safeUrl) {
      return `<img src="${escapeHtml(safeUrl)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }
    return escapeHtml(String(fallbackText || '?').slice(0, 1));
  }

  /**
   * ===================================================================
   * COT-603: Xử lý luồng mở link mời phòng & Đăng nhập chuyển hướng
   * ===================================================================
   */

  function updateUserAuthUi() {
    const user = apiService.getCurrentUser();
    if (user) {
      if (userProfileBar) userProfileBar.style.display = 'flex';
      if (openLoginModalBtn) openLoginModalBtn.style.display = 'none';
      const nameEl = document.getElementById('currentUserName');
      const eloEl = document.getElementById('currentUserElo');
      const avatarEl = document.getElementById('currentUserAvatar');
      if (nameEl) nameEl.textContent = user.displayName || user.username || 'Kỳ Thủ';
      if (eloEl) eloEl.textContent = Number.isFinite(user.elo) ? user.elo : (user.eloRating || 1000);
      if (avatarEl) {
        // FE-04: chỉ render ảnh khi URL thuộc whitelist
        const safeUrl = safeAvatarUrl(user.avatarUrl);
        if (safeUrl) {
          avatarEl.innerHTML = avatarMarkup(safeUrl, user.displayName);
        } else {
          avatarEl.textContent = user.avatar || (user.displayName ? user.displayName.charAt(0).toUpperCase() : '棋');
        }
      }
    } else {
      if (userProfileBar) userProfileBar.style.display = 'none';
      if (openLoginModalBtn) openLoginModalBtn.style.display = 'inline-flex';
    }
  }

  async function handleLogout() {
    if (authService) {
      await authService.logout();
    }
    apiService.setCurrentUser(null);
    updateUserAuthUi();
    showToast('Đã đăng xuất tài khoản. Bạn đang ở chế độ khách.', 'info');
    openLoginModal();
  }

  function openLoginModal(pendingRoomCode = null) {
    if (!loginModal) return;
    if (pendingRoomCode) {
      if (loginPendingRoomBanner) loginPendingRoomBanner.style.display = 'flex';
      if (pendingRoomCodeDisplay) pendingRoomCodeDisplay.textContent = pendingRoomCode;
    } else {
      const storedPending = apiService.getPendingRoomInvite();
      if (storedPending && loginPendingRoomBanner) {
        loginPendingRoomBanner.style.display = 'flex';
        if (pendingRoomCodeDisplay) pendingRoomCodeDisplay.textContent = storedPending;
      } else if (loginPendingRoomBanner) {
        loginPendingRoomBanner.style.display = 'none';
      }
    }
    clearLoginErrors();
    loginModal.style.display = 'flex';
    loginUsernameInput?.focus();
  }

  function closeLoginModal() {
    if (loginModal) loginModal.style.display = 'none';
    clearLoginErrors();
  }

  function clearLoginErrors() {
    if (loginUsernameError) {
      loginUsernameError.textContent = '';
      loginUsernameError.style.display = 'none';
    }
    if (loginPasswordError) {
      loginPasswordError.textContent = '';
      loginPasswordError.style.display = 'none';
    }
    if (loginGeneralError) {
      loginGeneralError.textContent = '';
      loginGeneralError.style.display = 'none';
    }
    if (oauthGeneralError) {
      oauthGeneralError.textContent = '';
      oauthGeneralError.style.display = 'none';
    }
    loginUsernameInput?.classList.remove('input-error');
    loginPasswordInput?.classList.remove('input-error');
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    clearLoginErrors();

    const username = loginUsernameInput ? loginUsernameInput.value.trim() : '';
    const password = loginPasswordInput ? loginPasswordInput.value.trim() : '';

    const validation = typeof window.validateLoginForm === 'function'
      ? window.validateLoginForm({ username, password })
      : { isValid: Boolean(username && password), errors: {} };

    if (!validation.isValid) {
      if (validation.errors.username && loginUsernameError) {
        loginUsernameError.textContent = validation.errors.username.error;
        loginUsernameError.style.display = 'block';
        loginUsernameInput?.classList.add('input-error');
      }
      if (validation.errors.password && loginPasswordError) {
        loginPasswordError.textContent = validation.errors.password.error;
        loginPasswordError.style.display = 'block';
        loginPasswordInput?.classList.add('input-error');
      }
      return;
    }

    // Hiển thị trạng thái đang xử lý và khóa nút (COT-579 AC 3)
    if (submitLoginBtn) submitLoginBtn.disabled = true;
    if (loginSpinner) loginSpinner.style.display = 'inline-block';
    if (loginBtnText) loginBtnText.textContent = 'Đang đăng nhập...';

    try {
      let res;
      if (authService) {
        res = await authService.login({ username, password });
      } else {
        res = {
          success: true,
          user: {
            id: 'user-' + Date.now(),
            username,
            displayName: username,
            elo: 1000,
            avatar: username.charAt(0).toUpperCase()
          }
        };
      }

      if (!res.success) {
        if (loginGeneralError) {
          loginGeneralError.textContent = res.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.';
          loginGeneralError.style.display = 'block';
        }
        return;
      }

      apiService.setCurrentUser(res.user);
      updateUserAuthUi();
      closeLoginModal();

      // COT-603 AC 2: Sau khi đăng nhập, kiểm tra chuyển hướng vào phòng đang chờ
      const redirectResult = await apiService.handlePostLoginRoomRedirect();
      if (redirectResult.hasPending) {
        if (redirectResult.success && redirectResult.room) {
          openRoomModal(redirectResult.room, redirectResult.role, redirectResult.roleMessage);
          showToast(redirectResult.roleMessage || 'Đã vào phòng từ liên kết mời thành công!', 'success');
        } else {
          showToast(redirectResult.error || 'Room không còn khả dụng.', 'error');
        }
      } else {
        showToast('Đăng nhập thành công!', 'success');
      }
    } catch (err) {
      if (loginGeneralError) {
        loginGeneralError.textContent = err.message || 'Tên đăng nhập hoặc mật khẩu không chính xác.';
        loginGeneralError.style.display = 'block';
      }
    } finally {
      if (submitLoginBtn) submitLoginBtn.disabled = false;
      if (loginSpinner) loginSpinner.style.display = 'none';
      if (loginBtnText) loginBtnText.textContent = 'Đang Nhập';
    }
  }

  /**
   * SEC-05: Đăng nhập Google qua Google Identity Services (GIS).
   * Facebook đã bị bỏ. Nếu chưa cấu hình VITE_GOOGLE_CLIENT_ID thì nút Google bị ẩn.
   */
  function getGoogleClientId() {
    const meta = document.querySelector('meta[name="google-client-id"]');
    const raw = (meta && meta.getAttribute('content')) || '';
    if (!raw || raw.includes('%VITE_GOOGLE_CLIENT_ID%')) return '';
    return raw.trim();
  }

  function showOAuthError(message) {
    if (oauthGeneralError) {
      oauthGeneralError.textContent = message;
      oauthGeneralError.style.display = 'block';
    }
  }

  async function completeGoogleLogin(credential) {
    try {
      const res = await authService.loginWithOAuth('google', { credential });
      if (!res.success) {
        showOAuthError(res.error || 'Đăng nhập Google thất bại.');
        return;
      }

      apiService.setCurrentUser(res.user);
      updateUserAuthUi();
      closeLoginModal();
      showToast('Đăng nhập Google thành công!', 'success');

      const redirectResult = await apiService.handlePostLoginRoomRedirect();
      if (redirectResult.hasPending && redirectResult.success && redirectResult.room) {
        openRoomModal(redirectResult.room, redirectResult.role, redirectResult.roleMessage);
      }
    } catch (err) {
      showOAuthError(err.message || 'Lỗi kết nối OAuth.');
    }
  }

  function handleOAuthLogin(provider) {
    if (oauthGeneralError) {
      oauthGeneralError.textContent = '';
      oauthGeneralError.style.display = 'none';
    }

    if (provider !== 'google') return;

    const clientId = getGoogleClientId();
    if (!clientId) {
      showOAuthError('Đăng nhập Google chưa được cấu hình (VITE_GOOGLE_CLIENT_ID).');
      return;
    }

    const gis = typeof window !== 'undefined' ? window.google : null;
    if (!gis || !gis.accounts || !gis.accounts.id) {
      showOAuthError('Chưa tải được Google Identity Services. Vui lòng thử lại sau.');
      return;
    }

    gis.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response && response.credential) {
          completeGoogleLogin(response.credential);
        } else {
          showOAuthError('Không nhận được ID token từ Google.');
        }
      },
    });
    gis.accounts.id.prompt();
  }

  /**
   * COT-579: Quản lý Modal & Logic Đăng ký tài khoản
   */
  function openRegisterModal() {
    if (!registerModal) return;
    clearRegisterErrors();
    if (registerSuccessBanner) registerSuccessBanner.style.display = 'none';
    if (registerInputsArea) registerInputsArea.style.display = 'block';
    if (submitRegisterBtn) submitRegisterBtn.style.display = 'inline-block';
    registerModal.style.display = 'flex';
    registerUsernameInput?.focus();
  }

  function closeRegisterModal() {
    if (registerModal) registerModal.style.display = 'none';
    clearRegisterErrors();
  }

  function clearRegisterErrors() {
    [registerUsernameError, registerDisplayNameError, registerEmailError, registerPasswordError, registerConfirmPasswordError].forEach(el => {
      if (el) {
        el.textContent = '';
        el.style.display = 'none';
      }
    });
    [registerUsernameInput, registerDisplayNameInput, registerEmailInput, registerPasswordInput, registerConfirmPasswordInput].forEach(inp => {
      inp?.classList.remove('input-error');
    });
  }

  function updateRegisterChecklist() {
    const pass = registerPasswordInput ? registerPasswordInput.value : '';
    const confirm = registerConfirmPasswordInput ? registerConfirmPasswordInput.value : '';

    const isLengthOk = pass.length >= 8;
    const isAlphaNumOk = /[A-Za-z]/.test(pass) && /\d/.test(pass);
    const isMatchOk = Boolean(pass && pass === confirm);

    if (regChkLength) {
      regChkLength.classList.toggle('is-valid', isLengthOk);
      regChkLength.querySelector('.chk-icon').textContent = isLengthOk ? '●' : '○';
    }
    if (regChkAlphaNum) {
      regChkAlphaNum.classList.toggle('is-valid', isAlphaNumOk);
      regChkAlphaNum.querySelector('.chk-icon').textContent = isAlphaNumOk ? '●' : '○';
    }
    if (regChkMatch) {
      regChkMatch.classList.toggle('is-valid', isMatchOk);
      regChkMatch.querySelector('.chk-icon').textContent = isMatchOk ? '●' : '○';
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    clearRegisterErrors();

    const username = registerUsernameInput ? registerUsernameInput.value : '';
    const displayName = registerDisplayNameInput ? registerDisplayNameInput.value : '';
    const email = registerEmailInput ? registerEmailInput.value : '';
    const password = registerPasswordInput ? registerPasswordInput.value : '';
    const confirmPassword = registerConfirmPasswordInput ? registerConfirmPasswordInput.value : '';

    // AC 2: Validate client-side
    const validation = typeof window.validateRegisterForm === 'function'
      ? window.validateRegisterForm({ username, displayName, email, password, confirmPassword })
      : { isValid: false, errors: {} };

    if (!validation.isValid) {
      if (validation.errors.username && registerUsernameError) {
        registerUsernameError.textContent = validation.errors.username.error;
        registerUsernameError.style.display = 'block';
        registerUsernameInput?.classList.add('input-error');
      }
      if (validation.errors.displayName && registerDisplayNameError) {
        registerDisplayNameError.textContent = validation.errors.displayName.error;
        registerDisplayNameError.style.display = 'block';
        registerDisplayNameInput?.classList.add('input-error');
      }
      if (validation.errors.email && registerEmailError) {
        registerEmailError.textContent = validation.errors.email.error;
        registerEmailError.style.display = 'block';
        registerEmailInput?.classList.add('input-error');
      }
      if (validation.errors.password && registerPasswordError) {
        registerPasswordError.textContent = validation.errors.password.error;
        registerPasswordError.style.display = 'block';
        registerPasswordInput?.classList.add('input-error');
      }
      if (validation.errors.confirmPassword && registerConfirmPasswordError) {
        registerConfirmPasswordError.textContent = validation.errors.confirmPassword.error;
        registerConfirmPasswordError.style.display = 'block';
        registerConfirmPasswordInput?.classList.add('input-error');
      }
      return;
    }

    // AC 3: Khóa nút tránh double submit
    if (submitRegisterBtn) submitRegisterBtn.disabled = true;
    if (registerSpinner) registerSpinner.style.display = 'inline-block';
    if (registerBtnText) registerBtnText.textContent = 'Đang đăng ký...';

    try {
      let res;
      if (authService) {
        res = await authService.register({ username, displayName, email, password, confirmPassword });
      } else {
        res = { success: true, message: 'Đăng ký tài khoản thành công! Vui lòng đăng nhập.' };
      }

      if (!res.success) {
        showToast(res.error || 'Đăng ký thất bại.', 'error');
        return;
      }

      // AC 4: Thông báo thành công và chuyển sang màn hình Đăng nhập (không tự đăng nhập)
      if (registerSuccessBanner) {
        if (registerSuccessMsg) registerSuccessMsg.textContent = res.message;
        registerSuccessBanner.style.display = 'flex';
      }
      if (registerInputsArea) registerInputsArea.style.display = 'none';
      if (submitRegisterBtn) submitRegisterBtn.style.display = 'none';

      showToast('Đăng ký thành công! Hãy đăng nhập với tài khoản mới.', 'success');

      setTimeout(() => {
        closeRegisterModal();
        openLoginModal();
      }, 1500);
    } catch (err) {
      showToast(err.message || 'Lỗi khi đăng ký tài khoản.', 'error');
    } finally {
      if (submitRegisterBtn) submitRegisterBtn.disabled = false;
      if (registerSpinner) registerSpinner.style.display = 'none';
      if (registerBtnText) registerBtnText.textContent = 'Đăng Ký Tài Khoản';
    }
  }

  /**
   * COT-585: Quản lý Modal & Logic Cập nhật Hồ sơ cá nhân & Avatar
   */
  function openProfileModal() {
    if (!profileModal) return;
    const user = apiService.getCurrentUser();
    if (!user) {
      openLoginModal();
      return;
    }

    if (profileUsernameInput) profileUsernameInput.value = user.username || '';
    if (profileEmailInput) profileEmailInput.value = user.email || `${user.username || 'user'}@cotuong69.vn`;
    if (profileDisplayNameInput) profileDisplayNameInput.value = user.displayName || user.username || '';
    if (profileEloDisplay) profileEloDisplay.textContent = `${user.elo || 1000} Elo`;

    selectedAvatarFile = null;
    selectedAvatarPreviewUrl = null;

    if (profileAvatarError) {
      profileAvatarError.textContent = '';
      profileAvatarError.style.display = 'none';
    }
    if (profileDisplayNameError) {
      profileDisplayNameError.textContent = '';
      profileDisplayNameError.style.display = 'none';
    }
    if (profileSuccessBanner) profileSuccessBanner.style.display = 'none';

    // Hiển thị Avatar hiện tại (FE-04: chỉ nhận URL thuộc whitelist)
    const profileSafeAvatar = safeAvatarUrl(user.avatarUrl);
    if (profileSafeAvatar) {
      if (profileAvatarImg) {
        profileAvatarImg.src = profileSafeAvatar;
        profileAvatarImg.style.display = 'block';
      }
      if (profileAvatarFallback) profileAvatarFallback.style.display = 'none';
    } else {
      if (profileAvatarImg) profileAvatarImg.style.display = 'none';
      if (profileAvatarFallback) {
        profileAvatarFallback.textContent = user.avatar || (user.displayName ? user.displayName.charAt(0).toUpperCase() : '棋');
        profileAvatarFallback.style.display = 'block';
      }
    }

    profileModal.style.display = 'flex';
  }

  function closeProfileModal() {
    if (profileModal) profileModal.style.display = 'none';
  }

  function handleAvatarFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (profileAvatarError) {
      profileAvatarError.textContent = '';
      profileAvatarError.style.display = 'none';
    }

    // AC 2: Kiểm tra dung lượng <= 2MB trên client
    const validation = typeof window.validateAvatarFile === 'function'
      ? window.validateAvatarFile(file)
      : { isValid: file.size <= 2 * 1024 * 1024, error: 'Dung lượng ảnh vượt quá 2MB' };

    if (!validation.isValid) {
      if (profileAvatarError) {
        profileAvatarError.textContent = validation.error;
        profileAvatarError.style.display = 'block';
      }
      e.target.value = '';
      return;
    }

    selectedAvatarFile = file;

    // Xem trước ảnh (Preview) trước khi lưu
    const reader = new FileReader();
    reader.onload = (readEvent) => {
      selectedAvatarPreviewUrl = readEvent.target.result;
      if (profileAvatarImg) {
        profileAvatarImg.src = selectedAvatarPreviewUrl;
        profileAvatarImg.style.display = 'block';
      }
      if (profileAvatarFallback) profileAvatarFallback.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    if (profileDisplayNameError) {
      profileDisplayNameError.textContent = '';
      profileDisplayNameError.style.display = 'none';
    }
    if (profileAvatarError) {
      profileAvatarError.textContent = '';
      profileAvatarError.style.display = 'none';
    }

    const newDisplayName = profileDisplayNameInput ? profileDisplayNameInput.value.trim() : '';

    // AC 1: Validate tên hiển thị
    const nameCheck = typeof window.validateDisplayName === 'function'
      ? window.validateDisplayName(newDisplayName)
      : { isValid: Boolean(newDisplayName && newDisplayName.length >= 2) };

    if (!nameCheck.isValid) {
      if (profileDisplayNameError) {
        profileDisplayNameError.textContent = nameCheck.error || 'Tên hiển thị không hợp lệ.';
        profileDisplayNameError.style.display = 'block';
      }
      profileDisplayNameInput?.focus();
      return;
    }

    if (submitProfileBtn) submitProfileBtn.disabled = true;
    if (profileSpinner) profileSpinner.style.display = 'inline-block';
    if (profileBtnText) profileBtnText.textContent = 'Đang lưu...';

    try {
      const currentUser = apiService.getCurrentUser() || {};
      let updatedUser = { ...currentUser, displayName: newDisplayName };

      if (userProfileService) {
        const nameRes = await userProfileService.updateDisplayName(newDisplayName);
        if (!nameRes.success) {
          showToast(nameRes.error, 'error');
          return;
        }
        updatedUser = nameRes.user;

        if (selectedAvatarFile) {
          const avatarRes = await userProfileService.updateAvatar(selectedAvatarFile, selectedAvatarPreviewUrl);
          if (avatarRes.success) {
            updatedUser = avatarRes.user;
          }
        }
      } else {
        if (selectedAvatarPreviewUrl) {
          updatedUser.avatar = selectedAvatarPreviewUrl;
          updatedUser.avatarUrl = selectedAvatarPreviewUrl;
        }
      }

      // AC 3: Đồng bộ ngay lập tức lên Header
      apiService.setCurrentUser(updatedUser);
      updateUserAuthUi();

      if (profileSuccessBanner) profileSuccessBanner.style.display = 'flex';
      showToast('Cập nhật hồ sơ cá nhân và ảnh đại diện thành công!', 'success');

      setTimeout(() => {
        closeProfileModal();
      }, 1200);
    } catch (err) {
      showToast(err.message || 'Lỗi khi cập nhật hồ sơ.', 'error');
    } finally {
      if (submitProfileBtn) submitProfileBtn.disabled = false;
      if (profileSpinner) profileSpinner.style.display = 'none';
      if (profileBtnText) profileBtnText.textContent = 'Lưu Thay Đổi';
    }
  }

  /**
   * COT-583: Quản lý Modal & Logic Quên mật khẩu
   */
  function openForgotPasswordModal() {
    if (!forgotPasswordModal) return;
    if (forgotEmailError) {
      forgotEmailError.textContent = '';
      forgotEmailError.style.display = 'none';
    }
    if (forgotEmailInput) {
      forgotEmailInput.classList.remove('input-error');
      forgotEmailInput.value = '';
    }
    if (forgotStatusBanner) forgotStatusBanner.style.display = 'none';
    forgotPasswordModal.style.display = 'flex';
    forgotEmailInput?.focus();
  }

  function closeForgotPasswordModal() {
    if (forgotPasswordModal) forgotPasswordModal.style.display = 'none';
  }

  async function handleForgotPasswordSubmit(e) {
    if (e) e.preventDefault();
    if (!forgotEmailInput) return;

    const email = forgotEmailInput.value.trim();
    if (forgotEmailError) {
      forgotEmailError.textContent = '';
      forgotEmailError.style.display = 'none';
    }
    forgotEmailInput.classList.remove('input-error');

    // AC 1: Validate email phía client trước khi gửi
    const validation = typeof window !== 'undefined' && window.validateEmail
      ? window.validateEmail(email)
      : { isValid: Boolean(email && email.includes('@')) };

    if (!validation.isValid) {
      if (forgotEmailError) {
        forgotEmailError.textContent = validation.error || 'Email không hợp lệ.';
        forgotEmailError.style.display = 'block';
      }
      forgotEmailInput.classList.add('input-error');
      forgotEmailInput.focus();
      return;
    }

    if (submitForgotBtn) submitForgotBtn.disabled = true;
    if (forgotSpinner) forgotSpinner.style.display = 'inline-block';
    if (forgotBtnText) forgotBtnText.textContent = 'Đang gửi...';

    try {
      const service = passwordResetService || (window.PasswordResetService ? new window.PasswordResetService() : null);
      let res;
      if (service) {
        res = await service.requestForgotPassword(email);
      } else {
        res = { success: true, message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn.' };
      }

      if (res.success) {
        // AC 2: Luôn hiển thị thông báo chung an toàn sau khi gửi
        if (forgotStatusBanner) {
          if (forgotStatusMsg) forgotStatusMsg.textContent = res.message;
          forgotStatusBanner.style.display = 'flex';
        }
        if (forgotEmailInput) forgotEmailInput.disabled = true;
        if (submitForgotBtn) submitForgotBtn.style.display = 'none';
      } else {
        if (forgotEmailError) {
          forgotEmailError.textContent = res.error || 'Có lỗi xảy ra.';
          forgotEmailError.style.display = 'block';
        }
      }
    } catch (err) {
      showToast(err.message || 'Lỗi kết nối máy chủ.', 'error');
    } finally {
      if (submitForgotBtn) submitForgotBtn.disabled = false;
      if (forgotSpinner) forgotSpinner.style.display = 'none';
      if (forgotBtnText) forgotBtnText.textContent = 'Gửi Yêu Cầu';
    }
  }

  /**
   * COT-583: Quản lý Modal & Logic Đặt lại mật khẩu mới
   */
  function openResetPasswordModal(token) {
    if (!resetPasswordModal) return;
    if (resetTokenInput) resetTokenInput.value = token || '';
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    if (newPasswordError) newPasswordError.style.display = 'none';
    if (confirmPasswordError) confirmPasswordError.style.display = 'none';
    if (resetTokenErrorBanner) resetTokenErrorBanner.style.display = 'none';
    if (resetSuccessBanner) resetSuccessBanner.style.display = 'none';
    if (resetInputsArea) resetInputsArea.style.display = 'block';
    if (submitResetBtn) submitResetBtn.style.display = 'inline-block';

    // AC 3: Kiểm tra token
    const extractedToken = typeof window !== 'undefined' && window.extractResetToken ? window.extractResetToken(token) : token;
    if (!extractedToken) {
      if (resetTokenErrorBanner) {
        if (resetTokenErrorTitle) resetTokenErrorTitle.textContent = 'Thiếu mã xác thực';
        if (resetTokenErrorMsg) resetTokenErrorMsg.textContent = 'Liên kết không chứa mã xác thực hợp lệ. Vui lòng kiểm tra lại email.';
        resetTokenErrorBanner.style.display = 'flex';
      }
      if (resetInputsArea) resetInputsArea.style.display = 'none';
      if (submitResetBtn) submitResetBtn.style.display = 'none';
    }

    resetPasswordModal.style.display = 'flex';
  }

  function closeResetPasswordModal() {
    if (resetPasswordModal) resetPasswordModal.style.display = 'none';
  }

  async function handleResetPasswordSubmit(e) {
    if (e) e.preventDefault();
    const token = resetTokenInput ? resetTokenInput.value : '';
    const newPassword = newPasswordInput ? newPasswordInput.value : '';
    const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

    if (newPasswordError) newPasswordError.style.display = 'none';
    if (confirmPasswordError) confirmPasswordError.style.display = 'none';

    // AC 5: Validate mật khẩu phía client
    const passCheck = typeof window !== 'undefined' && window.validateConfirmPassword
      ? window.validateConfirmPassword(newPassword, confirmPassword)
      : { isValid: newPassword.length >= 8 && newPassword === confirmPassword };

    if (!passCheck.isValid) {
      if (passCheck.code === 'PASSWORD_MISMATCH') {
        if (confirmPasswordError) {
          confirmPasswordError.textContent = passCheck.error;
          confirmPasswordError.style.display = 'block';
        }
      } else {
        if (newPasswordError) {
          newPasswordError.textContent = passCheck.error;
          newPasswordError.style.display = 'block';
        }
      }
      return;
    }

    if (submitResetBtn) submitResetBtn.disabled = true;
    if (resetSpinner) resetSpinner.style.display = 'inline-block';
    if (resetBtnText) resetBtnText.textContent = 'Đang cập nhật...';

    try {
      const service = passwordResetService || (window.PasswordResetService ? new window.PasswordResetService() : null);
      let res;
      if (service) {
        res = await service.resetPassword({ token, newPassword, confirmPassword });
      } else {
        res = { success: true, message: 'Đặt lại mật khẩu thành công!' };
      }

      if (res.success) {
        // AC 5: Thông báo thành công và chuyển về Đăng nhập
        if (resetSuccessBanner) {
          if (resetSuccessMsg) resetSuccessMsg.textContent = res.message;
          resetSuccessBanner.style.display = 'flex';
        }
        if (resetInputsArea) resetInputsArea.style.display = 'none';
        if (submitResetBtn) submitResetBtn.style.display = 'none';

        setTimeout(() => {
          closeResetPasswordModal();
          openLoginModal();
          showToast('Mật khẩu đã được cập nhật thành công. Vui lòng đăng nhập.', 'success');
        }, 1800);
      } else {
        // AC 4: Xử lý token hết hạn, đã dùng hoặc không hợp lệ
        if (['TOKEN_EXPIRED', 'TOKEN_ALREADY_USED', 'INVALID_TOKEN'].includes(res.code)) {
          if (resetTokenErrorBanner) {
            if (resetTokenErrorTitle) resetTokenErrorTitle.textContent = 'Không thể tiếp tục';
            if (resetTokenErrorMsg) resetTokenErrorMsg.textContent = res.error;
            resetTokenErrorBanner.style.display = 'flex';
          }
          if (resetInputsArea) resetInputsArea.style.display = 'none';
          if (submitResetBtn) submitResetBtn.style.display = 'none';
        } else {
          if (newPasswordError) {
            newPasswordError.textContent = res.error;
            newPasswordError.style.display = 'block';
          }
        }
      }
    } catch (err) {
      showToast(err.message || 'Lỗi kết nối máy chủ.', 'error');
    } finally {
      if (submitResetBtn) submitResetBtn.disabled = false;
      if (resetSpinner) resetSpinner.style.display = 'none';
      if (resetBtnText) resetBtnText.textContent = 'Xác Nhận Đổi Mật Khẩu';
    }
  }

  /**
   * AC 3: Kiểm tra URL khi khởi tạo trang xem có reset token hay không
   */
  function checkAndHandleResetTokenOnLoad() {
    if (typeof window === 'undefined' || !window.location) return;
    const token = typeof window.extractResetToken === 'function'
      ? window.extractResetToken(window.location.href)
      : null;

    if (token) {
      openResetPasswordModal(token);
      // FE-11: xoá token khỏi address bar để không lưu vào history/log
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('resetToken');
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * COT-603 AC 1 & AC 3: Kiểm tra và xử lý khi người dùng mở trang qua link mời phòng
   */
  async function checkAndHandleInviteLinkOnLoad() {
    if (typeof window === 'undefined' || !window.location) return;

    const currentUrl = window.location.href;
    const roomCode = apiService.extractRoomCodeFromUrl(currentUrl);

    if (!roomCode) {
      // Kiểm tra xem có phòng đang chờ trong session từ lần trước không
      const pendingCode = apiService.getPendingRoomInvite();
      if (pendingCode && apiService.getCurrentUser()) {
        const postLoginResult = await apiService.handlePostLoginRoomRedirect();
        if (postLoginResult.hasPending) {
          if (postLoginResult.success && postLoginResult.room) {
            openRoomModal(postLoginResult.room, postLoginResult.role, postLoginResult.roleMessage);
            showToast(postLoginResult.roleMessage || 'Đã kết nối vào phòng từ phiên trước!', 'success');
          } else {
            showToast(postLoginResult.error || 'Room không còn khả dụng.', 'error');
          }
        }
      }
      return;
    }

    try {
      const result = await apiService.handleOpenRoomLink(currentUrl);

      if (result.action === 'REDIRECT_LOGIN') {
        // AC 1: Chưa đăng nhập -> Chuyển hướng tới màn hình Đăng nhập & lưu phiên
        openLoginModal(result.pendingRoomCode);
        showToast(`Vui lòng đăng nhập để tham gia phòng [#${result.pendingRoomCode}]!`, 'info');
      } else if (result.action === 'JOIN_SUCCESS' && result.room) {
        // Đã đăng nhập -> Đưa vào phòng
        openRoomModal(result.room, result.role, result.roleMessage);
        showToast(result.roleMessage, 'success');
      }
    } catch (err) {
      // AC 3: Báo lỗi "Room không còn khả dụng"
      showToast(err.message || 'Room không còn khả dụng.', 'error');
    }
  }

  /**
   * ===================================================================
   * COT-630: Code giao diện Khung chat text và phân quyền hiển thị
   * ===================================================================
   */

  function setupRoomChat(room, role) {
    const roleUpper = String(role || '').toUpperCase();
    const isPlayerOrHost = roleUpper === 'HOST' || roleUpper === 'PLAYER';

    // AC 3: Khán giả hoàn toàn bị ẩn khung chat và không can thiệp được
    if (!isPlayerOrHost) {
      if (roomChatSection) roomChatSection.style.display = 'none';
      if (floatingChatWidget) floatingChatWidget.style.display = 'none';
      if (activeChatService) {
        activeChatService.setRole('SPECTATOR');
      }
      return;
    }

    // Hiển thị khung chat cho Chủ phòng & Đối thủ (AC 2)
    if (roomChatSection) roomChatSection.style.display = 'block';
    if (floatingChatWidget) floatingChatWidget.style.display = 'block';
    if (floatingChatRoomTitle) floatingChatRoomTitle.textContent = `Chat · #${room.code}`;

    // REV-16: bỏ user hardcode; chưa đăng nhập thì không có chat
    const apiUser = apiService && apiService.getCurrentUser ? apiService.getCurrentUser() : null;
    if (!apiUser) {
      if (roomChatSection) roomChatSection.style.display = 'none';
      if (floatingChatWidget) floatingChatWidget.style.display = 'none';
      return;
    }
    const displayName = apiUser.displayName || apiUser.username || 'Kỳ thủ';
    const currentUser = {
      id: apiUser.id,
      name: displayName,
      avatar: apiUser.avatar || displayName.slice(0, 1),
      role: roleUpper
    };

    if (!activeChatService || activeChatService.roomId !== room.code) {
      if (typeof window.ChatService === 'function') {
        activeChatService = new window.ChatService({
          roomId: room.code,
          currentUser: currentUser
        });
      }
    } else {
      activeChatService.setRole(roleUpper);
    }

    if (activeChatService) {
      // FE-05: setupRoomChat chạy mỗi lần mở phòng -> huỷ listener cũ trước khi đăng ký lại,
      // nếu không mỗi lần mở lại tin nhắn bị render N lần
      if (typeof unsubscribeChatEvents === 'function') unsubscribeChatEvents();
      unsubscribeChatEvents = activeChatService.onChatEvent((event) => {
        if (event.type === 'MESSAGE_ADDED' || event.type === 'MESSAGE_RECEIVED' || event.type === 'MESSAGE_STATUS_UPDATED') {
          renderChatMessages();
        } else if (event.type === 'CHAT_TOGGLED') {
          updateFloatingChatState();
        }
      });
      renderChatMessages();
    }
  }

  function renderChatMessages() {
    if (!activeChatService) return;
    const messages = activeChatService.getMessages();

    const renderList = (container) => {
      if (!container) return;
      container.innerHTML = messages.map(msg => {
        if (msg.isSystem) {
          return `
            <div class="chat-bubble-system">
              <span class="system-pill">${escapeHtml(msg.text)}</span>
            </div>
          `;
        }

        const isSelf = msg.isSelf;
        const statusHtml = isSelf ? `
          <div class="chat-bubble-status">
            ${msg.status === 'SENDING' ? '<span class="status-sending">⏳ Đang gửi</span>' : ''}
            ${msg.status === 'SENT' ? '<span class="status-sent">✓ Đã gửi</span>' : ''}
            ${msg.status === 'FAILED' ? '<span class="status-failed">⚠️ Thất bại</span>' : ''}
            ${msg.status === 'LOCAL' ? '<span class="status-local" title="Lobby chưa có kênh chat thời gian thực: tin chưa tới đối thủ. Hãy chat trong màn hình ván đấu.">💾 Chỉ lưu trên máy này</span>' : ''}
          </div>
        ` : '';

        return `
          <div class="chat-message-row ${isSelf ? 'message-self' : 'message-opponent'}">
            <div class="chat-bubble-avatar ${isSelf ? 'avatar-self' : 'avatar-opponent'}">
              ${avatarMarkup(msg.senderAvatar, msg.senderName)}
            </div>
            <div class="chat-bubble-content">
              <div class="chat-bubble-meta">
                <span class="chat-sender-name">${escapeHtml(msg.senderName)}</span>
                <span class="chat-timestamp">${escapeHtml(msg.timestamp)}</span>
              </div>
              <div class="chat-bubble-bubble">
                <p class="chat-bubble-text">${escapeHtml(msg.text)}</p>
              </div>
              ${statusHtml}
            </div>
          </div>
        `;
      }).join('');

      // AC 1: Tự động cuộn xuống dưới cùng
      container.scrollTop = container.scrollHeight;
    };

    renderList(roomModalChatMessages);
    renderList(floatingChatMessages);
  }

  function toggleFloatingChat() {
    if (!activeChatService || !activeChatService.isChatAllowed()) return;
    activeChatService.toggleChat();
    updateFloatingChatState();
  }

  function updateFloatingChatState() {
    if (!activeChatService) return;
    const isOpen = activeChatService.isOpen;
    if (floatingOpenChatBtn) floatingOpenChatBtn.style.display = isOpen ? 'none' : 'flex';
    if (floatingChatPanel) {
      floatingChatPanel.style.display = isOpen ? 'flex' : 'none';
      if (isOpen) {
        if (floatingChatInput) floatingChatInput.focus();
        if (floatingChatMessages) floatingChatMessages.scrollTop = floatingChatMessages.scrollHeight;
      }
    }
  }

  async function handleRoomChatSubmit(e) {
    if (e) e.preventDefault();
    if (!activeChatService) return;
    const text = roomChatInput ? roomChatInput.value : '';

    try {
      if (roomChatErrorTooltip) roomChatErrorTooltip.style.display = 'none';
      await activeChatService.sendMessage(text);
      if (roomChatInput) roomChatInput.value = '';
      if (roomChatCharCounter) roomChatCharCounter.textContent = '0/255';
    } catch (err) {
      if (roomChatErrorTooltip) {
        roomChatErrorTooltip.textContent = `⚠️ ${err.message}`;
        roomChatErrorTooltip.style.display = 'block';
      }
    }
  }

  async function handleFloatingChatSubmit(e) {
    if (e) e.preventDefault();
    if (!activeChatService) return;
    const text = floatingChatInput ? floatingChatInput.value : '';

    try {
      if (floatingChatError) floatingChatError.style.display = 'none';
      await activeChatService.sendMessage(text);
      if (floatingChatInput) floatingChatInput.value = '';
      if (floatingCharCounter) floatingCharCounter.textContent = '0/255';
    } catch (err) {
      if (floatingChatError) {
        floatingChatError.textContent = `⚠️ ${err.message}`;
        floatingChatError.style.display = 'block';
      }
    }
  }

  // Khởi chạy
  init();
});
