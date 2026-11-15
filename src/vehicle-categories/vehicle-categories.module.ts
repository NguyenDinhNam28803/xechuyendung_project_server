import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminVehicleCategoriesController,
  PublicVehicleCategoriesController,
} from './vehicle-categories.controller.js';
import { VehicleCategoriesService } from './vehicle-categories.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    PublicVehicleCategoriesController,
    AdminVehicleCategoriesController,
  ],
  providers: [VehicleCategoriesService],
})
export class VehicleCategoriesModule {}
