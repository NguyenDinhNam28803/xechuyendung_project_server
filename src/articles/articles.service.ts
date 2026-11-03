import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { ArticleInput } from '../content/content-validation.js';

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

const selectedColumns = `
  id, slug, category, title, summary, sections,
  is_published AS "isPublished"
`;

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

  async findAll() {
    const result = await this.database.query<ArticleRow>(
      `SELECT ${selectedColumns} FROM articles
       ORDER BY created_at DESC, id`,
    );
    return result.rows;
  }

  async create(input: ArticleInput) {
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
          action: 'CREATE',
          entityType: 'article',
          entityId: article.id,
          entityLabel: article.title,
        });
        return article;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async update(id: string, input: Partial<ArticleInput>) {
    const entries = Object.entries(input) as [keyof ArticleInput, unknown][];
    const values = entries.map(([key, value]) =>
      key === 'sections' ? JSON.stringify(value) : value,
    );
    const assignments = entries.map(
      ([key], index) =>
        `${columns[key]} = $${index + 1}${key === 'sections' ? '::jsonb' : ''}`,
    );
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<ArticleRow>(
          `UPDATE articles SET ${assignments.join(', ')}, updated_at = NOW()
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const article = result.rows[0];
        if (!article) throw new NotFoundException('Không tìm thấy bài viết.');
        await insertActivity(client, {
          action: 'UPDATE',
          entityType: 'article',
          entityId: article.id,
          entityLabel: article.title,
        });
        return article;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async remove(id: string) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; title: string }>(
        'DELETE FROM articles WHERE id = $1 RETURNING id, title',
        [id],
      );
      const article = result.rows[0];
      if (!article) throw new NotFoundException('Không tìm thấy bài viết.');
      await insertActivity(client, {
        action: 'DELETE',
        entityType: 'article',
        entityId: article.id,
        entityLabel: article.title,
      });
    });
  }
}

export async function insertArticle(
  client: import('pg').PoolClient,
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

function throwIfConflict(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    throw new ConflictException('Slug bài viết đã tồn tại.');
  }
}

function toPublicArticle(row: ArticleRow) {
  const { id, isPublished, ...article } = row;
  void id;
  void isPublished;
  return article;
}
