import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  ArticlesController,
  AdminArticlesController,
} from './articles.controller.js';
import { ArticlesService } from './articles.service.js';

@Module({
  imports: [AuthModule, ActivityModule],
  controllers: [ArticlesController, AdminArticlesController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
