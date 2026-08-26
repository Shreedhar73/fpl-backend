import { Controller, Get } from '@nestjs/common';

/**
 * Excluded from the global `api` prefix and from the envelope contract on purpose:
 * scripts/dev.sh and doctor.sh poll it, and they must not depend on the app's own conventions.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'fpl-backend', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
