import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { rethrowUniqueViolation } from '../common/database-errors.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { buildUpdateAssignments } from '../common/update-builder.js';
import type { ArticleInput } from '../content/content-validation.js';
import { DatabaseService } from '../database/database.service.js';

type ArticleRow = QueryResultRow & {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string;
  sections: { heading: string; paragraphs: string[] }[];
  isPublished: boolean;
};

const columns: Record<keyof ArticleInput, string> = {
  slug: 'slug',
  category: 'category',
  title: 'title',
  summary: 'summary',
  sections: 'sections',
  isPublished: 'is_published',
};

const jsonFields = ['sections'] as const;

const selectedColumns = `
  id, slug, category, title, summary, sections,
  is_published AS "isPublished"
`;

const conflictMessage = 'Slug bài viết đã tồn tại.';

@Injectable()
export class ArticlesService {
  constructor(private readonly database: DatabaseService) {}

  async findPublic() {
    const result = await this.database.query<ArticleRow>(
      `SELECT ${selectedColumns} FROM articles
       WHERE is_published = TRUE ORDER BY created_at DESC, id`,
    );
    return result.rows.map(toPublicArticle);
  }

  async findPublicPage(query: PaginationQuery) {
    const page = await queryPage<ArticleRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'articles',
        conditions: ['is_published = TRUE'],
        searchExpression: searchExpressions.articles,
        orderBy: 'created_at DESC, id',
      },
      query,
    );
    return { ...page, items: page.items.map(toPublicArticle) };
  }

  async findPublicBySlug(slug: string) {
    const result = await this.database.query<ArticleRow>(
      `SELECT ${selectedColumns} FROM articles
       WHERE slug = $1 AND is_published = TRUE`,
      [slug],
    );
    if (!result.rows[0])
      throw new NotFoundException('Không tìm thấy bài viết.');
    return toPublicArticle(result.rows[0]);
  }

  findAll(query: PaginationQuery): Promise<PageResult<ArticleRow>> {
    return queryPage<ArticleRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'articles',
        searchExpression: searchExpressions.articles,
        orderBy: 'created_at DESC, id',
      },
      query,
    );
  }

  async create(input: ArticleInput, actor: Actor) {
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<ArticleRow>(
          `INSERT INTO articles (
            slug, category, title, summary, sections, is_published
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
          RETURNING ${selectedColumns}`,
          valuesForInsert(input),
        );
        const article = result.rows[0];
        await insertActivity(client, {
          actor,
          action: 'CREATE',
          entityType: 'article',
          entityId: article.id,
          entityLabel: article.title,
        });
        return article;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async update(id: string, input: Partial<ArticleInput>, actor: Actor) {
    const { assignments, values } = buildUpdateAssignments(
      input,
      columns,
      jsonFields,
    );
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<ArticleRow>(
          `UPDATE articles SET ${assignments}
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const article = result.rows[0];
        if (!article) throw new NotFoundException('Không tìm thấy bài viết.');
        await insertActivity(client, {
          actor,
          action: 'UPDATE',
          entityType: 'article',
          entityId: article.id,
          entityLabel: article.title,
        });
        return article;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async remove(id: string, actor: Actor) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; title: string }>(
        'DELETE FROM articles WHERE id = $1 RETURNING id, title',
        [id],
      );
      const article = result.rows[0];
      if (!article) throw new NotFoundException('Không tìm thấy bài viết.');
      await insertActivity(client, {
        actor,
        action: 'DELETE',
        entityType: 'article',
        entityId: article.id,
        entityLabel: article.title,
      });
    });
  }
}

/** Dùng cho import nội dung mẫu: bỏ qua slug đã tồn tại, không ghi đè. */
export async function insertArticleIfMissing(
  client: PoolClient,
  input: ArticleInput,
) {
  return client.query(
    `INSERT INTO articles (
      slug, category, title, summary, sections, is_published
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT (slug) DO NOTHING`,
    valuesForInsert(input),
  );
}

function valuesForInsert(input: ArticleInput) {
  return [
    input.slug,
    input.category,
    input.title,
    input.summary,
    JSON.stringify(input.sections),
    input.isPublished,
  ];
}

function toPublicArticle(row: ArticleRow) {
  const { id, isPublished, ...article } = row;
  void id;
  void isPublished;
  return article;
}
