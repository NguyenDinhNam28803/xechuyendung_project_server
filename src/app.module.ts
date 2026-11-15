import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ActivityModule } from './activity/activity.module.js';
import { AdminUsersModule } from './admin-users/admin-users.module.js';
import { ArticlesModule } from './articles/articles.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ContactSubmissionsModule } from './contact-submissions/contact-submissions.module.js';
import { ContentImportModule } from './content-import/content-import.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LegalResourcesModule } from './legal-resources/legal-resources.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { SecurityModule } from './security/security.module.js';
import { StatsModule } from './stats/stats.module.js';
import { VehicleCategoriesModule } from './vehicle-categories/vehicle-categories.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
  imports: [
    DatabaseModule,
    SecurityModule,
    HealthModule,
    AuthModule,
    AdminUsersModule,
    ActivityModule,
    VehiclesModule,
    VehicleCategoriesModule,
    ArticlesModule,
    LegalResourcesModule,
    ContactSubmissionsModule,
    ContentImportModule,
    MaintenanceModule,
    StatsModule,
  ],
})
export class AppModule {}
