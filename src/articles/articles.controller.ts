import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '../activity/activity.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { CurrentActor } from '../auth/admin-principal.js';
import {
  parseOptionalPublicPage,
  parsePaginationQuery,
  parsePublishedFilter,
} from '../common/pagination.js';
import { parseArticleInput } from '../content/content-validation.js';
import { ArticlesService } from './articles.service.js';

@Controller('api/v1/articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  findPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
  ) {
    const query = parseOptionalPublicPage(page, limit, search);
    return query
      ? this.articles.findPublicPage(query)
      : this.articles.findPublic();
  }

  @Get(':slug')
  findPublicBySlug(@Param('slug') slug: string) {
    return this.articles.findPublicBySlug(slug);
  }
}

@Controller('api/v1/admin/articles')
@UseGuards(AdminAuthGuard)
export class AdminArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
    @Query('published') published?: string,
  ) {
    return this.articles.findAll(
      parsePaginationQuery(page, limit, search),
      parsePublishedFilter(published),
    );
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.articles.create(parseArticleInput(body), actor);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.articles.update(id, parseArticleInput(body, true), actor);
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.articles.remove(id, actor);
    return { ok: true };
  }
}
