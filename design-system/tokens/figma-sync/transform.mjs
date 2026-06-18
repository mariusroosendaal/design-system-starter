/**
 * Figma → SNAP token transformer (deterministic, no LLM).
 *
 * Pure function: a normalized Figma export (see plugin/code.js for the shape)
 * → the five W3C token files SNAP's build.mjs consumes. The inverse of build.mjs.
 *
 * Calibrated against the real "🎨 USCC — SNAP DS" file. The mapping is driven by
 * CONFIG below; the model it encodes (discovered from the live variables):
 *
 *   • A variable's NAME is its token path — `background/interactive-primary`
 *     ⇒ `background.interactive-primary`. Routing only needs collection → file.
 *   • `color primitives` vars (`ink/100`) are emitted under a `color.` prefix so
 *     semantic aliases resolve to `{color.ink.100}`.
 *   • `typography primitives` use spaced names (`font size/32`) → normalized to
 *     `fontSize.32` (and `font family` → `fontFamily`).
 *   • The type ramp is VARIABLE-DRIVEN, not one-text-style-per-breakpoint: each
 *     text style (`body/medium`, `…-strong`) binds size/family to variables, and
 *     the responsive sizing lives in the `responsive` collection's `type/*` vars
 *     (one value per breakpoint mode). The ramp builder walks that chain and
 *     re-assembles the composite `ramp.*` shape, collapsing equal breakpoints.
 */

// ──────────────────────────────────────────────────────────────────────────
// CONFIG — the one place to adjust if the Figma file's names drift.
// `npm run sync -- <export.json> --report` shows what matched.
// ──────────────────────────────────────────────────────────────────────────
export const CONFIG = {
  // Figma variable-collection name (case-insensitive) → how to emit it.
  collections: {
    'color':                 { file: 'color.json', modeType: 'theme', defaultMode: 'light' },
    'color primitives':      { file: 'primitives.json', prefix: 'color' },
    'size primitives':       { file: 'primitives.json' },
    'typography primitives': { file: 'primitives.json' },
    'responsive':            { file: 'dimension.json', modeType: 'breakpoint', defaultMode: 'sm',
                               modeOrder: ['sm', 'md', 'lg', 'xl', '2xl'],
                               // `type/*` are responsive font sizes — consumed by
                               // the ramp builder, not emitted to dimension.json.
                               excludePrefixes: ['type'] },
    'typography':            { ramp: true }, // family/size/weight vars feed the ramp
  },

  // Collections present in the file but intentionally not synced (doc helpers).
  ignoreCollections: ['.utility'],

  // Segment renames (Figma uses spaced names for some primitives).
  segmentRename: { 'font family': 'fontFamily', 'font size': 'fontSize' },

  // Last-resort fallback. The CSS fallback stack lives in a `font family/<x>-stack`
  // variable in Figma (the bare `font family/<x>` value stays the face name so
  // Figma can render it). This map is used only if that `-stack` variable is absent.
  fontFamilyStacks: {
    'GT America': "'GT America', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    'Tobias': "'Tobias', Georgia, 'Times New Roman', Times, serif",
  },

  // Figma mode name (lowercased) → token mode key, when they differ. Identity otherwise.
  modeAliases: { theme: {}, breakpoint: {} },

  // $type per top-level group, lifted from the hand-authored token files.
  groupTypes: {
    color: 'color', size: 'dimension', radius: 'dimension', fontSize: 'dimension',
    fontFamily: 'fontFamily', fontWeight: 'fontWeight',
    space: 'dimension', interactive: 'dimension', layout: 'dimension',
    'content-width': 'dimension',
    background: 'color', border: 'color', text: 'color',
  },

  // FLOAT values that stay unitless (everything else dimensional gets `px`).
  unitless: [/^layout\.columns$/],

  // The type ramp.
  ramp: {
    file: 'typography.json',
    root: 'ramp',
    breakpoints: ['sm', 'md', 'lg', 'xl', '2xl'],
  },

  // fontWeight group in typography.json — name → number.
  fontWeights: { thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 },

  // Effect styles → elevation.json shadows. Name (lowercased) → shadow key.
  effectStyles: {
    file: 'elevation.json',
    root: 'shadow',
    nameMap: { 'shadow-sm': 'sm', 'shadow-md': 'md', 'focus': 'focus', '.focus': 'focus' },
  },

  // Carry each file's prose $description forward from the existing file.
  preserveFileDescription: true,
};

