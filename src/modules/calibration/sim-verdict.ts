/**
 * The simulated season's verdict, as a pure function of the numbers it is a verdict about.
 *
 * **Why this is a module and not four `w(...)` calls inside the report writer.** It used to be the
 * latter, and the paragraphs were literal strings: the report asserted "`modelVersion` does not move
 * on this" and cited B-014's fixture elasticities as an open finding whatever the run produced. Both
 * had become false — the model was adopted as v3 (D-025) and B-014 shipped — and nothing could go
 * red, because the sentences did not read anything. A verdict generator that emits the same paragraph
 * for every input is the `checks-that-cannot-fail` shape applied to a conclusion instead of to a test,
 * and it is the most flattering possible version of it.
 *
 * So the prose is a function, and the test for it is a **diff of the prose** under two different
 * inputs. A test that only checks the numbers would pass against the bug this file exists to fix.
 */

/** The output of `pairedDifference`, reduced to what a verdict needs. */
export interface PairedStat {
  rounds: number;
  meanDifference: number;
  standardError: number;
  clearsNoise: boolean;
}

/**
 * What this comparison could have detected at all: two standard errors of the paired mean, expressed
 * as points of season.
 *
 * A season difference smaller than this is not a result, whichever way it points. Every argument in
 * this project's register turns on season totals of 25–75 points and none of them carried this
 * number, which is how a 47-point gap came to be called a headline finding (B-030).
 */
export function detectableAt(d: {
  standardError: number;
  rounds: number;
}): number {
  return 2 * d.standardError * d.rounds;
}

export interface SimVerdictInput {
  /** season totals; null where the arm did not run */
  holdModelPoints: number | null;
  holdFormPoints: number | null;
  greedyModelPoints: number | null;
  greedyFormPoints: number | null;
  /** the crowd proxy — the legal fifteen maximising ownership, walked under `greedy-1ft` */
  templatePoints: number | null;
  holdVsForm: PairedStat | null;
  greedyVsForm: PairedStat | null;
  vsTemplate: PairedStat | null;
  /** the k at which the model captured more points than `form`, and the full list checked */
  capturedWins: number[];
  ks: number[];
  /** entry ids the verdict points at, so a renamed entry is a one-line change */
  objectiveAbEntry: string;
  componentEntry: string;
}

const fixed = (x: number, dp = 0) => x.toFixed(dp);

