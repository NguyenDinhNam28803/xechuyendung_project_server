import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);

  const logger = new Logger('Bootstrap');
  logger.log('Xe Chuyên Dụng API is running.');
  logger.log(`URL: ${await app.getUrl()}`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'not set'}`);
  logger.log(
    'API: /api/v1/vehicles, /api/v1/articles, /api/v1/legal-resources, /api/v1/admin',
  );
}
await bootstrap();