export const TOKEN_FILES = ['primitives.json', 'color.json', 'dimension.json', 'typography.json', 'elevation.json'];

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────
const lc = (s) => (s || '').toLowerCase();

// variable name → dotted token path, applying segment renames + collection prefix
function tokenPath(collectionName, varName) {
  const cfg = CONFIG.collections[lc(collectionName)];
  const segs = varName.split('/').map((s) => s.trim()).map((s) => CONFIG.segmentRename[lc(s)] || s);
  const path = segs.join('.');
  return cfg?.prefix ? `${cfg.prefix}.${path}` : path;
}

const hex = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
const colorToHex = ({ r, g, b, a = 1 }) => {
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  return a >= 1 ? base : base + hex(a);
};

function setIn(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ||= {};
  node[parts.at(-1)] = value;
}

const isUnitless = (path) => CONFIG.unitless.some((re) => re.test(path));

// Figma letterSpacing → em string ("-0.039em" / "0")
function letterSpacingEm(ls) {
  if (!ls) return '0';
  if (ls.unit === 'PIXELS') return `${ls.value}px`;
  const em = ls.unit === 'PERCENT' ? ls.value / 100 : ls.value;
  if (Math.abs(em) < 1e-9) return '0';
  return `${parseFloat(em.toFixed(4))}em`;
}

// Figma lineHeight → unitless ratio (1.1 / 1.5)
function lineHeightRatio(lh, fontSizePx) {
  if (!lh || lh.unit === 'AUTO') return 1;
  if (lh.unit === 'PERCENT') return parseFloat((lh.value / 100).toFixed(4));
  if (lh.unit === 'PIXELS' && fontSizePx) return parseFloat((lh.value / fontSizePx).toFixed(4));
  return parseFloat(Number(lh.value).toFixed(4));
}

const weightNum = (styleName, warn, ctx) => {
  const s = lc(styleName);
  for (const [k, n] of Object.entries(CONFIG.fontWeights)) if (s.includes(k)) return n;
  warn?.(`${ctx}: could not map weight "${styleName}", defaulting 400`);
  return 400;
};

