/**
 * Đặt lại xác thực hai lớp KHẨN CẤP cho một tài khoản, khi không còn quản trị
 * viên nào đăng nhập được để đặt lại trong trang quản trị (ví dụ admin duy nhất
 * mất điện thoại và mã khôi phục).
 *
 *   npm run admin:reset-2fa -- <tên đăng nhập>
 *
 * Chạy trên máy có quyền truy cập database (VPS), đọc DATABASE_URL từ .env.
 * Xóa secret TOTP và mã khôi phục, thu hồi mọi phiên của tài khoản, ghi lịch
 * sử với người thực hiện "system". Lần đăng nhập sau người dùng phải đăng ký
 * 2FA lại (khi vai trò bắt buộc). Không cần TOTP_ENCRYPTION_KEY.
 */
import { createScriptPool } from './db-pool.js';

const username = process.argv[2]?.trim();
if (!username) {
  console.error('Cách dùng: npm run admin:reset-2fa -- <tên đăng nhập>');
  process.exit(1);
}

const pool = createScriptPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const found = await client.query(
    `SELECT id, username, (totp_secret_enc IS NOT NULL) AS enabled
     FROM admin_users WHERE lower(username) = lower($1) FOR UPDATE`,
    [username],
  );
  const user = found.rows[0];
  if (!user) {
    await client.query('ROLLBACK');
    console.error(`Không tìm thấy tài khoản "${username}".`);
    process.exitCode = 1;
  } else {
    await client.query(
      `UPDATE admin_users
       SET totp_secret_enc = NULL, totp_pending_secret_enc = NULL,
           totp_pending_created_at = NULL, totp_enabled_at = NULL,
           totp_last_step = NULL
       WHERE id = $1`,
      [user.id],
    );
    await client.query('DELETE FROM admin_recovery_codes WHERE user_id = $1', [
      user.id,
    ]);
    await client.query(
      `UPDATE admin_login_challenges SET consumed_at = NOW()
       WHERE user_id = $1 AND consumed_at IS NULL`,
      [user.id],
    );
    const revoked = await client.query(
      `UPDATE admin_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await client.query(
      `INSERT INTO activity_logs (actor, actor_id, action, entity_type, entity_id, entity_label)
       VALUES ('system', NULL, 'UPDATE', 'admin_user', $1, $2)`,
      [
        user.id,
        `Đặt lại xác thực hai lớp khẩn cấp (dòng lệnh): ${user.username}`,
      ],
    );
    await client.query('COMMIT');
    console.info(
      `Đã đặt lại 2FA cho "${user.username}"${user.enabled ? '' : ' (trước đó chưa bật)'}; thu hồi ${revoked.rowCount ?? 0} phiên.`,
    );
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
