-- Nhiều tài khoản quản trị, phiên đăng nhập có thể thu hồi, rate limit dùng
-- chung giữa các instance và trigger tự cập nhật updated_at.

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(60) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'editor')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tên đăng nhập không phân biệt hoa/thường.
CREATE UNIQUE INDEX admin_users_username_key ON admin_users (lower(username));

-- Token là chuỗi ngẫu nhiên 256 bit; database chỉ lưu SHA-256 của token nên
-- lộ bảng này không đủ để đăng nhập.
CREATE TABLE admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE,
  user_agent VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX admin_sessions_active_user_idx
  ON admin_sessions (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions (expires_at);

-- UNLOGGED: ghi nhanh hơn vì không qua WAL; mất bộ đếm khi PostgreSQL crash
-- hoặc failover là chấp nhận được với dữ liệu rate limit.
CREATE UNLOGGED TABLE rate_limits (
  key_hash BYTEA PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX rate_limits_reset_at_idx ON rate_limits (reset_at);

-- Audit gắn với tài khoản thực hiện. actor (tên đăng nhập) vẫn được giữ dạng
-- văn bản để lịch sử còn đọc được khi tài khoản bị xóa.
ALTER TABLE activity_logs
  ADD COLUMN actor_id UUID REFERENCES admin_users (id) ON DELETE SET NULL;

CREATE INDEX activity_logs_actor_id_idx ON activity_logs (actor_id);

ALTER TABLE activity_logs DROP CONSTRAINT activity_logs_action_check;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_action_check
  CHECK (
    action IN ('CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'LOGIN', 'LOGOUT')
  );

ALTER TABLE activity_logs DROP CONSTRAINT activity_logs_entity_type_check;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_entity_type_check
  CHECK (
    entity_type IN (
      'vehicle',
      'article',
      'policy',
      'regulation',
      'legal_guide',
      'contact_submission',
      'admin_user',
      'system'
    )
  );

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER legal_resources_set_updated_at
  BEFORE UPDATE ON legal_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER contact_submissions_set_updated_at
  BEFORE UPDATE ON contact_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_users_set_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
