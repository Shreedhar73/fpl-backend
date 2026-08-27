/**
 * B-035 — the TypeScript scorer for the v4 gradient-boosted models.
 *
 * The models are fitted in Python (`tools/fit-v4/fit.py`) and committed as XGBoost's own JSON dump
 * plus provenance. This file walks those trees. It exists so the runtime stays TypeScript-only: the
 * Python venv is a fitting tool, never a serving dependency.
 *
 * ## Parity is the whole contract
 *
 * A tree walker that mis-reads one field of the dump — the wrong child on a missing value, a float
 * truncated, base_score dropped — produces plausible numbers with no tell. So the fit emits a
 * fixture of TEST-season rows scored blind by Python, and `model-v4.spec.ts` requires this file to
 * reproduce every one of them to 1e-6. That test failing is the only honest signal that the two
 * implementations still agree; nothing here is trusted without it.
 *
 * ## The dump format, pinned
 *
 * XGBoost `save_raw("json")` for `gbtree` + `reg:squarederror`:
 *   - `learner.learner_model_param.base_score` — the global bias, already in margin space
 *   - one tree: `split_indices[i]` (feature), `split_conditions[i]` (threshold; leaf value when the
 *     node is a leaf), `left_children[i]` / `right_children[i]` (−1 on a leaf),
 *     `default_left[i]` (where a MISSING feature goes)
 *   - decision rule: `x < condition` goes left, `x >= condition` goes right
 *   - prediction = base_score + Σ leaf values across trees (best_iteration+1 trees are kept)
 */

export interface V4Tree {
  split_indices: number[];
  split_conditions: number[];
  left_children: number[];
  right_children: number[];
  default_left: number[];
}

export interface V4Model {
  position: string;
  features: string[];
  hyperparameters: { best_iteration: number };
  provenance: { date: string; seed: number };
  model: {
    learner: {
      learner_model_param: { base_score: string };
      gradient_booster: {
        model: {
          trees: {
            split_indices: number[];
            split_conditions: number[];
            left_children: number[];
            right_children: number[];
            default_left: number[];
          }[];
        };
      };
    };
  };
}

/**
 * One tree's contribution for a feature vector where NaN means missing.
 *
 * **Float32 on purpose.** XGBoost stores thresholds and computes comparisons in float32; a float64
 * walker disagrees with Python exactly when a value sits between a threshold's float32 and float64
 * readings, and the disagreement is a different LEAF — a discrete jump, not a rounding error. The
 * parity suite caught this on the first run (GKP off by 0.007). `x` is a Float32Array so every
 * feature is already rounded the way XGBoost's DMatrix rounds it.
 */
function scoreTree(tree: V4Tree, x: Float32Array): number {
  let node = 0;
  for (;;) {
    const left = tree.left_children[node];
    if (left === -1) return tree.split_conditions[node];
    const value = x[tree.split_indices[node]];
    if (Number.isNaN(value)) {
      node = tree.default_left[node] === 1 ? left : tree.right_children[node];
    } else {
      node =
        value < Math.fround(tree.split_conditions[node])
          ? left
          : tree.right_children[node];
    }
  }
}

export class V4Scorer {
  private readonly trees: V4Tree[];
  private readonly base: number;
  readonly features: string[];

  constructor(model: V4Model) {
    const all = model.model.learner.gradient_booster.model.trees;
    // Early stopping: only the trees up to best_iteration are the model that was validated.
    // Scoring the overfit tail as well is the quiet way to ship a different model than was chosen.
    const kept = model.hyperparameters.best_iteration + 1;
    this.trees = all.slice(0, kept);
    // XGBoost 3.x serialises base_score as "[7.9E-1]" — a bracketed one-element array in a string.
    // Number() on that is NaN, which the guard below would catch; parsed here instead of regretted.
    const raw = model.model.learner.learner_model_param.base_score;
    this.base = Number(raw.replace(/^\[|\]$/g, ''));
    this.features = model.features;
    if (!Number.isFinite(this.base)) {
      throw new Error(`v4 ${model.position}: base_score is not a number`);
    }
    if (this.trees.length === 0) {
      throw new Error(`v4 ${model.position}: no trees kept`);
    }
  }

  /** `features` maps name → value; absent or null = missing. Order comes from the model file. */
  predict(features: ReadonlyMap<string, number | null>): number {
    const x = new Float32Array(this.features.length);
    for (let i = 0; i < this.features.length; i++) {
      const v = features.get(this.features[i]);
      x[i] = v === null || v === undefined ? NaN : v;
    }
    // The sum is accumulated in float32 too — XGBoost's prediction kernel does, and parity to 1e-6
    // over a hundred trees needs the same rounding at every step, not just at the leaves.
    let sum = Math.fround(this.base);
    for (const tree of this.trees)
      sum = Math.fround(sum + Math.fround(scoreTree(tree, x)));
    return sum;
  }
}
