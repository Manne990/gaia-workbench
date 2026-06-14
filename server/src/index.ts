import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const clientDir = path.resolve(process.cwd(), 'dist/client');
const databasePath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data/tinytracker.sqlite');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const app = createApp({ clientDir, databasePath });

app.listen(port, () => {
  console.log(`TinyTracker listening on http://127.0.0.1:${port}`);
});
