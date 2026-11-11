import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminVehiclesController,
  VehiclesController,
} from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [VehiclesController, AdminVehiclesController],
  providers: [VehiclesService],
})
export class VehiclesModule {}
