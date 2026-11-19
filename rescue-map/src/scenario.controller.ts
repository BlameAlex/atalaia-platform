import { Controller, Get } from '@nestjs/common';
import { BOUNDS, COUNTS } from './config';
import { generateScenario, Marker } from './scenario';

@Controller('api')
export class ScenarioController {
  @Get('scenario')
  scenario(): Marker[] {
    return generateScenario(BOUNDS, COUNTS);
  }
}
