import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

/**
 * One builder, two callers: `main.ts` serves the result at /api-docs-json for a human, and
 * `pnpm openapi:emit` writes it to openapi.json for the frontend's type generation. Two
 * definitions of one document would drift, and the drift would land in the frontend as a type
 * that describes a response nobody sends.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('fpl-backend')
    .setDescription(
      'The only HTTP surface of the fantasy-premier-league stack. Every response is wrapped in ' +
        'the ApiResponse envelope by a global interceptor; `data` holds the payload and `errorCode` ' +
        'is the stable key to switch on. No authentication anywhere — the product reads the public ' +
        'FPL API only (decision D-013).',
    )
    .setVersion('1.0')
    .addServer('http://localhost:5001', 'local')
    .build();

  return SwaggerModule.createDocument(app, config);
}
