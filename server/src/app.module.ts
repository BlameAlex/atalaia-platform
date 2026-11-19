import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DispatchController } from './dispatch.controller';
import { Events } from './events';
import { HealthController } from './health.controller';
import { Planning } from './planning';
import { RiskBridge } from './risk';
import { Sim } from './sim';
import { SosController } from './sos.controller';
import { UsersController } from './users.controller';

@Module({
  controllers: [HealthController, AuthController, UsersController, SosController, DispatchController],
  providers: [RiskBridge, Events, Planning, Sim],
})
export class AppModule {}
