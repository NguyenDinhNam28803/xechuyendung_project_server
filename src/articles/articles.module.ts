import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminArticlesController,
  ArticlesController,
} from './articles.controller.js';
import { ArticlesService } from './articles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ArticlesController, AdminArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
