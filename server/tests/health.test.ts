import request from 'supertest';
import createApp from '../src/app.js';

describe('health endpoint', () => {
  it('returns ok on /health', async () => {
    const app = createApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'TinyTracker' });
  });

  it('returns ok on /api/health', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'TinyTracker' });
  });
});