/** One paragraph per element. The caller inserts the blank lines. */
export function simulatedSeasonVerdict(input: SimVerdictInput): string[] {
  const out: string[] = [];
  const {
    holdModelPoints,
    holdFormPoints,
    greedyModelPoints,
    greedyFormPoints,
    templatePoints,
    holdVsForm,
    greedyVsForm,
    vsTemplate,
    capturedWins,
    ks,
  } = input;

  if (holdModelPoints !== null && holdFormPoints !== null) {
    const gap = holdModelPoints - holdFormPoints;
    const clause = holdVsForm
      ? holdVsForm.clearsNoise
        ? `clears this comparison's noise floor of ${fixed(detectableAt(holdVsForm))} points`
        : `does **not** clear this comparison's noise floor of ${fixed(detectableAt(holdVsForm))} points`
      : 'carries no paired comparison';
    out.push(
      `**Held all season, the model's opening fifteen is worth ${holdModelPoints} points against ` +
        `${holdFormPoints}** — a gap of ${gap} over the season, which ${clause}. Note what the ` +
        `\`form\` row actually is: form cannot pick an opening squad, so that squad was chosen by ` +
        `last season's points per 90.`,
    );
  }

  if (greedyModelPoints !== null && greedyFormPoints !== null) {
    const gap = greedyModelPoints - greedyFormPoints;
    const holdGap =
      holdModelPoints !== null && holdFormPoints !== null
        ? holdModelPoints - holdFormPoints
        : null;
    const closed =
      holdGap !== null && Math.abs(gap) < Math.abs(holdGap)
        ? ` — most of the ${holdGap} the two started with has closed`
        : '';
    const noise = greedyVsForm
      ? greedyVsForm.clearsNoise
        ? ', which clears the noise floor'
        : ', which does **not** clear the noise floor'
      : '';
    out.push(
      `**Give both a transfer a week.** \`form\` goes from ${holdFormPoints ?? '—'} to ` +
        `${greedyFormPoints}; the model goes from ${holdModelPoints ?? '—'} to ` +
        `${greedyModelPoints}, a remaining gap of **${gap}**${closed}${noise}. A weekly transfer is ` +
        `a powerful error-correction mechanism, and it corrects a weak opening squad faster than it ` +
        `improves a strong one.`,
    );
  }

  if (templatePoints !== null && greedyModelPoints !== null) {
    const diff = templatePoints - greedyModelPoints;
    const floor = vsTemplate ? fixed(detectableAt(vsTemplate)) : null;
    if (diff > 0 && vsTemplate?.clearsNoise) {
      out.push(
        `**The crowd's opening fifteen, run under the same policy and the same projections, scores ` +
          `${templatePoints} against the model's ${greedyModelPoints} — ${diff} points better, and ` +
          `the gap clears this comparison's noise floor of ${floor} points.** The only difference ` +
          `between those two runs is the opening squad, so this is a defect in the squad solve ` +
          `rather than a season's luck. It is a proxy for the FPL average rather than the average ` +
          `itself, and it is not a flattering one.`,
      );
      out.push(
        `The next question is not "is the model better" but **"why is a squad built from its own ` +
          `projections worse than the crowd's"**. **${input.objectiveAbEntry}** is the measurement ` +
          `that could name a cause — it A/Bs the current squad objective against the ` +
          `all-fifteen-equal one it replaced, on this same season, where both arms hold mostly the ` +
          `same players and the pairing is tight enough to resolve an effect this size. ` +
          `**${input.componentEntry}**'s per-component tables say which term feeds it.`,
      );
    } else if (diff > 0) {
      out.push(
        `**The crowd's opening fifteen scores ${templatePoints} against the model's ` +
          `${greedyModelPoints} — ${diff} points better. That difference does NOT clear this ` +
          `comparison's own noise floor of ${floor ?? '—'} points.** This report used to call the ` +
          `same number its headline finding and print it with no standard error at all. The number ` +
          `is unchanged; what can be concluded from it is not.`,
      );
      out.push(
        `So the next question is not "why is our squad worse" — it is **whether it is worse at ` +
          `all**, and this instrument cannot say. More archived seasons buy √n: three would take a ` +
          `${floor ?? '—'}-point floor to roughly ` +
          `${floor ? fixed(Number(floor) / Math.sqrt(3)) : '—'}, still not enough. Power for a ` +
          `difference this size comes from **pairing arms that hold the same players**, which is ` +
          `what **${input.objectiveAbEntry}** does.`,
      );
    } else {
      const noise = vsTemplate
        ? vsTemplate.clearsNoise
          ? `, clearing this comparison's noise floor of ${floor} points`
          : `, which does **not** clear this comparison's noise floor of ${floor} points`
        : '';
      out.push(
        `**The model's opening fifteen scores ${greedyModelPoints} against the crowd proxy's ` +
          `${templatePoints}** — ahead by ${-diff}${noise}. The crowd proxy is a stand-in for the ` +
          `FPL average, not the average itself.`,
      );
    }
  }

  const orderingMet = capturedWins.length === ks.length && ks.length > 0;
  const seasonMet = Boolean(
    greedyVsForm && greedyVsForm.meanDifference > 0 && greedyVsForm.clearsNoise,
  );
  const orderingClause = orderingMet
    ? 'yes, on points captured at every k'
    : capturedWins.length
      ? `mixed — ahead on points captured at ${capturedWins.map((k) => `@${k}`).join(', ')} and behind at the rest`
      : 'no, not on points captured at any k';
  out.push(
    `**The bar B-012 set was: beat \`form\` on ordering AND on simulated season points, or say ` +
      `plainly that we did not.** Ordering: ${orderingClause}. Season points, once both sides may ` +
      `transfer: ${seasonMet ? 'yes, and it clears the noise floor' : 'no — the difference does not clear the noise floor'}.`,
  );
  out.push(
    orderingMet && seasonMet
      ? `**Both halves of the bar are met on this run.** Whether a model version is adopted on it ` +
          `is a decision recorded in \`docs/decisions.md\`, not here; what this report supplies is ` +
          `the number that decision needs.`
      : `**Both halves of the bar are not met on this run.** A model version is adopted or retired ` +
          `in \`docs/decisions.md\`, never by this file — what this report supplies is the number ` +
          `that decision needs, and on this run that number does not support adopting a version on ` +
          `season points. The serving version is not deleted either way: B-007 (D-020) established ` +
          `that rule and it holds whatever a run says.`,
  );
  return out;
}
