import {
  detectableAt,
  PairedStat,
  simulatedSeasonVerdict,
  SimVerdictInput,
} from '../sim-verdict';

const pair = (
  meanDifference: number,
  standardError: number,
  rounds = 37,
): PairedStat => ({
  rounds,
  meanDifference,
  standardError,
  clearsNoise: Math.abs(meanDifference) > 2 * standardError,
});

/** The numbers this report actually produced at HEAD on 2026-08-27. */
const measured: SimVerdictInput = {
  holdModelPoints: 1635,
  holdFormPoints: 1086,
  greedyModelPoints: 1881,
  greedyFormPoints: 1761,
  templatePoints: 1928,
  holdVsForm: pair(14.84, 2.74),
  greedyVsForm: pair(3.24, 2.6),
  vsTemplate: pair(-1.27, 2.6),
  plannerPoints: 1846,
  plannerHitCost: 40,
  plannerTransfers: 47,
  plannerVsGreedy: pair(-0.95, 0.9),
  capturedWins: [11, 15, 30],
  ks: [11, 15, 30],
  objectiveAbEntry: 'B-031',
  componentEntry: 'B-013',
};

describe('detectableAt', () => {
  it('is two standard errors of the paired mean, in points of season', () => {
    expect(detectableAt({ standardError: 2.6, rounds: 37 })).toBeCloseTo(
      192.4,
      3,
    );
  });
});

describe('simulatedSeasonVerdict', () => {
  const text = (i: SimVerdictInput) => simulatedSeasonVerdict(i).join('\n\n');

  it('reports the crowd gap as sub-noise when it is', () => {
    const out = text(measured);
    expect(out).toContain('does NOT clear this comparison');
    expect(out).toContain('whether it is worse at all');
    expect(out).not.toContain('why is a squad built from its own');
  });

  it('reports the crowd gap as a defect when it clears the noise floor', () => {
    const out = text({ ...measured, vsTemplate: pair(-1.27, 0.2) });
    expect(out).toContain('why is a squad built from its own');
    expect(out).toContain('a defect in the squad solve');
  });

  // The bug this module exists for: a verdict whose paragraphs are literal strings reads the same
  // whatever the run produced. Every case below asserts the PROSE differs, not that a number does.
  describe('the prose is a function of the run and not a constant', () => {
    it('changes when the crowd gap crosses its own noise floor', () => {
      expect(text({ ...measured, vsTemplate: pair(-1.27, 0.2) })).not.toEqual(
        text(measured),
      );
    });

    it('changes when the model overtakes the crowd proxy', () => {
      const ahead = text({ ...measured, templatePoints: 1800 });
      expect(ahead).not.toEqual(text(measured));
      expect(ahead).toContain('ahead by 81');
      expect(ahead).not.toContain('better. That difference does NOT clear');
    });

    it('changes the bar sentence when the season half is met', () => {
      const met = text({ ...measured, greedyVsForm: pair(3.24, 1.0) });
      expect(met).toContain('**Both halves of the bar are met on this run.**');
      expect(text(measured)).toContain(
        '**Both halves of the bar are not met on this run.**',
      );
      expect(met).not.toEqual(text(measured));
    });

    it('changes the bar sentence when the ordering half is lost', () => {
      const lost = text({ ...measured, capturedWins: [] });
      expect(lost).toContain('no, not on points captured at any k');
      expect(lost).not.toEqual(text(measured));
    });

    it('never claims a model version moved or did not — that decision is not this file’s', () => {
      for (const i of [
        measured,
        { ...measured, greedyVsForm: pair(3.24, 1.0) },
        { ...measured, templatePoints: 1800 },
      ]) {
        expect(text(i)).not.toContain('`modelVersion` does not move');
      }
    });
  });

  it('states the noise floor it is quoting, so a sub-noise claim is visibly sub-noise', () => {
    // 2 x 2.6 x 37 = 192.4 -> "192"
    expect(text(measured)).toContain('192 points');
  });

  describe('the planner arm', () => {
    it('says what it paid in hits beside what it scored', () => {
      const out = text(measured);
      expect(out).toContain('has now walked a season');
      expect(out).toContain('35 behind');
      expect(out).toContain('paid 40 points in hits');
    });

    it('changes when the planner is ahead instead of behind', () => {
      const ahead = text({ ...measured, plannerPoints: 1950 });
      expect(ahead).toContain('69 ahead');
      expect(ahead).not.toContain('Read that against what it paid');
      expect(ahead).not.toEqual(text(measured));
    });

    it('says the −4 path is still untested when no hit was taken', () => {
      const out = text({ ...measured, plannerHitCost: 0 });
      expect(out).toContain('exercised by nothing but a unit test');
      expect(out).not.toEqual(text(measured));
    });

    it('is absent entirely when the arm did not run', () => {
      const out = text({ ...measured, plannerPoints: null });
      expect(out).not.toContain('has now walked a season');
    });
  });

  it('drops the paragraphs whose arms did not run rather than printing a null', () => {
    const out = text({
      ...measured,
      holdModelPoints: null,
      holdFormPoints: null,
      holdVsForm: null,
      templatePoints: null,
      vsTemplate: null,
      plannerPoints: null,
      plannerVsGreedy: null,
    });
    expect(out).not.toContain('Held all season');
    expect(out).not.toContain('crowd');
    expect(out).not.toContain('null');
    expect(out).toContain('The bar B-012 set was');
  });
});
