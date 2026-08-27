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
  penalisedSquadEp,
  Candidate,
  Collisions,
  NO_COLLISIONS,
} from '../modules/optimizer/ilp';
import {
  MIN_APPEARANCES,
  COLLISION_LAMBDA,
} from '../modules/optimizer/policy';
import { Rules } from '../modules/optimizer/rules';

async function main(): Promise<void> {
  const log = new Logger('guards');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const universe = await app.get(OptimizerService).buildUniverse();
    const { candidates, rules, gameweekIds, collisions } = universe;
    const highs = await highsLoader();

    const solve = (
      floor: boolean,
      penalty: Collisions,
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

    const cases: [string, boolean, Collisions][] = [
      ['neither guard', false, NO_COLLISIONS],
      [`floor only (>=${MIN_APPEARANCES} apps)`, true, NO_COLLISIONS],
      [`penalty only (lambda ${COLLISION_LAMBDA})`, false, collisions],
      ['both guards (what we serve)', true, collisions],
    ];

    console.log(`\nGW${gameweekIds[0]}, horizon ${gameweekIds.length}, model ${universe.modelVersion}`);
    console.log(
      `${candidates.length} players, ${candidates.filter((c) => c.appearances < MIN_APPEARANCES).length} under the floor, ` +
        `${collisions.pairs.length} conflicting pairs in the universe\n`,
    );

    for (const [name, floor, penalty] of cases) {
      const { squad } = solve(floor, penalty);
      const arranged = arrangeSquad(squad, rules, penalty);
      const rawEp = squad.reduce((s, c) => s + c.ep, 0);
      const heldPairs = penalisedSquadEp(squad, collisions);
      const under = squad.filter((c) => c.appearances < MIN_APPEARANCES);
      console.log(`--- ${name}`);
      console.log(
        `    £${(squad.reduce((s, c) => s + c.cost, 0) / 10).toFixed(1)}m  ${arranged.formation}  ` +
          `raw horizon EP ${rawEp.toFixed(2)}  penalised ${heldPairs.toFixed(2)}  ` +
          `pairs held ${((rawEp - heldPairs) / (collisions.lambda || 1)).toFixed(0)}  ` +
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
      if (arranged.heldCollisions.length) {
        // Held, and separately whether the eleven started both sides. Since B-025 holding is the
        // charged event; "kept in the XI" was the old wording and is now a different fact.
        console.log(
          `    collisions held (charged ${arranged.heldPenalty.toFixed(2)} for holding, ` +
            `${arranged.armbandPenalty.toFixed(2)} for the armband):`,
        );
        for (const { pair, bothStarted, captained } of arranged.heldCollisions)
          console.log(
            `      ${pair.attacker.webName} vs ${pair.defender.webName}` +
              `${bothStarted ? ' — both started' : ' — one of them benched'}` +
              `${captained ? ', OUR CAPTAIN is one side' : ''}`,
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
