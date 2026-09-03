import { ApiProperty } from '@nestjs/swagger';

/**
 * A player as the squad builder needs them: enough to pick with, and no more. Deliberately not the
 * whole `Player` row — the per-90 rates and the season aggregates are the projection model's
 * inputs, not a picker's, and shipping them would triple the payload for nobody.
 */
export class PlayerListItemDto {
  @ApiProperty({
    description: 'Our internal id (cuid) — what the squad endpoints take.',
  })
  playerId!: string;

  @ApiProperty()
  fplId!: number;

  @ApiProperty({ example: 'Haaland' })
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty({ example: 'MCI' })
  teamShortName!: string;

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
    description: 'The injury or availability note, when there is one.',
  })
  news!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Our expected points for the next gameweek. Null when the model has not projected this ' +
      'player — a null is not a zero, and the UI must not render it as one.',
  })
  epNextGw!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'P(features at all) next gameweek. The term that dominates every other one.',
  })
  playProbability!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Our expected points summed over `horizonGameweekIds`, undecayed (plan 032). Null when the ' +
      'model has no row for this player in any of them. The number a builder sorts a run of ' +
      'fixtures by; the per-gameweek split is on `GET /api/players/{playerId}`.',
  })
  epHorizon!: number | null;
}

export class TeamFixtureDto {
  @ApiProperty()
  gameweekId!: number;

  @ApiProperty({ example: 'MCI' })
  opponentShortName!: string;

  @ApiProperty()
  isHome!: boolean;

  @ApiProperty({
    description:
      'FPL’s difficulty from this club’s side, 1–5. A home club reads the home figure.',
  })
  difficulty!: number;
}

export class TeamFixturesDto {
  @ApiProperty({ example: 'MCI' })
  teamShortName!: string;

  @ApiProperty({
    type: [TeamFixtureDto],
    description:
      'The club’s fixtures over the horizon, in gameweek order. A blank gameweek has no row; a ' +
      'double has two.',
  })
  fixtures!: TeamFixtureDto[];
}

export class PlayerListDto {
  @ApiProperty({
    description:
      'Which gameweek the expected points are for. Null when nothing has been projected yet.',
    type: Number,
    nullable: true,
  })
  gameweekId!: number | null;

  @ApiProperty({ type: String, nullable: true })
  modelVersion!: string | null;

  @ApiProperty({
    type: [Number],
    description:
      'The gameweeks `epHorizon` is summed over and `fixtures` cover, in order. Empty before ' +
      'the calendar is synced.',
  })
  horizonGameweekIds!: number[];

  @ApiProperty({
    type: [TeamFixturesDto],
    description:
      'Every club’s horizon fixtures, once per club rather than once per player: a 651-row list ' +
      'joins on `teamShortName` instead of carrying 651 × 5 fixture rows (measured 129.5 KB raw ' +
      'before this field, 2026-09-03).',
  })
  fixtures!: TeamFixturesDto[];

  @ApiProperty({
    description:
      'Every player in the game. The list is bounded by the game itself — 612 in 2025/26 — so it ' +
      'is served whole rather than paged: a picker needs to filter across all of them at once.',
  })
  count!: number;

  @ApiProperty({ type: [PlayerListItemDto] })
  players!: PlayerListItemDto[];
}
