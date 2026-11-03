import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { parseArticleInput } from '../content/content-validation.js';
import { ArticlesService } from './articles.service.js';

@Controller('api/v1/articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  findPublic() {
    return this.articles.findPublic();
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
  findAll() {
    return this.articles.findAll();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.articles.create(parseArticleInput(body));
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.articles.update(id, parseArticleInput(body, true));
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.articles.remove(id);
    return { ok: true };
  }
}
