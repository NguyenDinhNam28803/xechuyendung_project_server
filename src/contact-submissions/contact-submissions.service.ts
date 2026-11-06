import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import {
  type PageResult,
  type PaginationQuery,
  toPageResult,
} from '../common/pagination.js';
import { DatabaseService } from '../database/database.service.js';
import type { ContactSubmissionInput } from './contact-submissions.validation.js';

export type ContactStatus =
  'new' | 'in_progress' | 'contacted' | 'closed' | 'spam';

type ContactRow = QueryResultRow & {
  id: string;
  name: string;
  phone: string;
  category: string;
  location: string;
  message: string;
  vehicleSlug: string;
  status: ContactStatus;
  consentText: string;
  consentAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ContactSubmissionsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ContactSubmissionsService.name);
  private readonly retentionDays = 90;
  private readonly purgeTimer: NodeJS.Timeout;

  constructor(private readonly database: DatabaseService) {
    this.purgeTimer = setInterval(
      () => void this.purgeExpiredWithLogging(),
      24 * 60 * 60 * 1000,
    );
    this.purgeTimer.unref();
  }

  onModuleInit() {
    if (!this.database.isConfigured) return;
    void this.purgeExpiredWithLogging();
  }

  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

  async create(input: ContactSubmissionInput) {
    const result = await this.database.query<ContactRow>(
      `INSERT INTO contact_submissions (
        name, phone, category, location, message, vehicle_slug,
        consent_text, consent_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id`,
      [
        input.name,
        input.phone,
        input.category,
        input.location,
        input.message,
        input.vehicleSlug || null,
        input.consentText,
      ],
    );
    return { ok: true, id: result.rows[0].id };
  }

  async findRecent(query: PaginationQuery): Promise<PageResult<ContactRow>> {
    const filter = query.search
      ? 'WHERE name ILIKE $1 OR phone ILIKE $1 OR category ILIKE $1 OR location ILIKE $1 OR message ILIKE $1 OR vehicle_slug ILIKE $1'
      : '';
    const filterValues = query.search ? [`%${query.search}%`] : [];
    const [result, count] = await Promise.all([
      this.database.query<ContactRow>(
        `SELECT id, name, phone, category, location, message,
                vehicle_slug AS "vehicleSlug", status, consent_text AS "consentText",
                consent_at AS "consentAt", created_at AS "createdAt",
                updated_at AS "updatedAt"
         FROM contact_submissions ${filter}
         ORDER BY created_at DESC, id DESC
         LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
        [...filterValues, query.limit, query.offset],
      ),
      this.database.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM contact_submissions ${filter}`,
        filterValues,
      ),
    ]);
    return toPageResult(result.rows, Number(count.rows[0].total), query);
  }

  async updateStatus(id: string, status: ContactStatus) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<ContactRow>(
        `UPDATE contact_submissions
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, status`,
        [status, id],
      );
      const submission = result.rows[0];
      if (!submission) {
        throw new NotFoundException('Không tìm thấy yêu cầu tư vấn.');
      }

      await insertActivity(client, {
        action: 'UPDATE',
        entityType: 'contact_submission',
        entityId: submission.id,
        entityLabel: `Cập nhật trạng thái yêu cầu liên hệ thành ${status}`,
      });
      return { id: submission.id, status: submission.status };
    });
  }

  async remove(id: string) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        'DELETE FROM contact_submissions WHERE id = $1 RETURNING id',
        [id],
      );
      const submission = result.rows[0];
      if (!submission) {
        throw new NotFoundException('Không tìm thấy yêu cầu tư vấn.');
      }

      await insertActivity(client, {
        action: 'DELETE',
        entityType: 'contact_submission',
        entityId: submission.id,
        entityLabel: 'Xóa yêu cầu liên hệ',
      });
    });
  }

  async purgeExpired() {
    if (!this.database.isConfigured) return 0;
    return this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `DELETE FROM contact_submissions
         WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
         RETURNING id`,
        [this.retentionDays],
      );
      const deletedCount = result.rowCount ?? 0;
      if (deletedCount > 0) {
        await insertActivity(client, {
          actor: 'system',
          action: 'DELETE',
          entityType: 'contact_submission',
          entityId: null,
          entityLabel: `Tự động xóa ${deletedCount} yêu cầu liên hệ quá ${this.retentionDays} ngày`,
        });
      }
      return deletedCount;
    });
  }

  private async purgeExpiredWithLogging() {
    try {
      const deletedCount = await this.purgeExpired();
      if (deletedCount > 0) {
        this.logger.log(
          `Automatically purged ${deletedCount} expired contact submissions.`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Unable to purge expired contact submissions; the next scheduled run will retry.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
