/**
 * CLI for `pnpm referee:rolling` — the rolling-origin referee (B-040, plan 027 task 1).
 *
 * One fold per evaluation season: fit on every season before it, score that season once, pair per
 * round. Writes `reports/rolling-origin.md`.
 *
 *   pnpm referee:rolling                  every earlier season trains each fold
 *   pnpm referee:rolling --window 2       only the two seasons before each evaluation season
 *   pnpm referee:rolling --k 15           pair on points captured @15 instead of @11
 *   pnpm referee:rolling --imputed        let pre-2023-24 seasons fit minutes on imputed labels
 *   pnpm referee:rolling --imputed --compare-imputed   pair the two fits directly, per round
 *   pnpm referee:rolling --select-window  choose window and decay per fold, on the season before it
 *   pnpm referee:rolling --select-rates   choose the player-rate half-life and shrinkage per fold
 *   pnpm referee:rolling --availability unflagged-base --vs-availability none
 *                                         the hybrid against the incumbent's hand rule, paired
 *
 * `--window` is here because plan 027 task 4 turns "do the old seasons help?" into a measurement, and
 * a measurement needs the same referee reading both arms. It is NOT a tuning knob to be turned until
 * the number looks good: a window chosen by re-reading these folds is selection on the folds, and the
 * selection this project permits happens inside a fold, on the season before it.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { RollingOriginService } from '../modules/calibration/rolling-origin.service';

type AvailabilityMode = 'joint' | 'unflagged-base' | 'none';

function numberFlag(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} needs a number, got ${process.argv[i + 1]}`);
  }
  return value;
}

async function main(): Promise<void> {
  const log = new Logger('rolling-origin');
  const window = numberFlag('window');
  const k = numberFlag('k');
  // Plan 027 task 6's arm. Off, the referee is 2 folds; on, the seven seasons the archive never gave
  // a start label fit the minutes model on inferred probabilities and the fold count rises. Which of
  // those is better is the measurement, so it is a flag and not a default.
  const imputed = process.argv.includes('--imputed');
  // Fit each fold twice, flag inverted, and pair the two models directly — the measurement plan 027
  // task 6 turns on. Doubles the run.
  const compareImputed = process.argv.includes('--compare-imputed');
  // Plan 027 task 4. Choose the training window and the recency half-life per fold, on the season
  // before it, instead of training on everything at equal weight because nobody chose otherwise.
  const selectWindow = process.argv.includes('--select-window');
  // Plan 027 task 8. `--availability <mode>` sets how the deadline flags enter the main arm's fit,
  // and `--vs-availability <mode>` fits the fold a second time under the other one and pairs them.
  const modeFlag = (name: string): AvailabilityMode | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = process.argv[i + 1];
    if (value !== 'joint' && value !== 'unflagged-base' && value !== 'none') {
      throw new Error(
        `--${name} takes joint | unflagged-base | none, got ${String(value)}`,
      );
    }
    return value;
  };
  // Plan 028 tasks 1-2: choose how much of a player's own past counts toward his rate, per fold, on
  // the season before it.
  const selectRates = process.argv.includes('--select-rates');
  const compareRates = process.argv.includes('--compare-rates');
  const perPlayerStart = process.argv.includes('--per-player-start');
  const comparePerPlayerStart = process.argv.includes('--compare-start');
  const compareIncumbent = process.argv.includes('--compare-incumbent');
  const selectBonusTau = process.argv.includes('--select-bonus');
  const availabilityMode = modeFlag('availability');
  const compareAvailabilityMode = modeFlag('vs-availability');
  // Plan 029. Three knobs, each with select / fixed / compare forms:
  //   --select-crowd | --crowd <w> | --compare-crowd          the ep_next blend weight
  //   --select-prior | --prior <w> | --compare-prior          the season-start strength prior
  //   --select-start-shrink | --start-shrink <k> | --compare-start-shrink   the shrunk start rate
  // `model vs epNext` is paired on every run whose rows carry a deadline capture; no flag needed.
  const selectCrowd = process.argv.includes('--select-crowd');
  const crowdWeight = numberFlag('crowd');
  const compareCrowd = process.argv.includes('--compare-crowd');
  const selectPrior = process.argv.includes('--select-prior');
  const priorWeight = numberFlag('prior');
  const comparePrior = process.argv.includes('--compare-prior');
  const selectStartShrink = process.argv.includes('--select-start-shrink');
  const startShrink = numberFlag('start-shrink');
  const compareStartShrink = process.argv.includes('--compare-start-shrink');
  //   --select-confidence | --confidence <m> | --compare-confidence   strength shrinkage by ordering
  const selectConfidence = process.argv.includes('--select-confidence');
  const confidence = numberFlag('confidence');
  const compareConfidence = process.argv.includes('--compare-confidence');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(RollingOriginService).run({
      folds: {
        ...(window === undefined ? {} : { trainWindow: window }),
        imputedStarts: imputed,
      },
      k,
      compareImputed,
      selectWindow,
      selectRates,
      compareRates,
      perPlayerStart,
      comparePerPlayerStart,
      compareIncumbent,
      selectBonusTau,
      availabilityMode,
      compareAvailabilityMode,
      selectCrowd,
      crowdWeight,
      compareCrowd,
      selectPrior,
      priorWeight,
      comparePrior,
      selectStartShrink,
      startShrink,
      compareStartShrink,
      selectConfidence,
      confidence,
      compareConfidence,
    });
    log.log(`report: ${report.path}`);
    for (const [label, across] of Object.entries(report.across)) {
      if (!across) {
        log.log(`${label}: no fold produced a pairing`);
        continue;
      }
      log.log(
        `${label}: ${(100 * across.meanOfFoldMeans).toFixed(2)}% captured@${
          k ?? RollingOriginService.PRIMARY_K
        } over ${across.folds} folds` +
          (across.standardError === null
            ? ' (one fold — no spread exists)'
            : `, se ${(100 * across.standardError).toFixed(2)}%, ${
                across.clearsNoise ? 'clears' : 'does not clear'
              } 2se`),
      );
    }
  } finally {
    await app.close();
  }
}

void main();
