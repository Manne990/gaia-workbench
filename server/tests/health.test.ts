import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  it('keeps compatibility health status identical to the canonical API contract', async () => {
    const app = createApp();

    const canonicalResponse = await request(app).get('/api/health').expect(200);
    const compatibilityResponse = await request(app).get('/health').expect(200);

    expect(compatibilityResponse.body).toEqual(canonicalResponse.body);
    expect(compatibilityResponse.body).toEqual({
      status: 'ok',
      service: 'TinyTracker'
    });
  });

  it('keeps API health canonical when a client build is configured', async () => {
    const clientDir = mkdtempSync(path.join(tmpdir(), 'tinytracker-client-'));

    try {
      writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><div id="root"></div>');

      const app = createApp({ clientDir });
      const response = await request(app).get('/api/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        service: 'TinyTracker'
      });
    } finally {
      rmSync(clientDir, { recursive: true, force: true });
    }
  });
});
