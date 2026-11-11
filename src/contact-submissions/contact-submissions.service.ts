import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  type Actor,
  insertActivity,
  systemActor,
} from '../activity/activity.service.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
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

/** Thời hạn lưu trữ đã được doanh nghiệp phê duyệt. */
export const contactRetentionDays = 90;
const purgeLockKey = 7_804_202_032;

@Injectable()
export class ContactSubmissionsService {
  constructor(private readonly database: DatabaseService) {}

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

  findRecent(query: PaginationQuery): Promise<PageResult<ContactRow>> {
    return queryPage<ContactRow>(
      this.database,
      {
        columns: `id, name, phone, category, location, message,
                  vehicle_slug AS "vehicleSlug", status,
                  consent_text AS "consentText", consent_at AS "consentAt",
                  created_at AS "createdAt", updated_at AS "updatedAt"`,
        table: 'contact_submissions',
        searchExpression: searchExpressions.contactSubmissions,
        orderBy: 'created_at DESC, id DESC',
      },
      query,
    );
  }

  async updateStatus(id: string, status: ContactStatus, actor: Actor) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<ContactRow>(
        `UPDATE contact_submissions SET status = $1
         WHERE id = $2
         RETURNING id, status`,
        [status, id],
      );
      const submission = result.rows[0];
      if (!submission) {
        throw new NotFoundException('Không tìm thấy yêu cầu tư vấn.');
      }
      await insertActivity(client, {
        actor,
        action: 'UPDATE',
        entityType: 'contact_submission',
        entityId: submission.id,
        entityLabel: `Cập nhật trạng thái yêu cầu liên hệ thành ${status}`,
      });
      return { id: submission.id, status: submission.status };
    });
  }

  async remove(id: string, actor: Actor) {
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
        actor,
        action: 'DELETE',
        entityType: 'contact_submission',
        entityId: submission.id,
        entityLabel: 'Xóa yêu cầu liên hệ',
      });
    });
  }

  /**
   * Xóa yêu cầu liên hệ quá hạn lưu trữ. Chạy dưới advisory lock nên khi có
   * nhiều instance, chỉ một instance thực hiện; audit chỉ ghi số lượng, không
   * ghi dữ liệu cá nhân.
   */
  async purgeExpired() {
    if (!this.database.isConfigured) return 0;
    const outcome = await this.database.runExclusive(
      purgeLockKey,
      async (client) => {
        const result = await client.query<{ id: string }>(
          `DELETE FROM contact_submissions
           WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
           RETURNING id`,
          [contactRetentionDays],
        );
        const deletedCount = result.rowCount ?? 0;
        if (deletedCount > 0) {
          await insertActivity(client, {
            actor: systemActor,
            action: 'DELETE',
            entityType: 'contact_submission',
            entityId: null,
            entityLabel: `Tự động xóa ${deletedCount} yêu cầu liên hệ quá ${contactRetentionDays} ngày`,
          });
        }
        return deletedCount;
      },
    );
    return outcome.acquired ? outcome.result : 0;
  }
}
