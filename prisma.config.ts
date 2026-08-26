import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 keeps the connection URL here rather than in schema.prisma.
 *
 * The fallback is load-bearing, not laziness: `postinstall` runs `prisma generate`, and on a fresh
 * clone `pnpm install` happens BEFORE anyone has copied .env.example to .env. Resolving the env var
 * strictly makes the very first install fail with a config error, before setup can even start.
 * Generation needs no reachable database — only migrate/studio do, and those fail loudly on their
 * own if the URL is wrong.
 */
const DEV_FALLBACK_URL = 'postgresql://fpl:fpl@localhost:5432/fpl?schema=public';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: { url: process.env.DATABASE_URL ?? DEV_FALLBACK_URL },
});
