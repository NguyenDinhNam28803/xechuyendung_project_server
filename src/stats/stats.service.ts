import { Injectable } from '@nestjs/common';
import type { ActivityAction } from '../activity/activity.service.js';
import type { ContactStatus } from '../contact-submissions/contact-submissions.service.js';
import { contactRetentionDays } from '../contact-submissions/contact-submissions.service.js';
import {
  addDays,
  businessTimeZone,
  dayRange,
  todayInBusinessZone,
} from '../common/time.js';
import { DatabaseService } from '../database/database.service.js';

export const contactStatuses: readonly ContactStatus[] = [
  'new',
  'in_progress',
  'contacted',
  'closed',
  'spam',
];

export const activityActions: readonly ActivityAction[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'IMPORT',
  'LOGIN',
  'LOGOUT',
];

type PublishCount = { total: number; published: number; draft: number };

const contentKinds = [
  'vehicle',
  'article',
  'policy',
  'regulation',
  'legal_guide',
] as const;
type ContentKind = (typeof contentKinds)[number];

/** Yêu cầu "Mới" chưa xử lý quá số giờ này được coi là trễ hạn. */
export const overdueContactHours = 24;

function emptyStatusCounts(): Record<ContactStatus, number> {
  return { new: 0, in_progress: 0, contacted: 0, closed: 0, spam: 0 };
}

