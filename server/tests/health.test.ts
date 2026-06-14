import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('health endpoints', () => {
  it('serves API health status', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      service: 'TinyTracker'
    });
  });

  it('serves root health status when no client build exists', async () => {
    const app = createApp();

    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('TinyTracker');
  });
});
