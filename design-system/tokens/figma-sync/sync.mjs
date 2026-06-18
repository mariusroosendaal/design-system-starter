#!/usr/bin/env node
/**
 * CLI: a Figma export JSON → the five SNAP token files → dist/tokens.css.
 *
 *   node design-system/tokens/figma-sync/sync.mjs <export.json> [flags]
 *
 * Flags:
 *   --report          print collection/style coverage, write nothing
 *   --dry-run         transform + diff against current files, write nothing
 *   --only=a,b        only emit these files (e.g. --only=color,dimension)
 *   --no-build        skip running build.mjs after writing
 *
 * This is the deterministic core the companion server and the /sync-tokens
 * skill both call. No network, no LLM.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { transform, TOKEN_FILES } from './transform.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = join(HERE, '..');            // design-system/tokens
const BUILD = join(TOKENS_DIR, 'build.mjs');

export function runSync({ exportData, report = false, dryRun = false, onlyFiles = null, build = true, log = console.log }) {
  const existing = {};
  for (const f of TOKEN_FILES) {
    const p = join(TOKENS_DIR, f);
    if (existsSync(p)) existing[f] = JSON.parse(readFileSync(p, 'utf8'));
  }

  const warnings = [];
  const { files, report: rpt } = transform(exportData, { existing, onWarn: (m) => warnings.push(m) });

  if (report) {
    log('\nCollections:');
    for (const [name, where] of Object.entries(rpt.collections)) log(`  ${where.startsWith('→') ? '✓' : '✗'} ${name.padEnd(24)} ${where}`);
    log(`\nType ramp:    ${rpt.ramp.styles} text styles → ${rpt.ramp.roles} roles`);
    log(`Effect styles: ${rpt.effectStyles.matched} matched, ${rpt.effectStyles.skipped.length} skipped`);
    if (rpt.effectStyles.skipped.length) log(`  skipped: ${rpt.effectStyles.skipped.join(', ')}`);
    log(`\nWarnings: ${warnings.length}`);
    warnings.forEach((w) => log(`  ⚠ ${w}`));
    return { files, warnings, report: rpt, written: [] };
  }

  const targets = Object.keys(files).filter((f) => !onlyFiles || onlyFiles.includes(f));
  const written = [];
  let changed = 0;
  for (const f of targets) {
    const p = join(TOKENS_DIR, f);
    const next = JSON.stringify(files[f], null, 2) + '\n';
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (next === prev) { log(`  = ${f} (unchanged)`); continue; }
    changed++;
    if (dryRun) { log(`  ~ ${f} (would change)`); continue; }
    writeFileSync(p, next);
    written.push(f);
    log(`  ✓ ${f}`);
  }

  warnings.forEach((w) => log(`  ⚠ ${w}`));

  if (!dryRun && build && written.length) {
    log('\nRebuilding tokens.css …');
    execFileSync('node', [BUILD], { stdio: 'inherit' });
  } else if (dryRun) {
    log(`\nDry run: ${changed} file(s) would change. Nothing written.`);
  }
  return { files, warnings, report: rpt, written };
}

// CLI entry — only when run directly (`node sync.mjs …`), not when imported
// (the server imports runSync; importing must have no side effects).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.endsWith('.json') ? s : `${s}.json`) : null;
  const exportPath = args.find((a) => !a.startsWith('--'));

  if (!exportPath) {
    console.error('usage: sync.mjs <export.json> [--report|--dry-run|--only=a,b|--no-build]');
    process.exit(2);
  }
  if (!existsSync(exportPath)) {
    console.error(`✗ export not found: ${exportPath}`);
    process.exit(2);
  }

  const exportData = JSON.parse(readFileSync(exportPath, 'utf8'));
  console.log(`Figma export: ${basename(exportPath)}`);
  runSync({
    exportData,
    report: flags.has('--report'),
    dryRun: flags.has('--dry-run'),
    onlyFiles: only,
    build: !flags.has('--no-build'),
  });
}
