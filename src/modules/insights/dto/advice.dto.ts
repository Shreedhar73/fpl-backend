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

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Standard deviation of the points distribution (B-017). NULL for a projection written by a ' +
      'model version that composed none — read it as unknown, never as zero. A zero here is a ' +
      'claim of certainty.',
  })
  sd!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'P(2 points or fewer — the appearance and nothing else). What a human means by a blank, and ' +
      'the number that separates two players with the same expected points.',
  })
  pBlank!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'P(10 points or more).',
  })
  pHaul!: number | null;
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
    description:
      'a=available d=doubtful i=injured s=suspended u=unavailable n=not in squad. Only "a" is ' +
      'safe to start. Carried here so a flag can sit on the shirt without a second fetch (plan 030).',
  })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The availability note, when there is one.',
  })
  news!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'FPL’s own chance of playing next round, as a percentage. Null when FPL has published none.',
  })
  chanceOfPlayingNextRound!: number | null;

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

export class FloorExcludedPlayerDto {
  @ApiProperty()
  playerId!: string;

  @ApiProperty()
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty({
    description: 'e.g. "CHE". Never a team id — see the collision note below.',
  })
  teamShortName!: string;

  @ApiProperty({
    description:
      'Premier League appearances, archive plus this season. Below the threshold, which is why ' +
      'this player was not eligible.',
  })
  appearances!: number;

  @ApiProperty({
    description: 'Horizon expected points the unguarded solve valued them at.',
  })
  epHorizon!: number;
}

export class AppearanceFloorDto {
  @ApiProperty({
    description: 'Minimum appearances to enter the candidate pool.',
  })
  threshold!: number;

  @ApiProperty({ description: 'How many of the league the floor removed.' })
  excluded!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Horizon EP the floor cost, measured against the same solve with the floor lifted and the ' +
      'collision penalty unchanged — so the number isolates the floor. Null when not computed.',
  })
  costEp!: number | null;

  @ApiProperty({
    type: [FloorExcludedPlayerDto],
    description:
      'The excluded players an unguarded solve would actually have picked. Not "everyone below ' +
      'the threshold" — that list is hundreds long and says nothing about this recommendation.',
  })
  wouldHaveMadeTheSquad!: FloorExcludedPlayerDto[];

  @ApiProperty({
    description:
      'What this guard IS, carried in the payload so a UI cannot restate it more confidently ' +
      'than the evidence allows.',
  })
  statement!: string;
}

export class DefencePairDto {
  @ApiProperty({
    description: 'The club both play for — e.g. "BHA". Never a team id.',
  })
  club!: string;

  @ApiProperty({
    type: [String],
    description: 'The two defensive players, by web name.',
  })
  players!: string[];

  @ApiProperty({
    description: 'Horizon points charged for starting this pair together.',
  })
  lambda!: number;
}

export class HeldDefencePairDto {
  @ApiProperty({ description: 'The club both play for — e.g. "BHA".' })
  club!: string;

  @ApiProperty({ type: [String] })
  players!: string[];
}

export class DefenceConcentrationDto {
  @ApiProperty({
    description:
      'Horizon points charged per pair of our defensive players who START for the same club.',
  })
  lambda!: number;

  @ApiProperty({
    description:
      'Same-club defensive pairs the fifteen holds, started or not. A pair with one member benched ' +
      'is held and not charged — a user should still see it, because the money was spent.',
  })
  pairsHeld!: number;

  @ApiProperty({
    description: 'Horizon EP charged, which is for the started pairs only.',
  })
  penaltyEp!: number;

  @ApiProperty({ type: [DefencePairDto] })
  started!: DefencePairDto[];

  @ApiProperty({ type: [HeldDefencePairDto] })
  benched!: HeldDefencePairDto[];

  @ApiProperty({
    description:
      'What this guard is, and what it is NOT. The correlation behind it was measured over three ' +
      'archived seasons; the CHARGE is a policy choice, because nothing has measured that a ' +
      'narrower squad scores more. A UI must not present it as if something had.',
  })
  statement!: string;
}

export class ReasoningDto {
  @ApiProperty({ type: AppearanceFloorDto })
  appearanceFloor!: AppearanceFloorDto;

  @ApiProperty({ type: DefenceConcentrationDto })
  defenceConcentration!: DefenceConcentrationDto;
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
    type: ReasoningDto,
    nullable: true,
    description:
      'Why the RECOMMENDED squad is what it is — which players the appearance floor removed and ' +
      'what that cost, and which fixture collisions the recommendation kept and what it paid. It ' +
      'describes the optimal squad, not the one being advised on, and is null only if the solve ' +
      'produced none.',
  })
  reasoning!: ReasoningDto | null;

  @ApiProperty({
    type: [String],
    description:
      'What this advice deliberately does not answer, in plain language, so the gap is visible ' +
      'in the payload rather than only in a plan file.',
  })
  notAdvisedOn!: string[];
}
