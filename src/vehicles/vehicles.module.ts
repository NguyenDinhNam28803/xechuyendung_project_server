import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminVehiclesController,
  ImportDefaultsController,
  VehiclesController,
} from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';

@Module({
  imports: [AuthModule, ActivityModule],
  controllers: [
    VehiclesController,
    AdminVehiclesController,
    ImportDefaultsController,
  ],
  providers: [VehiclesService],
})
export class VehiclesModule {}
