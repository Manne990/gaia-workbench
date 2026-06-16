#!/usr/bin/env node

import { rmSync } from 'node:fs';
import path from 'node:path';

const verificationArtifactPaths = ['dist', 'test-results', 'playwright-report'];

for (const artifactPath of verificationArtifactPaths) {
  rmSync(path.resolve(process.cwd(), artifactPath), { recursive: true, force: true });
}

console.log(`Cleaned verification artifacts: ${verificationArtifactPaths.join(', ')}`);
