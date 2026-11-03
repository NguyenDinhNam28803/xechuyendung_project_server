import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ArticlesModule } from './articles/articles.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { ContactSubmissionsModule } from './contact-submissions/contact-submissions.module.js';
import { DatabaseModule } from './database/database.module.js';
import { LegalResourcesModule } from './legal-resources/legal-resources.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ActivityModule,
    VehiclesModule,
    ArticlesModule,
    LegalResourcesModule,
    ContactSubmissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
