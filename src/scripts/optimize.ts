/**
 * CLI for `pnpm optimize`: solve for the best legal 15 from scratch and print it. Default is the
 * horizon objective; `--single` (or `--gw`) optimises the next gameweek alone. Reads Postgres only;
 * needs `pnpm project` to have run first. Compiled-run pattern, like `sync`/`project`.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import {
  OptimizerService,
  SquadPlayer,
} from '../modules/optimizer/optimizer.service';
import { POSITIONS } from '../modules/optimizer/rules';

function line(p: SquadPlayer): string {
  const tag =
    p.role === 'captain'
      ? '(C)'
      : p.role === 'vice'
        ? '(V)'
        : p.role === 'bench'
          ? `bench ${p.benchOrder}`
          : '';
  return `  ${p.webName.padEnd(18)} ${p.position}  £${(p.cost / 10).toFixed(1)}m  ep ${p.ep.toFixed(2).padStart(6)}  ${tag}`;
}

async function main(): Promise<void> {
  const log = new Logger('optimize');
  const args = process.argv.slice(2);
  const singleGw = args.includes('--single') || args.includes('--gw');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const s = await app.get(OptimizerService).run({ singleGw });
    log.log(
      `best squad for GW${s.gameweekIds[0]} (${singleGw ? 'single GW' : `horizon ${s.gameweekIds.length}`}): ` +
        `${s.formation}, £${(s.totalCost / 10).toFixed(1)}m, objective ${s.objectiveValue}, ${s.durationMs}ms`,
    );
    const starters = s.squad.filter((p) => p.role !== 'bench');
    const bench = s.squad
      .filter((p) => p.role === 'bench')
      .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0));
    log.log('Starting XI:');
    for (const pos of POSITIONS) {
      for (const p of starters.filter((x) => x.position === pos))
        log.log(line(p));
    }
    log.log('Bench:');
    for (const p of bench) log.log(line(p));
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
