import { ApiProperty } from '@nestjs/swagger';

/**
 * One player, whole: what the model says about them over the horizon and the facts that say why.
 * This is the payload behind the player sheet (plan 030) — opened on a tap, never rendered in a
 * list — so it can afford the fixtures, the recent form and the per-term breakdown that
 * `PlayerListItemDto` deliberately leaves out.
 *
 * Every model field is nullable where the row can be absent, and `projections` is empty rather
 * than fabricated. A player the served model has not projected is rendered as absence, never as a
 * row of zeros: zero is a claim, null is an admission.
 */

export class PlayerFixtureDto {
  @ApiProperty({ example: 'MCI' })
  opponentShortName!: string;

  @ApiProperty({
    description: 'True when this player’s club is the home side.',
  })
  isHome!: boolean;

  @ApiProperty({
    description:
      'FPL’s fixture difficulty rating for THIS player’s club in this match, 1 (easiest) to 5. ' +
      'Read from the side the player is on, so a home player sees the home difficulty.',
    minimum: 1,
    maximum: 5,
  })
  difficulty!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ISO instant. Null when FPL has not scheduled the match yet.',
  })
  kickoffTime!: string | null;
}

export class PlayerProjectionDto {
  @ApiProperty()
  gameweekId!: number;

  @ApiProperty({ description: 'Expected points in this gameweek alone.' })
  expectedPoints!: number;

  @ApiProperty({ description: 'Expected minutes in this gameweek.' })
  expectedMinutes!: number;

  @ApiProperty({ description: 'P(the player features at all).' })
  playProbability!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Standard deviation of the points distribution. Null for a model version that composed none ' +
      '— unknown, never zero.',
  })
  sd!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'P(2 points or fewer). Null when the model carried no distribution.',
  })
  pBlank!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'P(10 points or more). Null when the model carried no distribution.',
  })
  pHaul!: number | null;

  @ApiProperty({
    description:
      'Per-term breakdown of the expected points: appearance, goals, assists, cs, conceded, ' +
      'defcon, saves, bonus, fixtures. The model’s own reasoning, not a rationalisation.',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  components!: Record<string, number>;

  @ApiProperty({
    type: [PlayerFixtureDto],
    description:
      'The club’s fixtures in this gameweek. Empty is a blank, two is a double — both facts about ' +
      'the published calendar, not inferences.',
  })
  fixtures!: PlayerFixtureDto[];
}

export class PlayerRecentGameweekDto {
  @ApiProperty()
  gameweekId!: number;

  @ApiProperty({ example: 'ARS' })
  opponentShortName!: string;

  @ApiProperty()
  wasHome!: boolean;

  @ApiProperty()
  minutes!: number;

  @ApiProperty({ description: 'FPL points actually scored in this match.' })
  points!: number;

  @ApiProperty()
  goals!: number;

  @ApiProperty()
  assists!: number;

  @ApiProperty()
  cleanSheets!: number;

  @ApiProperty()
  bonus!: number;

  @ApiProperty({
    description: 'Expected goals in this match, FPL’s own figure.',
  })
  expectedGoals!: number;

  @ApiProperty({
    description: 'Expected assists in this match, FPL’s own figure.',
  })
  expectedAssists!: number;
}

export class PlayerSeasonTotalsDto {
  @ApiProperty({ description: 'Matches with a recorded stat row this season.' })
  appearances!: number;

  @ApiProperty()
  points!: number;

  @ApiProperty()
  minutes!: number;

  @ApiProperty()
  goals!: number;

  @ApiProperty()
  assists!: number;

  @ApiProperty()
  cleanSheets!: number;

  @ApiProperty()
  bonus!: number;

  @ApiProperty()
  expectedGoals!: number;

  @ApiProperty()
  expectedAssists!: number;
}

export class PlayerDetailDto {
  @ApiProperty({ description: 'Our internal id (cuid).' })
  playerId!: string;

  @ApiProperty()
  fplId!: number;

  @ApiProperty({ example: 'Haaland' })
  webName!: string;

  @ApiProperty({ example: 'Erling Haaland' })
  fullName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty({ example: 'MCI' })
  teamShortName!: string;

  @ApiProperty({ example: 'Man City' })
  teamName!: string;

  @ApiProperty({ description: 'Market price in tenths of a million.' })
  nowCost!: number;

  @ApiProperty({
    description:
      'a=available d=doubtful i=injured s=suspended u=unavailable n=not in squad. Only "a" is ' +
      'safe to start.',
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
      'FPL’s own chance of playing next round, as a percentage. Null when FPL has published none, ' +
      'which is the normal state for a fit player.',
  })
  chanceOfPlayingNextRound!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'FPL’s form figure: points per match over the last 30 days. Null before any match.',
  })
  form!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'FPL’s points per game this season.',
  })
  pointsPerGame!: number | null;

  @ApiProperty({ description: 'Minutes played this season, FPL’s figure.' })
  seasonMinutes!: number;

  @ApiProperty({ description: 'Starts this season, FPL’s figure.' })
  seasonStarts!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '1 means first-choice penalty taker. Null when not on the list.',
  })
  penaltiesOrder!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  directFreekicksOrder!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  cornersOrder!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Share of FPL managers who own this player, as a percentage, from the latest ownership ' +
      'snapshot. Null when none has been recorded. Ownership is a fact about the crowd, never an ' +
      'input to the projection.',
  })
  selectedByPercent!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Price change in tenths since this app first tracked the player — NOT since the season ' +
      'started, which no stored row can say. Null with fewer than two price points.',
  })
  priceChangeSinceTracked!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'ISO instant of the first tracked price, so the change above can be dated.',
  })
  priceTrackedSince!: string | null;

  @ApiProperty({
    type: PlayerSeasonTotalsDto,
    nullable: true,
    description:
      'Summed from the per-gameweek stat rows. Null before the player has one.',
  })
  seasonTotals!: PlayerSeasonTotalsDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The served model version the projections below came from. Null when nothing is projected.',
  })
  modelVersion!: string | null;

  @ApiProperty({
    type: [Number],
    description:
      'The gameweeks a decision can still be made for, in order — the optimizer’s horizon.',
  })
  horizonGameweekIds!: number[];

  @ApiProperty({
    type: [PlayerProjectionDto],
    description:
      'One entry per horizon gameweek the served model has projected, in gameweek order. Empty ' +
      'when the model has not reached this player.',
  })
  projections!: PlayerProjectionDto[];

  @ApiProperty({
    type: [PlayerRecentGameweekDto],
    description:
      'The last finished matches, newest first. Empty before the season’s first match.',
  })
  recent!: PlayerRecentGameweekDto[];
}
