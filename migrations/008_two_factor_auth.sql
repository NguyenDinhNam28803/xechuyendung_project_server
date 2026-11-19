-- Xác thực hai lớp (TOTP, RFC 6238) cho tài khoản quản trị.
--
-- Secret TOTP được mã hóa AES-256-GCM ở tầng ứng dụng bằng TOTP_ENCRYPTION_KEY
-- trước khi lưu: lộ bản backup database không đủ để sinh mã đăng nhập.

ALTER TABLE admin_users
  -- Secret đang dùng (đã mã hóa); NULL = chưa bật 2FA.
  ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT,
  -- Secret vừa tạo khi đăng ký, chỉ thành secret chính sau khi nhập đúng mã.
  ADD COLUMN IF NOT EXISTS totp_pending_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS totp_pending_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ,
  -- Bước thời gian (30 giây) của mã hợp lệ gần nhất: mã đã dùng không được
  -- chấp nhận lần hai (chống replay).
  ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;

-- 10 mã khôi phục dùng một lần khi mất thiết bị. Mã có 80 bit ngẫu nhiên nên
-- chỉ cần SHA-256 (không cần hàm băm chậm như mật khẩu).
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  code_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  UNIQUE (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS admin_recovery_codes_unused_idx
  ON admin_recovery_codes (user_id)
  WHERE used_at IS NULL;

-- Bước 2 của đăng nhập: mật khẩu đúng thì cấp mã thử thách (5 phút, tối đa 5
-- lần nhập mã); chỉ lưu SHA-256 của mã thử thách.
CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  user_agent VARCHAR(200),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS admin_login_challenges_expires_at_idx
  ON admin_login_challenges (expires_at);
