/**
 * `pnpm guards:report` — what the two recommendation guards (B-010, B-011) cost and what they
 * changed, on today's numbers rather than on the numbers the plan was written against.
 *
 * Solves the same universe four ways — neither guard, floor only, penalty only, both — and prints
 * the squads and the horizon EP of each. Nothing is persisted: these are comparisons, and filling
 * `optimizer_runs` with them would bury the solves a human asked for.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { AppModule } from '../app.module';
import {
  OptimizerService,
  prunePool,
  arrangeSquad,
} from '../modules/optimizer/optimizer.service';
import {
  buildLp,
  Candidate,
  Concentration,
  NO_CONCENTRATION,
} from '../modules/optimizer/ilp';
import {
  MIN_APPEARANCES,
  DEFENCE_CONCENTRATION_LAMBDA,
} from '../modules/optimizer/policy';
import { Rules } from '../modules/optimizer/rules';

async function main(): Promise<void> {
  const log = new Logger('guards');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const universe = await app.get(OptimizerService).buildUniverse();
    const { candidates, rules, gameweekIds, concentration } = universe;
    const highs = await highsLoader();

    const solve = (
      floor: boolean,
      penalty: Concentration,
    ): { squad: Candidate[]; rules: Rules } => {
      const pool = prunePool(candidates, { floor });
      const sol = highs.solve(buildLp(pool, rules, penalty));
      if (sol.Status !== 'Optimal') throw new Error(`status ${sol.Status}`);
      return {
        squad: pool.filter(
          (c) => ((sol.Columns[c.key] as { Primal?: number })?.Primal ?? 0) > 0.5,
        ),
        rules,
      };
    };

    const cases: [string, boolean, Concentration][] = [
      ['neither guard', false, NO_CONCENTRATION],
      [`floor only (>=${MIN_APPEARANCES} apps)`, true, NO_CONCENTRATION],
      [
        `concentration only (lambda ${DEFENCE_CONCENTRATION_LAMBDA})`,
        false,
        concentration,
      ],
      ['both guards (what we serve)', true, concentration],
    ];

    console.log(`\nGW${gameweekIds[0]}, horizon ${gameweekIds.length}, model ${universe.modelVersion}`);
    console.log(
      `${candidates.length} players, ${candidates.filter((c) => c.appearances < MIN_APPEARANCES).length} under the floor, ` +
        `${concentration.pairs.length} same-club defensive pairs in the universe\n`,
    );

    for (const [name, floor, penalty] of cases) {
      const { squad } = solve(floor, penalty);
      const arranged = arrangeSquad(squad, rules, penalty);
      const rawEp = squad.reduce((s, c) => s + c.ep, 0);
      const under = squad.filter((c) => c.appearances < MIN_APPEARANCES);
      console.log(`--- ${name}`);
      console.log(
        `    £${(squad.reduce((s, c) => s + c.cost, 0) / 10).toFixed(1)}m  ${arranged.formation}  ` +
          `raw horizon EP ${rawEp.toFixed(2)}  charged ${arranged.concentrationPenalty.toFixed(2)}  ` +
          `pairs held ${arranged.heldPairs.length}  ` +
          `sub-floor players ${under.length}`,
      );
      for (const p of arranged.squad
        .slice()
        .sort((a, b) => b.ep - a.ep)) {
        const c = squad.find((x) => x.playerId === p.playerId);
        console.log(
          `      ${p.webName.padEnd(16)} ${p.position} £${(p.cost / 10).toFixed(1)}m ` +
            `ep ${p.ep.toFixed(2).padStart(6)} apps ${String(c?.appearances ?? 0).padStart(3)} ` +
            `${p.role === 'bench' ? `bench ${p.benchOrder}` : p.role}`,
        );
      }
      if (arranged.heldPairs.length) {
        // Held, and separately whether the eleven started both. Only the started ones are charged
        // (B-029) — benching one genuinely removes the exposure.
        console.log(
          `    same-club defensive pairs held (charged ${arranged.concentrationPenalty.toFixed(2)}):`,
        );
        for (const { pair, bothStarted } of arranged.heldPairs)
          console.log(
            `      ${pair.club}: ${pair.a.webName} + ${pair.b.webName}` +
              `${bothStarted ? ' — both started, CHARGED' : ' — one of them benched, free'}`,
          );
      }
      console.log('');
    }
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
