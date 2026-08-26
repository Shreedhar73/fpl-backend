/**
 * CLI for `pnpm openapi:emit`: write the OpenAPI document to openapi.json without listening on a
 * port. The frontend's `pnpm generate:api` reads that file, so regenerating types needs a build,
 * not a running backend and a healthy database — which is what makes it runnable in CI and on a
 * machine where Postgres is down. Compiled-run pattern, like `sync`/`project`/`optimize`.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../common/swagger/document';

async function main(): Promise<void> {
  const log = new Logger('openapi:emit');
  const app = await NestFactory.create(AppModule, { logger: false });

  // The routes must carry the same prefix they are served under, or the generated paths are wrong
  // by exactly the prefix — which typechecks fine and 404s at runtime.
  app.setGlobalPrefix('api', { exclude: ['health'] });
  await app.init();

  const out = join(process.cwd(), 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();

  log.log(`wrote ${out}`);
}

void main().catch((err) => {
  new Logger('openapi:emit').error(err);
  process.exit(1);
});
