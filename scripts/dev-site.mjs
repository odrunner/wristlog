#!/usr/bin/env node
// Local dev server that exposes only what production publishes.
// Audit 2026-09-23 SEC-23-13: `npx serve .` on 0.0.0.0:3000 handed anyone on
// the LAN the whole working tree — .git, dev-config.js, sql/, audit reports,
// .claude/settings.local.json (tokens). This builds .devsite/ as SYMLINKS to
// SITE_FILES (the production allowlist) plus dev-config.js, so edits show up
// live, and serves only that. Run by the com.wrotate.devserver LaunchAgent.
import { rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SITE_FILES } from './build-site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.devsite');

export function devSiteEntries() {
  return [...SITE_FILES.map((f) => f.replace(/\/$/, '')), 'dev-config.js'];
}

export function buildDevSite() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const f of devSiteEntries()) {
    if (existsSync(join(root, f))) symlinkSync(join(root, f), join(out, f));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildDevSite();
  const port = process.env.PORT || '3000';
  const child = spawn('npx', ['serve', out, '--symlinks', '-p', port, '-l', `tcp://0.0.0.0:${port}`],
    { stdio: 'inherit', cwd: root });
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
}
