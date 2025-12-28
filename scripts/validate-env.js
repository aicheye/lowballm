#!/usr/bin/env node
const semver = process.versions.node;
const major = parseInt(semver.split('.')[0], 10);
const REQUIRED_MAJOR = 16;

if (Number.isNaN(major) || major < REQUIRED_MAJOR) {
  console.error(`Node.js v${REQUIRED_MAJOR} or higher required. Found ${process.version}`);
  process.exit(1);
}

console.log(`Node ${process.version} — OK`);

// Optional: check for required folders
const fs = await import('fs');
const path = await import('path');
const repoRoot = path.resolve(process.cwd());
if (!fs.existsSync(path.join(repoRoot, 'server', 'server.js'))) {
  console.warn('Warning: server/server.js not found. Make sure you are at project root.');
}

process.exit(0);