function emptyActionCounts(): Record<ActivityAction, number> {
  return { CREATE: 0, UPDATE: 0, DELETE: 0, IMPORT: 0, LOGIN: 0, LOGOUT: 0 };
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function roundOne(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * Số liệu cho trang tổng quan quản trị. Mỗi phương thức chạy vài truy vấn
 * tổng hợp (GROUP BY / FILTER) thay vì đếm bằng nhiều request phân trang.
 * Ngày được chia theo múi giờ Asia/Ho_Chi_Minh.
 */
@Injectable()
export class StatsService {
  constructor(private readonly database: DatabaseService) {}

  async overview() {
    const [content, contactStatus, contactHealth, users] = await Promise.all([
      this.database.query<{
        kind: ContentKind;
        isPublished: boolean;
        total: number;
      }>(
        `SELECT 'vehicle' AS kind, is_published AS "isPublished", COUNT(*)::int AS total
           FROM vehicles GROUP BY is_published
         UNION ALL
         SELECT 'article', is_published, COUNT(*)::int
           FROM articles GROUP BY is_published
         UNION ALL
         SELECT resource_type, is_published, COUNT(*)::int
           FROM legal_resources GROUP BY resource_type, is_published`,
      ),
      this.database.query<{ status: ContactStatus; total: number }>(
        `SELECT status, COUNT(*)::int AS total
         FROM contact_submissions GROUP BY status`,
      ),
      this.database.query<{
        overdueNew: number;
        avgResponseHours: number | null;
        handledLast30Days: number;
      }>(
        `SELECT
           COUNT(*) FILTER (
             WHERE status = 'new'
               AND created_at < NOW() - ($1 * INTERVAL '1 hour')
           )::int AS "overdueNew",
           (AVG(EXTRACT(EPOCH FROM first_handled_at - created_at)) FILTER (
             WHERE first_handled_at IS NOT NULL
               AND created_at >= NOW() - INTERVAL '30 days'
           ) / 3600)::float8 AS "avgResponseHours",
           COUNT(*) FILTER (
             WHERE first_handled_at IS NOT NULL
               AND created_at >= NOW() - INTERVAL '30 days'
           )::int AS "handledLast30Days"
         FROM contact_submissions`,
        [overdueContactHours],
      ),
      this.database.query<{
        activeUsers: number;
        totalUsers: number;
        activeSessions: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FILTER (WHERE is_active)::int FROM admin_users) AS "activeUsers",
           (SELECT COUNT(*)::int FROM admin_users) AS "totalUsers",
           (SELECT COUNT(*)::int FROM admin_sessions
             WHERE revoked_at IS NULL AND expires_at > NOW()) AS "activeSessions"`,
      ),
    ]);

    const counts = Object.fromEntries(
      contentKinds.map((kind) => [
        kind,
        { total: 0, published: 0, draft: 0 } satisfies PublishCount,
      ]),
    ) as Record<ContentKind, PublishCount>;
    for (const row of content.rows) {
      const bucket = counts[row.kind];
      if (!bucket) continue;
      bucket.total += row.total;
      if (row.isPublished) bucket.published += row.total;
      else bucket.draft += row.total;
    }

    const byStatus = emptyStatusCounts();
    for (const row of contactStatus.rows) byStatus[row.status] = row.total;
    const health = contactHealth.rows[0];

    return {
      content: {
        vehicles: counts.vehicle,
        articles: counts.article,
        legal: {
          policy: counts.policy,
          regulation: counts.regulation,
          legal_guide: counts.legal_guide,
        },
      },
      contacts: {
        total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
        byStatus,
        overdueNew: health.overdueNew,
        overdueHours: overdueContactHours,
        avgResponseHours: roundOne(health.avgResponseHours),
        handledLast30Days: health.handledLast30Days,
      },
      users: users.rows[0],
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Xu hướng yêu cầu liên hệ trong `days` ngày gần nhất (gồm hôm nay), so
   * sánh với kỳ liền trước cùng độ dài. Kết hợp bảng chi tiết (90 ngày gần
   * nhất) với contact_daily_stats (số đếm đã lưu trước khi xóa).
   */
  async contacts(days: number) {
    const today = todayInBusinessZone();
    const from = addDays(today, -(days - 1));
    const previousFrom = addDays(from, -days);

    const [rows, topVehicles, response] = await Promise.all([
      this.database.query<{
        day: string;
        category: string;
        status: ContactStatus;
        total: number;
      }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, category, status,
                SUM(total)::int AS total
         FROM (
           SELECT (created_at AT TIME ZONE $1)::date AS day, category, status,
                  COUNT(*)::int AS total
           FROM contact_submissions
           WHERE created_at >= ($2::date::timestamp AT TIME ZONE $1)
           GROUP BY 1, 2, 3
           UNION ALL
           SELECT day, category, status, total
           FROM contact_daily_stats
           WHERE day >= $2::date
         ) combined
         GROUP BY day, category, status`,
        [businessTimeZone, previousFrom],
      ),
      this.database.query<{ slug: string; name: string | null; total: number }>(
        `SELECT cs.vehicle_slug AS slug, v.name, COUNT(*)::int AS total
         FROM contact_submissions cs
         LEFT JOIN vehicles v ON v.slug = cs.vehicle_slug
         WHERE cs.vehicle_slug IS NOT NULL
           AND cs.created_at >= ($2::date::timestamp AT TIME ZONE $1)
         GROUP BY cs.vehicle_slug, v.name
         ORDER BY total DESC, cs.vehicle_slug
         LIMIT 5`,
        [businessTimeZone, from],
      ),
      this.database.query<{ avgResponseHours: number | null; handled: number }>(
        `SELECT
           (AVG(EXTRACT(EPOCH FROM first_handled_at - created_at)) / 3600)::float8
             AS "avgResponseHours",
           COUNT(*)::int AS handled
         FROM contact_submissions
         WHERE first_handled_at IS NOT NULL
           AND created_at >= ($2::date::timestamp AT TIME ZONE $1)`,
        [businessTimeZone, from],
      ),
    ]);

    const series = new Map(
      dayRange(from, today).map((day) => [
        day,
        { day, total: 0, byStatus: emptyStatusCounts() },
      ]),
    );
    const byStatus = emptyStatusCounts();
    const byCategory = new Map<string, number>();
    let total = 0;
    let previousTotal = 0;

    for (const row of rows.rows) {
      if (row.day < from) {
        previousTotal += row.total;
        continue;
      }
      const point = series.get(row.day);
      if (!point) continue; // Bản ghi có ngày trong tương lai (lệch đồng hồ).
      total += row.total;
      point.total += row.total;
      if (row.status in point.byStatus) {
        point.byStatus[row.status] += row.total;
        byStatus[row.status] += row.total;
      }
      byCategory.set(
        row.category,
        (byCategory.get(row.category) ?? 0) + row.total,
      );
    }

    const actionable = total - byStatus.spam;
    return {
      days,
      from,
      to: today,
      total,
      previousTotal,
      changePercent: percentChange(total, previousTotal),
      byStatus,
      /** Tỷ lệ (%) yêu cầu hợp lệ đã được liên hệ hoặc hoàn tất. */
      handledRate:
        actionable > 0
          ? Math.round(
              ((byStatus.contacted + byStatus.closed) / actionable) * 1000,
            ) / 10
          : null,
      avgResponseHours: roundOne(response.rows[0].avgResponseHours),
      byCategory: [...byCategory.entries()]
        .map(([category, count]) => ({ category, total: count }))
        .sort(
          (a, b) => b.total - a.total || a.category.localeCompare(b.category),
        ),
      topVehicles: topVehicles.rows,
      /** Dữ liệu chi tiết (top xe, thời gian phản hồi) chỉ còn trong N ngày. */
      detailRetentionDays: contactRetentionDays,
      series: [...series.values()],
    };
  }

  /** Thao tác quản trị theo ngày, theo loại đối tượng và người thực hiện. */
  async activity(days: number) {
    const today = todayInBusinessZone();
    const from = addDays(today, -(days - 1));
    const parameters = [businessTimeZone, from];
    const since = `created_at >= ($2::date::timestamp AT TIME ZONE $1)`;

    const [perDay, perEntity, perActor] = await Promise.all([
      this.database.query<{
        day: string;
        action: ActivityAction;
        total: number;
      }>(
        `SELECT to_char((created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
                action, COUNT(*)::int AS total
         FROM activity_logs WHERE ${since}
         GROUP BY 1, 2`,
        parameters,
      ),
      this.database.query<{ entityType: string; total: number }>(
        `SELECT entity_type AS "entityType", COUNT(*)::int AS total
         FROM activity_logs
         WHERE ${since} AND action NOT IN ('LOGIN', 'LOGOUT')
         GROUP BY entity_type ORDER BY total DESC, entity_type`,
        parameters,
      ),
      this.database.query<{ actor: string; total: number }>(
        `SELECT actor, COUNT(*)::int AS total
         FROM activity_logs
         WHERE ${since} AND actor_id IS NOT NULL
           AND action NOT IN ('LOGIN', 'LOGOUT')
         GROUP BY actor ORDER BY total DESC, actor
         LIMIT 5`,
        parameters,
      ),
    ]);

    const series = new Map(
      dayRange(from, today).map((day) => [
        day,
        { day, total: 0, byAction: emptyActionCounts() },
      ]),
    );
    const byAction = emptyActionCounts();
    let total = 0;
    for (const row of perDay.rows) {
      const point = series.get(row.day);
      if (!point || !(row.action in point.byAction)) continue;
      point.byAction[row.action] += row.total;
      point.total += row.total;
      byAction[row.action] += row.total;
      total += row.total;
    }

    return {
      days,
      from,
      to: today,
      total,
      byAction,
      byEntity: perEntity.rows,
      topActors: perActor.rows,
      series: [...series.values()],
    };
  }
}
