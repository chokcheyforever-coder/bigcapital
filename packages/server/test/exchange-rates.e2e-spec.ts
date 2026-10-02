import request = require('supertest');
import { app, AuthorizationHeader, orgainzationId } from './init-app-test';

// 103 DiTech: the query parameters used to be dropped (camelCase interceptor
// + whitelisted snake_case DTO), so every lookup answered base -> base = 1.
describe('Exchange rates (e2e)', () => {
  it('/exchange-rates/latest reads from_currency and to_currency', async () => {
    const res = await request(app.getHttpServer())
      .get('/exchange-rates/latest')
      .query({ from_currency: 'KHR', to_currency: 'KHR' })
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .expect(200);

    // The test organization's base currency is USD: before the fix both
    // currencies came back as USD.
    expect(res.body.base_currency).toBe('KHR');
    expect(res.body.to_currency).toBe('KHR');
    expect(res.body.exchange_rate).toBe(1);
  });
});
