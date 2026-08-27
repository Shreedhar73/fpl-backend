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

interface XgbDump {
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
}

export interface V4Model {
  position: string;
  /**
   * 'points' — the trees predict total points directly (the first v4).
   * 'residual' — the trees predict the correction to the incumbent's EP, and the caller adds the
   * base (B-037 increment 2).
   * 'composite' — BOTH tree sets, blended per position by a weight chosen on VALIDATE with a
   * bar-shaped rule (B-037's close): `w × (v3ep + residual(x)) + (1−w) × direct(x)`. The v3ep base
   * is a feature the row already carries, so the composite is self-contained and the harness adds
   * nothing.
   */
  target?: 'points' | 'residual' | 'composite';
  features: string[];
  hyperparameters:
    | { best_iteration: number }
    | { direct: { best_iteration: number }; residual: { best_iteration: number } };
  provenance: { date: string; seed: number };
  /** points/residual models */
  model?: XgbDump;
  /** composite models */
  weightResidual?: number;
  direct?: XgbDump;
  residual_?: never;
  residual?: XgbDump;
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

/** One tree ensemble read out of an XGBoost dump: kept trees + parsed base score. */
class Ensemble {
  readonly trees: V4Tree[];
  readonly base: number;

  constructor(dump: XgbDump, bestIteration: number, position: string) {
    this.trees = dump.learner.gradient_booster.model.trees.slice(
      0,
      // Early stopping: only the trees up to best_iteration are the model that was validated.
      // Scoring the overfit tail as well is the quiet way to ship a different model than was chosen.
      bestIteration + 1,
    );
    // XGBoost 3.x serialises base_score as "[7.9E-1]" — a bracketed one-element array in a string.
    // Number() on that is NaN, which the guard below would catch; parsed here instead of regretted.
    const raw = dump.learner.learner_model_param.base_score;
    this.base = Number(raw.replace(/^\[|\]$/g, ''));
    if (!Number.isFinite(this.base)) {
      throw new Error(`v4 ${position}: base_score is not a number`);
    }
    if (this.trees.length === 0) {
      throw new Error(`v4 ${position}: no trees kept`);
    }
  }

  score(x: Float32Array): number {
    let sum = Math.fround(this.base);
    for (const tree of this.trees)
      sum = Math.fround(sum + Math.fround(scoreTree(tree, x)));
    return sum;
  }
}

export class V4Scorer {
  private readonly primary: Ensemble;
  private readonly secondary: Ensemble | null;
  private readonly weightResidual: number;
  private readonly v3epIndex: number;
  readonly features: string[];
  /** true when the model's output is a correction to the incumbent, not points */
  readonly residual: boolean;
  readonly composite: boolean;

  constructor(model: V4Model) {
    this.features = model.features;
    this.residual = model.target === 'residual';
    this.composite = model.target === 'composite';
    this.v3epIndex = model.features.indexOf('v3ep');
    if (this.composite) {
      const hp = model.hyperparameters as {
        direct: { best_iteration: number };
        residual: { best_iteration: number };
      };
      if (!model.direct || !model.residual || model.weightResidual === undefined)
        throw new Error(`v4 ${model.position}: composite model missing a half`);
      if (this.v3epIndex < 0)
        throw new Error(`v4 ${model.position}: composite needs v3ep among the features`);
      this.primary = new Ensemble(
        model.direct,
        hp.direct.best_iteration,
        model.position,
      );
      this.secondary = new Ensemble(
        model.residual,
        hp.residual.best_iteration,
        model.position,
      );
      this.weightResidual = model.weightResidual;
    } else {
      const hp = model.hyperparameters as { best_iteration: number };
      if (!model.model) throw new Error(`v4 ${model.position}: model dump missing`);
      this.primary = new Ensemble(model.model, hp.best_iteration, model.position);
      this.secondary = null;
      this.weightResidual = 0;
    }
  }

  /** `features` maps name → value; absent or null = missing. Order comes from the model file. */
  predict(features: ReadonlyMap<string, number | null>): number {
    const x = new Float32Array(this.features.length);
    for (let i = 0; i < this.features.length; i++) {
      const v = features.get(this.features[i]);
      x[i] = v === null || v === undefined ? NaN : v;
    }
    if (!this.composite || !this.secondary) return this.primary.score(x);
    // The blend, in float32 exactly as the fit emitted the parity fixture: w × (v3ep + residual)
    // + (1−w) × direct. v3ep comes off the feature vector — the composite is self-contained.
    const w = Math.fround(this.weightResidual);
    const direct = this.primary.score(x);
    const resid = Math.fround(x[this.v3epIndex] + this.secondary.score(x));
    return Math.fround(
      Math.fround(w * resid) + Math.fround(Math.fround(1 - w) * direct),
    );
  }
}
