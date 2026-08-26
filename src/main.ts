import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildOpenApiDocument } from './common/swagger/document';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:4000').split(','),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // The frontend's types are generated from this document, so it is part of the contract, not a
  // developer convenience. `pnpm openapi:emit` writes the same document to a file for a
  // generation run that does not want to boot a server.
  SwaggerModule.setup('api-docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api-docs-json',
  });

  const port = Number(process.env.PORT ?? 5001);
  await app.listen(port);
  Logger.log(`fpl-backend listening on http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
