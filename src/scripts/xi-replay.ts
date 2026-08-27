/**
 * `pnpm replay:xi -- --label <arm>` — walk an archived season and score the eleven the SOLVER chose
 * (B-025).
 *
 * The one harness in this repo that reads the LP's `y` and `k` columns. `pnpm decision-quality` and
 * `pnpm optimize:bench-sweep` both re-choose the lineup by predicted points, so neither can see what
 * the objective did to the XI — which is how the bench weight and the collision penalty came to be
 * argued over on measurements that structurally could not observe them.
 *
 * The arm label is a run parameter and the objective is whatever this commit emits, so comparing two
 * objectives means two runs at two commits. Both land in `reports/xi-replay.md`, one section each.
 *
 * Nothing is persisted; the service asserts the projection and optimizer-run counts unmoved.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { XiReplayService } from '../modules/calibration/xi-replay.service';
import { FITTED_PARAMS } from '../modules/projections/fitted';

function argOf(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

async function main(): Promise<void> {
  const log = new Logger('xi-replay');
  const label = argOf('label');
  if (!label) {
    // Required rather than defaulted: a section heading is how one arm is told from the other in the
    // report, and a run that silently overwrote "default" would quietly destroy the arm it is being
    // compared against.
    throw new Error(
      'name the arm: `pnpm replay:xi -- --label <arm>` (e.g. --label "penalty on the XI (before B-025)")',
    );
  }

  // Both knobs are overridable per run, so one commit can produce the arm it serves AND the arm that
  // isolates a knob — running `--lambda 0` beside the default is the only way to say how much of the
  // forgone projection is the collision penalty rather than the bench weight.
  const lambda = argOf('lambda');
  const bench = argOf('bench-weight');
  const numeric = (name: string, raw: string | undefined) => {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
    return value;
  };

  const app = await NestFactory.createApplicationContext(AppModule, {
    // 'log' included so the per-run line is visible; a silent run reads as a crash.
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(XiReplayService).run(label, FITTED_PARAMS, {
      concentrationLambda: numeric('lambda', lambda),
      benchWeight: numeric('bench-weight', bench),
    });
    const r = report.result;
    log.log(
      `${r.rounds.length} rounds, ${r.totalPoints} points, XI efficiency ` +
        `${r.xiEfficiency === null ? '—' : `${(r.xiEfficiency * 100).toFixed(1)}%`}`,
    );
    log.log(
      `pairs: owned in ${r.roundsOwningAPair} rounds, both sides started in ${r.roundsStartingAPair}`,
    );
    log.log(
      `projected points forgone: ${r.totalEpForgone.toFixed(2)} over ${r.roundsForgoingEp} rounds`,
    );
    log.log(`wrote ${report.path}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('xi-replay').error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
