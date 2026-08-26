import { Module } from '@nestjs/common';
import { FplApiClient } from './fpl-api.client';

/**
 * Exposes the FPL API client to any module that needs upstream reads. Cross-cutting infra, not a
 * domain module (fpl-architecture-contract §2).
 */
@Module({
  providers: [FplApiClient],
  exports: [FplApiClient],
})
export class FplInfraModule {}
