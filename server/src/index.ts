import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import createApp from './app.js';

const port = Number(process.env.PORT ?? 3000);
const requestedClientDir = process.env.TINYTRACKER_CLIENT_DIR;
const defaultClientDir = path.resolve(process.cwd(), 'dist', 'client');
const clientDir = requestedClientDir
  ? path.resolve(requestedClientDir)
  : (fs.existsSync(defaultClientDir) ? defaultClientDir : undefined);

const app = createApp({ clientDir });

const server = createServer(app);

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`TinyTracker listening on ${port}`);
});
