import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ example: 'fpl-backend' })
  service!: string;

  @ApiProperty({ description: 'Whole seconds since this process started.' })
  uptimeSeconds!: number;
}
