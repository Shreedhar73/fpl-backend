import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope.decorator';
import { HealthDto } from './dto/health.dto';

/**
 * Excluded from the global `api` prefix on purpose: scripts/dev.sh and doctor.sh poll it, and they
 * must not depend on the app's own routing conventions. They check the status code only.
 *
 * It is **not** excluded from the envelope — the interceptor is global, so this returns
 * `ApiResponse<HealthDto>` like everything else. Verified against the running server 2026-08-26.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness probe. Reads nothing, needs no database.',
  })
  @ApiEnvelopeResponse(HealthDto, { description: 'The process is up.' })
  check(): HealthDto {
    return {
      status: 'ok',
      service: 'fpl-backend',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
