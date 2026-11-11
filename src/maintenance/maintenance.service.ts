import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { insertActivity, systemActor } from '../activity/activity.service.js';
import { ContactSubmissionsService } from '../contact-submissions/contact-submissions.service.js';
import { DatabaseService } from '../database/database.service.js';

const dayMs = 24 * 60 * 60 * 1000;
const sessionsAndRateLimitsLockKey = 7_804_202_033;
const activityRetentionLockKey = 7_804_202_034;
/** Không cho phép cấu hình xóa audit log mới hơn 30 ngày. */
const minimumActivityRetentionDays = 30;

/**
 * Lịch bảo trì dữ liệu chạy khi khởi động và sau đó mỗi 24 giờ.
 * Mỗi tác vụ chạy dưới advisory lock riêng: khi có nhiều instance, chỉ một
 * instance thực hiện, các instance khác bỏ qua ngay.
 *
 * Đánh đổi: dùng setInterval trong process thay vì cron bên ngoài giúp triển
 * khai đơn giản; nếu mọi instance đều tắt thì tác vụ tạm dừng cho tới lần khởi
 * động tiếp theo.
 */
@Injectable()
export class MaintenanceService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly database: DatabaseService,
    private readonly contactSubmissions: ContactSubmissionsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.database.isConfigured) return;
    void this.runAll();
    this.timer = setInterval(() => void this.runAll(), dayMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll() {
    await this.runTask('contact retention', async () => {
      const deleted = await this.contactSubmissions.purgeExpired();
      if (deleted > 0) {
        this.logger.log(`Purged ${deleted} expired contact submissions.`);
      }
    });
    await this.runTask('session and rate-limit cleanup', () =>
      this.purgeSessionsAndRateLimits(),
    );
    await this.runTask('activity retention', () => this.purgeOldActivity());
  }

  /** Xóa phiên đã hết hạn/thu hồi quá 30 ngày và bộ đếm rate limit đã hết hạn. */
  async purgeSessionsAndRateLimits() {
    await this.database.runExclusive(
      sessionsAndRateLimitsLockKey,
      async (client) => {
        await client.query(
          `DELETE FROM admin_sessions
         WHERE expires_at < NOW() - INTERVAL '30 days'
            OR revoked_at < NOW() - INTERVAL '30 days'`,
        );
        await client.query('DELETE FROM rate_limits WHERE reset_at < NOW()');
      },
    );
  }

  /**
   * Retention cho audit log, bật bằng ACTIVITY_RETENTION_DAYS (>= 30).
   * Mặc định tắt: thời hạn lưu audit là quyết định của doanh nghiệp/pháp lý.
   */
  async purgeOldActivity() {
    const days = readActivityRetentionDays(process.env.ACTIVITY_RETENTION_DAYS);
    if (days === undefined) return;
    await this.database.runExclusive(
      activityRetentionLockKey,
      async (client) => {
        const result = await client.query(
          `DELETE FROM activity_logs
         WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`,
          [days],
        );
        const deleted = result.rowCount ?? 0;
        if (deleted > 0) {
          await insertActivity(client, {
            actor: systemActor,
            action: 'DELETE',
            entityType: 'system',
            entityId: null,
            entityLabel: `Tự động xóa ${deleted} bản ghi lịch sử quá ${days} ngày`,
          });
          this.logger.log(`Purged ${deleted} activity log entries.`);
        }
      },
    );
  }

  private async runTask(name: string, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        `Maintenance task "${name}" failed; the next scheduled run will retry.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

export function readActivityRetentionDays(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < minimumActivityRetentionDays) {
    throw new Error(
      `ACTIVITY_RETENTION_DAYS must be an integer of at least ${minimumActivityRetentionDays}.`,
    );
  }
  return days;
}
