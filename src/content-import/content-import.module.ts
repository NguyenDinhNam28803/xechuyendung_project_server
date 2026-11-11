import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ContentImportController } from './content-import.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ContentImportController],
})
export class ContentImportModule {}
