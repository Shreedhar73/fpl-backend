import { ApiProperty } from '@nestjs/swagger';

/**
 * The advice for a squad. Deliberately does NOT contain transfer or chip recommendations: those
 * need an owned squad's sell value and a hit calculation, which is B-008. What is here is
 * everything derivable from the squad plus the projections, and nothing is guessed.
 */

export class EvidenceDto {
  @ApiProperty({
    description:
      "Per-term breakdown of the next gameweek's expected points: appearance, goals, assists, " +
      "cs, conceded, defcon, saves, bonus. The model's own reasoning, not a rationalisation.",
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  components!: Record<string, number>;

  @ApiProperty({ description: 'Expected minutes in the next gameweek.' })
  expectedMinutes!: number;

  @ApiProperty({
    description:
      'P(the player features at all). The term that dominates every other one — a 9-point ' +
      'forward who might not start is worth less than a 4-point one who certainly will.',
  })
  playProbability!: number;
}

export class AdvicePlayerDto {
  @ApiProperty()
  playerId!: string;

  @ApiProperty()
  fplId!: number;

  @ApiProperty()
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty()
  teamShortName!: string;

  @ApiProperty({ description: 'Market price in tenths of a million.' })
  nowCost!: number;

  @ApiProperty({
    enum: ['captain', 'vice', 'starter', 'bench'],
    description:
      'What this player should do, not what the manager currently has them doing.',
  })
  role!: 'captain' | 'vice' | 'starter' | 'bench';

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '1-4 for a bench player, in substitution order; null for a starter. Order is a real ' +
      'decision: auto-subs walk the bench in this order and the first eligible player comes on.',
  })
  benchOrder!: number | null;

  @ApiProperty({ description: 'Expected points for the next gameweek alone.' })
  epNextGw!: number;

  @ApiProperty({
    description:
      'Expected points over the horizon, decayed — the number the optimizer actually maximises.',
  })
  epHorizon!: number;

  @ApiProperty({
    type: EvidenceDto,
    nullable: true,
    description:
      'Null when the model has no projection for this player in the next gameweek.',
  })
  evidence!: EvidenceDto | null;
}

export class SquadDifferenceDto {
  @ApiProperty()
  playerId!: string;

  @ApiProperty()
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty()
  teamShortName!: string;

  @ApiProperty({ description: 'Market price in tenths of a million.' })
  nowCost!: number;

  @ApiProperty({ description: 'Expected points over the horizon.' })
  epHorizon!: number;
}

export class ComparisonDto {
  @ApiProperty({ description: "Horizon EP summed over this squad's 15." })
  squadHorizonEp!: number;

  @ApiProperty({ description: 'Horizon EP summed over the optimal 15.' })
  optimalHorizonEp!: number;

  @ApiProperty({
    description:
      'optimalHorizonEp − squadHorizonEp. Never negative: the optimal squad is optimal, so a ' +
      'negative gap would mean the comparison is broken, and a test asserts it cannot happen.',
  })
  horizonGap!: number;

  @ApiProperty({
    description:
      'Next-gameweek EP of the best XI from this squad, captain counted twice — what the manager ' +
      'should actually score if the model is right.',
  })
  xiNextGwEp!: number;

  @ApiProperty({ description: 'The same for the optimal squad.' })
  optimalXiNextGwEp!: number;

  @ApiProperty({ description: 'optimalXiNextGwEp − xiNextGwEp.' })
  xiNextGwGap!: number;

  @ApiProperty({
    description: 'The formation the best XI from this squad plays.',
  })
  formation!: string;

  @ApiProperty({ description: "The optimal squad's formation." })
  optimalFormation!: string;

  @ApiProperty({
    type: [SquadDifferenceDto],
    description:
      'In the optimal 15 and not in this squad. **Not a transfer recommendation** — a transfer ' +
      'costs money and possibly 4 points, and deciding whether one is worth it is B-008. This is ' +
      'the set difference and nothing more.',
  })
  optimalHasThatYouDoNot!: SquadDifferenceDto[];

  @ApiProperty({
    type: [SquadDifferenceDto],
    description: 'In this squad and not in the optimal 15. Same caveat.',
  })
  youHaveThatOptimalDoesNot!: SquadDifferenceDto[];
}

export class AdviceDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The manager this advice is for. Null for the recommended squad.',
  })
  managerId!: number | null;

  @ApiProperty({
    description: 'The gameweek the advice is for — the next one.',
  })
  gameweekId!: number;

  @ApiProperty({
    type: [Number],
    description: 'Every gameweek in the horizon the epHorizon numbers cover.',
  })
  horizonGameweekIds!: number[];

  @ApiProperty({
    description: 'Which projection model produced these numbers.',
  })
  modelVersion!: string;

  @ApiProperty({
    type: AdvicePlayerDto,
    nullable: true,
    description:
      'Who to captain: the highest-EP player in the best XI. Null for an empty squad.',
  })
  captain!: AdvicePlayerDto | null;

  @ApiProperty({
    type: AdvicePlayerDto,
    nullable: true,
    description: 'The fallback.',
  })
  viceCaptain!: AdvicePlayerDto | null;

  @ApiProperty({
    type: [AdvicePlayerDto],
    description:
      'All 15, each with the role the model would give it and its evidence.',
  })
  players!: AdvicePlayerDto[];

  @ApiProperty({ type: ComparisonDto })
  comparison!: ComparisonDto;

  @ApiProperty({
    type: [String],
    description:
      'What this advice deliberately does not answer, in plain language, so the gap is visible ' +
      'in the payload rather than only in a plan file.',
  })
  notAdvisedOn!: string[];
}
