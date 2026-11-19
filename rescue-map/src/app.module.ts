import { Module } from '@nestjs/common';
import { PlanController } from './routing/plan.controller';
import { ScenarioController } from './scenario.controller';

@Module({ controllers: [ScenarioController, PlanController] })
export class AppModule {}
