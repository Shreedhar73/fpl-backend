import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V4Model, V4Scorer } from './model-v4';

/**
 * Load the committed v4 models into scorers, keyed by position.
 *
 * Reads from this directory both in `src` (jest) and in `dist` (nest build copies the JSON as
 * assets — `nest-cli.json`). A missing file throws rather than returning a partial map: a harness
 * quietly scoring three positions would report a v4 that benches every goalkeeper.
 */
export function loadV4Scorers(): Map<string, V4Scorer> {
  const out = new Map<string, V4Scorer>();
  for (const position of ['GKP', 'DEF', 'MID', 'FWD']) {
    const raw = readFileSync(join(__dirname, `model-${position}.json`), 'utf8');
    out.set(position, new V4Scorer(JSON.parse(raw) as V4Model));
  }
  return out;
}
