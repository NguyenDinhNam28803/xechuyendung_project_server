import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
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

  async findRecent(limit = 200) {
    const result = await this.database.query<ContactRow>(
      `SELECT id, name, phone, category, location, message,
              vehicle_slug AS "vehicleSlug", status, consent_text AS "consentText",
              consent_at AS "consentAt", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM contact_submissions
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows;
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
}
