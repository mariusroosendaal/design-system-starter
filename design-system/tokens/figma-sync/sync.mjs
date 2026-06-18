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
  const written = [];        // files actually written (empty on dry-run)
  const changedFiles = [];   // files that differ from disk (populated either way)
  const changes = [];        // per-token diffs, file-prefixed, for the UI/CLI
  for (const f of targets) {
    const p = join(TOKENS_DIR, f);
    const next = JSON.stringify(files[f], null, 2) + '\n';
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (next === prev) { log(`  = ${f} (unchanged)`); continue; }
    changedFiles.push(f);
    const detail = diffTokens(prev ? JSON.parse(prev) : {}, files[f]);
    changes.push(...detail.map((d) => `${f}  ${d}`));
    if (dryRun) {
      log(`  ~ ${f} (would change · ${detail.length} token${detail.length === 1 ? '' : 's'})`);
      detail.slice(0, 12).forEach((d) => log(`      ${d}`));
      if (detail.length > 12) log(`      … +${detail.length - 12} more`);
      continue;
    }
    writeFileSync(p, next);
    written.push(f);
    log(`  ✓ ${f}`);
  }

  warnings.forEach((w) => log(`  ⚠ ${w}`));

  if (!dryRun && build && written.length) {
    log('\nRebuilding tokens.css …');
    execFileSync('node', [BUILD], { stdio: 'inherit' });
  } else if (dryRun) {
    log(`\nDry run: ${changedFiles.length} file(s) would change. Nothing written.`);
  }
  return { files, warnings, report: rpt, written, changed: changedFiles, changes };
}

// flatten a token tree to Map(path → JSON-encoded value), including mode overrides
function flattenLeaves(node, path, out) {
  if (!node || typeof node !== 'object') return;
  if ('$value' in node) {
    out.set(path, JSON.stringify(node.$value));
    const modes = node.$extensions?.['ds.modes'];
    if (modes) for (const [m, v] of Object.entries(modes)) out.set(`${path}@${m}`, JSON.stringify(v));
  }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) flattenLeaves(v, path ? `${path}.${k}` : k, out);
}

// human-readable token-level changes between two parsed token files
export function diffTokens(prevObj, nextObj) {
  const a = new Map(), b = new Map();
  flattenLeaves(prevObj, '', a);
  flattenLeaves(nextObj, '', b);
  const out = [];
  for (const [k, v] of b) {
    if (!a.has(k)) out.push(`+ ${k} = ${v}`);
    else if (a.get(k) !== v) out.push(`~ ${k}: ${a.get(k)} → ${v}`);
  }
  for (const k of a.keys()) if (!b.has(k)) out.push(`- ${k}`);
  return out;
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
