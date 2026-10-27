// BE-08: giới hạn số email lưu trong RAM để không phình vô hạn
const MAX_STORED_EMAILS = 100;

class EmailService {
  constructor() {
    this.sentEmails = [];
  }

  async sendPasswordResetEmail({ email, token, code, resetUrl }) {
    const record = {
      to: email,
      subject: 'Yêu cầu đặt lại mật khẩu - Cờ Tướng Online',
      token,
      code,
      resetUrl,
      sentAt: new Date(),
    };
    this.sentEmails.push(record);
    if (this.sentEmails.length > MAX_STORED_EMAILS) {
      this.sentEmails.splice(0, this.sentEmails.length - MAX_STORED_EMAILS);
    }

    // Stub không gửi mail thật: khi dev/demo in link ra terminal để đặt lại mật khẩu được
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EmailService] (dev) link đặt lại mật khẩu cho ${email}: ${resetUrl} | OTP: ${code}`);
    }
    return true;
  }
}

module.exports = new EmailService();
