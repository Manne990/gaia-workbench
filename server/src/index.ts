import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const clientDir = path.resolve(process.cwd(), 'dist/client');
const app = createApp({ clientDir });

app.listen(port, () => {
  console.log(`TinyTracker listening on http://127.0.0.1:${port}`);
});
