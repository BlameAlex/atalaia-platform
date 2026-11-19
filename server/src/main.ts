import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { REPO, env } from './config';
import { ErrorFilter } from './errors';
import { migrate } from './migrate';

export async function createApp() {
  if (!env.dispatchKey) throw new Error('DISPATCH_KEY is required');
  await migrate();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  // Expo web (localhost:8081) calls the API cross-origin. Auth is a Bearer header, no cookies, so any origin is safe.
  app.enableCors();
  app.useGlobalFilters(new ErrorFilter());
  app.useStaticAssets(join(REPO, 'dashboard'), { prefix: '/dashboard/' });
  return app;
}

if (require.main === module) {
  createApp()
    .then(async (app) => {
      await app.listen(env.port);
      console.log(`server listening on :${env.port}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
