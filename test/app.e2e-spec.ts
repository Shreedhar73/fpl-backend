import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { ResponseEnvelopeInterceptor } from './../src/common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import type { ApiResponse } from './../src/common/dto/api-response.dto';

interface HealthPayload {
  status: string;
  service: string;
  uptimeSeconds: number;
}

describe('fpl-backend (e2e)', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  // /health is deliberately outside the `api` prefix: dev.sh and doctor.sh poll it and must not
  // depend on the app's own conventions. It still leaves through the envelope.
  it('GET /health returns the envelope with status ok', async () => {
    const res = await request(server).get('/health').expect(200);
    const body = res.body as ApiResponse<HealthPayload>;

    expect(body.success).toBe(true);
    expect(body.errorCode).toBeNull();
    expect(body.data.status).toBe('ok');
    expect(body.data.service).toBe('fpl-backend');
    expect(body.meta?.requestId).toEqual(expect.any(String));
  });

  it('an unknown route leaves through the same envelope, with success false', async () => {
    const res = await request(server).get('/api/does-not-exist').expect(404);
    const body = res.body as ApiResponse<null>;

    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('NOT_FOUND');
    expect(body.data).toBeNull();
  });
});
