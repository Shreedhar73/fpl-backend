import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The manager id is an **import input**, never an identity (decision D-013). Nothing here is a
 * login: the id is a public number, and the payload it fetches is public too. It is not stored as
 * a user, only as the key of the squad row it produced.
 */
export class ImportSquadDto {
  @ApiProperty({
    description:
      "A public FPL manager id — the number in a manager's /entry/<id>/ URL on the official site.",
    example: 1,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  // Upper bound is a sanity guard, not a rule: FPL ids are ~11 million and climbing, and an
  // absurd number should be rejected before it becomes an upstream request.
  @Max(100_000_000)
  managerId!: number;
}