// ──────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────
export function transform(fig, opts = {}) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); opts.onWarn?.(m); };
  const existing = opts.existing || {};

  // indices across every collection
  const idToPath = new Map();        // varId → dotted token path (normalized + prefixed)
  const byId = new Map();            // varId → { v, col }
  for (const col of fig.collections || []) {
    for (const v of col.variables || []) {
      idToPath.set(v.id, tokenPath(col.name, v.name));
      byId.set(v.id, { v, col });
    }
  }

  // `font family/<x>-stack` variables hold the web CSS fallback stack for the
  // sibling `fontFamily.<x>` token (whose own value stays the bare face name so
  // Figma can render it). Collect them, and skip emitting them as tokens.
  const fontStackByPath = new Map(); // 'fontFamily.sans' → "'GT America', system-ui, …"
  const skipIds = new Set();
  for (const col of fig.collections || []) {
    for (const v of col.variables || []) {
      const p = tokenPath(col.name, v.name);
      const m = p.match(/^(fontFamily\..+)-stack$/);
      if (!m) continue;
      const raw = v.valuesByMode?.[col.defaultModeId];
      if (raw?.type === 'STRING') fontStackByPath.set(m[1], raw.value);
      skipIds.add(v.id);
    }
  }
  const aliasStr = (id) => {
    const p = idToPath.get(id);
    if (!p) { warn(`alias → unknown variable id ${id}`); return null; }
    return `{${p}}`;
  };

  const files = {};
  const ensureFile = (name) => (files[name] ||= {});
  const report = { collections: {}, ramp: { styles: 0, roles: 0 }, effectStyles: { matched: 0, skipped: [] }, warnings };

  // ── variables → primitives / color / dimension ───────────────────────────
  for (const col of fig.collections || []) {
    if (CONFIG.ignoreCollections.map(lc).includes(lc(col.name))) { report.collections[col.name] = 'ignored'; continue; }
    const cfg = CONFIG.collections[lc(col.name)];
    if (!cfg) { report.collections[col.name] = 'UNMAPPED (skipped)'; warn(`collection "${col.name}" has no CONFIG entry — skipped`); continue; }
    if (cfg.ramp) { report.collections[col.name] = '→ ramp builder'; continue; } // handled below
    report.collections[col.name] = `→ ${cfg.file}${cfg.modeType ? ` (${cfg.modeType})` : ''}`;
    const file = ensureFile(cfg.file);

    const modeKey = (modeId) => {
      const m = (col.modes || []).find((x) => x.modeId === modeId);
      const raw = lc(m?.name);
      return CONFIG.modeAliases[cfg.modeType]?.[raw] || raw;
    };

    for (const v of col.variables || []) {
      if (skipIds.has(v.id)) continue; // `*-stack` helper, folded into its sibling
      const path = tokenPath(col.name, v.name);
      if (cfg.excludePrefixes?.some((p) => path === p || path.startsWith(p + '.'))) continue;

      const resolveOne = (raw) => {
        if (!raw) return undefined;
        if (raw.type === 'ALIAS') return aliasStr(raw.id);
        if (raw.type === 'COLOR') return colorToHex(raw);
        if (raw.type === 'STRING') return raw.value;
        if (raw.type === 'FLOAT') return isUnitless(path) ? raw.value : `${raw.value}px`;
        if (raw.type === 'BOOLEAN') return raw.value;
        warn(`${path}: unhandled value type ${raw.type}`);
        return undefined;
      };

      let leaf;
      if (!cfg.modeType) {
        leaf = { $value: resolveOne(v.valuesByMode?.[col.defaultModeId]) };
      } else {
        const byKey = {};
        for (const [mid, raw] of Object.entries(v.valuesByMode || {})) byKey[modeKey(mid)] = resolveOne(raw);
        if (cfg.modeType === 'theme') {
          leaf = { $value: byKey[cfg.defaultMode] };
          const extra = {};
          for (const [k, val] of Object.entries(byKey)) if (k !== cfg.defaultMode && val !== undefined) extra[k] = val;
          if (Object.keys(extra).length) leaf.$extensions = { 'ds.modes': extra };
        } else { // breakpoint — list a bp only when it changes from the prior active one
          const order = cfg.modeOrder;
          leaf = { $value: byKey[order[0]] };
          const ds = {};
          let prev = byKey[order[0]];
          for (const bp of order.slice(1)) {
            const cur = byKey[bp];
            if (cur !== undefined && cur !== prev) { ds[bp] = cur; prev = cur; }
          }
          if (Object.keys(ds).length) leaf.$extensions = { 'ds.modes': ds };
        }
      }
      // A fontFamily token's value is the web CSS fallback stack, which can't be a
      // Figma font value (Figma couldn't render text bound to it) — it comes from
      // the sibling `font family/<x>-stack` variable, with CONFIG as a last resort.
      if (path.startsWith('fontFamily.')) {
        leaf.$value = fontStackByPath.get(path) || CONFIG.fontFamilyStacks[leaf.$value] || leaf.$value;
      }
      if (v.description) leaf.$description = v.description; // docs, for every token incl. fontFamily
      setIn(file, path, leaf);
    }
  }

  // ── type ramp (text styles + variable-driven responsive sizing) ──────────
  buildRamp(fig, byId, idToPath, report, warn, ensureFile);

  // ── effect styles → shadows ─────────────────────────────────────────────
  const es = CONFIG.effectStyles;
  const shadowEntries = {};
  for (const style of fig.effectStyles || []) {
    const key = es.nameMap[lc(style.name)];
    if (!key) { report.effectStyles.skipped.push(style.name); continue; }
    const drops = (style.effects || []).filter((e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
    if (!drops.length) { warn(`effect style "${style.name}": no drop shadows`); continue; }
    const toShadow = (e) => ({
      color: (e.boundVariables?.color && aliasStr(e.boundVariables.color)) || colorToHex(e.color),
      offsetX: `${e.offset?.x ?? 0}px`,
      offsetY: `${e.offset?.y ?? 0}px`,
      blur: `${e.radius ?? 0}px`,
      spread: `${e.spread ?? 0}px`,
    });
    shadowEntries[key] = drops.length === 1 ? { $value: toShadow(drops[0]) } : { $value: drops.map(toShadow) };
    report.effectStyles.matched++;
  }
  if (Object.keys(shadowEntries).length) {
    const shadow = (ensureFile(es.file)[es.root] ||= {});
    for (const [k, v] of Object.entries(shadowEntries)) shadow[k] = v;
  }

  finalizeFiles(files, fig, existing, warn);
  return { files, report };
}

// ── ramp builder ────────────────────────────────────────────────────────────
function buildRamp(fig, byId, idToPath, report, warn, ensureFile) {
  const bps = CONFIG.ramp.breakpoints;
  const aliasStr = (id) => (idToPath.get(id) ? `{${idToPath.get(id)}}` : null);

  // follow single-mode alias hops to the terminal variable, return its token path.
  // (a text style's family binds to `heading/family` → `font family/sans`; we want
  // the primitive `{fontFamily.sans}`, not the unemitted intermediate.)
  function terminalAliasStr(id) {
    let cur = id;
    for (let guard = 0; guard < 12; guard++) {
      const e = byId.get(cur);
      if (!e) break;
      const x = e.v.valuesByMode[e.col.defaultModeId];
      if (e.col.modes.length === 1 && x?.type === 'ALIAS') { cur = x.id; continue; }
      break;
    }
    return idToPath.get(cur) ? `{${idToPath.get(cur)}}` : null;
  }

  // resolve a (possibly single-mode → responsive) size variable to {bp: '{fontSize.N}'}
  function perBreakpointSize(id) {
    const e = byId.get(id);
    if (!e) { warn(`ramp: unknown size variable ${id}`); return null; }
    const { v, col } = e;
    if (col.modes.length > 1) {
      const out = {};
      for (const m of col.modes) {
        const raw = v.valuesByMode[m.modeId];
        out[lc(m.name)] = raw?.type === 'ALIAS' ? aliasStr(raw.id) : raw?.type === 'FLOAT' ? `${raw.value}px` : undefined;
      }
      return out;
    }
    const raw = v.valuesByMode[col.defaultModeId];
    if (raw?.type === 'ALIAS') return perBreakpointSize(raw.id);          // hop into the responsive type var
    if (raw?.type === 'FLOAT') return Object.fromEntries(bps.map((b) => [b, `${raw.value}px`]));
    return null;
  }

  const ramp = {};
  const weightsUsed = new Set();
  for (const style of fig.textStyles || []) {
    let base = style.name;
    const strong = base.endsWith('-strong');
    if (strong) base = base.slice(0, -'-strong'.length);
    const role = base.split('/').map((s) => s.trim()).join('-'); // heading-expressive/display → heading-expressive-display

    const famId = style.boundVariables?.fontFamily;
    const fontFamily = (famId && terminalAliasStr(famId)) || `${style.fontName?.family}`;
    const weight = weightNum(style.fontName?.style, warn, `text style "${style.name}"`);
    weightsUsed.add(weight);
    const lineHeight = lineHeightRatio(style.lineHeight, style.fontSize);
    const letterSpacing = letterSpacingEm(style.letterSpacing);
    const transform = lc(style.textCase) === 'upper' ? 'uppercase' : lc(style.textCase) === 'lower' ? 'lowercase' : null;

    const sizeId = style.boundVariables?.fontSize;
    const perBp = sizeId ? perBreakpointSize(sizeId) : null;
    if (!perBp) warn(`text style "${style.name}": no responsive size found; using ${style.fontSize}px`);

    const byBp = {};
    for (const bp of bps) {
      const fontSize = perBp?.[bp] || `${style.fontSize}px`;
      byBp[bp] = { composite: { fontFamily, fontWeight: weight, fontSize, lineHeight, letterSpacing }, extra: transform ? { transform } : {} };
    }

    const roleNode = (ramp[role] ||= {});
    // role-level docs come from the (non-strong) text style's Figma description
    if (!strong && style.description && roleNode.$description === undefined) roleNode.$description = style.description;
    for (const seg of collapseRanges(bps, byBp)) {
      const key = seg.range + (strong ? '-strong' : '');
      const entry = { $value: seg.value.composite };
      if (seg.value.extra.transform) entry.$extensions = { 'ds.textTransform': seg.value.extra.transform };
      roleNode[key] = entry;
    }
    report.ramp.styles++;
  }
  report.ramp.roles = Object.keys(ramp).length;

  if (Object.keys(ramp).length) {
    const file = ensureFile(CONFIG.ramp.file);
    // fontWeight group first (matches the hand-authored order), then ramp
    const fontWeight = {};
    const seenWeights = new Set();
    for (const [name, n] of Object.entries(CONFIG.fontWeights)) {
      if (weightsUsed.has(n) && !seenWeights.has(n)) { fontWeight[name] = { $value: n }; seenWeights.add(n); }
    }
    file.fontWeight = fontWeight;
    file[CONFIG.ramp.root] = ramp;
  }
}

// collapse [sm…2xl] composites into contiguous-equal range segments
function collapseRanges(order, byBp) {
  const present = order.filter((bp) => byBp[bp]);
  const segs = [];
  for (const bp of present) {
    const cur = byBp[bp];
    const last = segs.at(-1);
    if (last && JSON.stringify(last.value.composite) === JSON.stringify(cur.composite)
            && JSON.stringify(last.value.extra) === JSON.stringify(cur.extra)) last.end = bp;
    else segs.push({ start: bp, end: bp, value: cur });
  }
  return segs.map((s) => ({ range: s.start === s.end ? s.start : `${s.start}-${s.end}`, value: s.value }));
}

// inject $type per group, file-level $extensions, $description; order $-meta first
function finalizeFiles(files, fig, existing, warn) {
  const fileExt = {};
  for (const cfg of Object.values(CONFIG.collections)) {
    if (!cfg.file || !cfg.modeType) continue;
    fileExt[cfg.file] = {
      'ds.modeType': cfg.modeType,
      'ds.defaultMode': cfg.defaultMode,
      ...(cfg.modeType === 'breakpoint' ? { 'ds.modes': cfg.modeOrder } : {}),
    };
  }
  if (files['color.json'] && fileExt['color.json'] && !fileExt['color.json']['ds.modes']) {
    const colCol = (fig.collections || []).find((c) => CONFIG.collections[lc(c.name)]?.file === 'color.json');
    const modes = (colCol?.modes || []).map((m) => CONFIG.modeAliases.theme[lc(m.name)] || lc(m.name));
    fileExt['color.json']['ds.modes'] = modes.length ? modes : [fileExt['color.json']['ds.defaultMode']];
  }

  for (const [name, obj] of Object.entries(files)) {
    for (const groupKey of Object.keys(obj)) {
      if (groupKey.startsWith('$')) continue;
      const type = CONFIG.groupTypes[groupKey]
        || (name === 'typography.json' && groupKey === 'ramp' ? 'typography' : null)
        || (name === 'elevation.json' && groupKey === 'shadow' ? 'shadow' : null);
      if (type) obj[groupKey] = { $type: type, ...obj[groupKey] };
      else warn(`${name}: group "${groupKey}" has no $type in CONFIG.groupTypes`);
    }
    if (fileExt[name]) obj.$extensions = fileExt[name];
    // Per-token docs now come from Figma (variable/style descriptions). Only the
    // file-level prose has no Figma source, so it's carried forward from the repo.
    if (CONFIG.preserveFileDescription && existing[name]?.$description && obj.$description === undefined) {
      obj.$description = existing[name].$description;
    }
  }

  for (const [name, obj] of Object.entries(files)) files[name] = orderMeta(obj);
}

function orderMeta(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const meta = {}, rest = {};
  for (const [k, v] of Object.entries(obj)) (k === '$description' || k === '$extensions' ? meta : rest)[k] = v;
  const out = { ...meta };
  for (const [k, v] of Object.entries(rest)) out[k] = k.startsWith('$') ? v : orderMeta(v);
  return out;
}
