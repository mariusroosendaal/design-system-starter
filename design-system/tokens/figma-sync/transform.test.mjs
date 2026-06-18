/**
 * Offline proof of the transformer, calibrated to the REAL SNAP model
 * (discovered from the live Figma file). No Figma, no network.
 *
 *   node design-system/tokens/figma-sync/transform.test.mjs
 *
 * Exercises every tricky path: the `color.` prefix on color primitives, spaced
 * `font family`/`font size` names, alias resolution, breakpoint compression,
 * the variable-driven type ramp (text style → typography var → responsive
 * `type/*` var → font-size primitive), range collapsing, fontWeight dedup,
 * fontFamily stack expansion, multi-drop shadows, and bound focus color.
 */
import { transform } from './transform.mjs';
import assert from 'node:assert/strict';

const color = (r, g, b, a = 1) => ({ type: 'COLOR', r, g, b, a });
const alias = (id) => ({ type: 'ALIAS', id });
const float = (v) => ({ type: 'FLOAT', value: v });
const str = (v) => ({ type: 'STRING', value: v });
const ls = (v) => ({ unit: 'PERCENT', value: v });
const lh = (v) => ({ unit: 'PERCENT', value: v });
const ONE = [{ modeId: 'm', name: 'Mode 1' }];

const fig = {
  collections: [
    { name: 'color primitives', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'ink100', name: 'ink/100', resolvedType: 'COLOR', valuesByMode: { m: color(0x0a / 255, 0x15 / 255, 0x2b / 255, 1) } },
      { id: 'ink12', name: 'ink/12', resolvedType: 'COLOR', valuesByMode: { m: color(0x0a / 255, 0x15 / 255, 0x2b / 255, 0.122) } },
      { id: 'gray', name: 'gray/gray', resolvedType: 'COLOR', valuesByMode: { m: color(0.96, 0.96, 0.96, 1) } },
      { id: 'blueImp', name: 'blue/impactful', resolvedType: 'COLOR', valuesByMode: { m: color(0, 0x1f / 255, 0x5c / 255, 1) } },
      { id: 'blueBold', name: 'blue/bold', resolvedType: 'COLOR', valuesByMode: { m: color(0.19, 0.23, 0.98, 1) } },
    ] },
    { name: 'size primitives', defaultModeId: 'm', modes: ONE, variables: [
      { id: 's12', name: 'size/12', resolvedType: 'FLOAT', valuesByMode: { m: float(12) } },
      { id: 's16', name: 'size/16', resolvedType: 'FLOAT', valuesByMode: { m: float(16) } },
      { id: 's24', name: 'size/24', resolvedType: 'FLOAT', valuesByMode: { m: float(24) } },
    ] },
    { name: 'typography primitives', defaultModeId: 'm', modes: ONE, variables: [
      // sans gets its stack from a sibling `-stack` variable + its own doc description; serif uses the CONFIG fallback
      { id: 'famSans', name: 'font family/sans', resolvedType: 'STRING', description: 'Primary UI typeface.', valuesByMode: { m: str('GT America') } },
      { id: 'famSansStack', name: 'font family/sans-stack', resolvedType: 'STRING', valuesByMode: { m: str("'GT America', Arial, sans-serif") } },
      { id: 'famSerif', name: 'font family/serif', resolvedType: 'STRING', valuesByMode: { m: str('Tobias') } },
      { id: 'fs10', name: 'font size/10', resolvedType: 'FLOAT', valuesByMode: { m: float(10) } },
      { id: 'fs16', name: 'font size/16', resolvedType: 'FLOAT', valuesByMode: { m: float(16) } },
      { id: 'fs32', name: 'font size/32', resolvedType: 'FLOAT', valuesByMode: { m: float(32) } },
      { id: 'fs42', name: 'font size/42', resolvedType: 'FLOAT', valuesByMode: { m: float(42) } },
    ] },
    { name: 'color', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'light' }], variables: [
      { id: 'bgDefault', name: 'background/default', resolvedType: 'COLOR', valuesByMode: { light: alias('gray') } },
      { id: 'bgPrimary', name: 'background/interactive-primary', resolvedType: 'COLOR', description: 'Primary action fill (resting).', valuesByMode: { light: alias('blueImp') } },
      { id: 'txtDefault', name: 'text/default', resolvedType: 'COLOR', valuesByMode: { light: alias('ink100') } },
      { id: 'borderFocus', name: 'border/focus', resolvedType: 'COLOR', valuesByMode: { light: alias('blueBold') } },
    ] },
    { name: 'responsive', defaultModeId: 'sm',
      modes: ['sm', 'md', 'lg', 'xl', '2xl'].map((n) => ({ modeId: n, name: n })), variables: [
        // space/4: 12,12,16,16,24 ⇒ ds.modes {lg, 2xl}
        { id: 'space4', name: 'space/4', resolvedType: 'FLOAT', valuesByMode: { sm: alias('s12'), md: alias('s12'), lg: alias('s16'), xl: alias('s16'), '2xl': alias('s24') } },
        { id: 'cols', name: 'layout/columns', resolvedType: 'FLOAT', valuesByMode: { sm: float(12), md: float(12), lg: float(12), xl: float(12), '2xl': float(12) } },
        // responsive type sizes (consumed by the ramp, excluded from dimension.json)
        { id: 'typeBodyMed', name: 'type/body/medium', resolvedType: 'FLOAT', valuesByMode: { sm: alias('fs16'), md: alias('fs16'), lg: alias('fs16'), xl: alias('fs16'), '2xl': alias('fs16') } },
        { id: 'typeHeadDisp', name: 'type/heading/display', resolvedType: 'FLOAT', valuesByMode: { sm: alias('fs32'), md: alias('fs42'), lg: alias('fs42'), xl: alias('fs42'), '2xl': alias('fs42') } },
        { id: 'typeLabelSm', name: 'type/label/small', resolvedType: 'FLOAT', valuesByMode: { sm: alias('fs10'), md: alias('fs10'), lg: alias('fs10'), xl: alias('fs10'), '2xl': alias('fs10') } },
      ] },
    { name: 'typography', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'bodyFam', name: 'body/family', resolvedType: 'STRING', valuesByMode: { m: alias('famSans') } },
      { id: 'headFam', name: 'heading/family', resolvedType: 'STRING', valuesByMode: { m: alias('famSans') } },
      { id: 'labelFam', name: 'label/family', resolvedType: 'STRING', valuesByMode: { m: alias('famSans') } },
      { id: 'bodyMedSize', name: 'body/medium/size', resolvedType: 'FLOAT', valuesByMode: { m: alias('typeBodyMed') } },
      { id: 'headDispSize', name: 'heading/display/size', resolvedType: 'FLOAT', valuesByMode: { m: alias('typeHeadDisp') } },
      { id: 'labelSmSize', name: 'label/small/size', resolvedType: 'FLOAT', valuesByMode: { m: alias('typeLabelSm') } },
    ] },
    { name: '.utility', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'specBg', name: 'color/spec-bg', resolvedType: 'COLOR', valuesByMode: { m: color(1, 1, 1, 1) } },
    ] },
  ],
  textStyles: [
    mkText('body/medium', 'GT America', 'Light', 16, 150, -1.1, 'bodyMedSize', 'bodyFam'),
    mkText('body/medium-strong', 'GT America', 'Bold', 16, 150, -1.1, 'bodyMedSize', 'bodyFam'),
    { ...mkText('heading/display', 'GT America', 'Light', 32, 110, -3.9, 'headDispSize', 'headFam'), description: 'Largest heading.' },
    mkText('label/small', 'GT America', 'Bold', 10, 140, 7.5, 'labelSmSize', 'labelFam', 'UPPER'),
  ],
  effectStyles: [
    { name: 'shadow-md', effects: [
      { type: 'DROP_SHADOW', color: color(0, 0, 0, 0.3), offset: { x: 0, y: 0 }, radius: 2, spread: 0 },
      { type: 'DROP_SHADOW', color: color(0, 0, 0, 0.08), offset: { x: 0, y: 3 }, radius: 3, spread: 0 },
    ] },
    { name: '.focus', effects: [
      { type: 'DROP_SHADOW', color: color(0.19, 0.23, 0.98, 1), offset: { x: 0, y: 0 }, radius: 0, spread: 2, boundVariables: { color: 'borderFocus' } },
    ] },
  ],
};

function mkText(name, family, style, fontSize, lhPct, lsPct, sizeId, famId, textCase = 'ORIGINAL') {
  return { name, fontName: { family, style }, fontSize, lineHeight: lh(lhPct), letterSpacing: ls(lsPct), textCase,
    boundVariables: { fontSize: sizeId, fontFamily: famId } };
}

const warnings = [];
const { files, report } = transform(fig, { onWarn: (m) => warnings.push(m), existing: { 'color.json': { $description: 'kept doc' } } });

// ── primitives: color. prefix, fontFamily stack expansion, spaced names ──
assert.equal(files['primitives.json'].color.$type, 'color');
assert.equal(files['primitives.json'].color.ink['100'].$value, '#0a152b');
assert.equal(files['primitives.json'].color.ink['12'].$value, '#0a152b1f');
assert.equal(files['primitives.json'].color.gray.gray.$value, '#f5f5f5');
assert.equal(files['primitives.json'].size['12'].$value, '12px');
// font-family: value from the `-stack` variable (sans) or CONFIG fallback (serif); the variable's own description is docs
assert.equal(files['primitives.json'].fontFamily.sans.$value, "'GT America', Arial, sans-serif", 'sans stack from -stack variable');
assert.ok(!files['primitives.json'].fontFamily['sans-stack'], '-stack helper is folded in, not emitted as a token');
assert.equal(files['primitives.json'].fontFamily.sans.$description, 'Primary UI typeface.', 'fontFamily var description is docs');
assert.match(files['primitives.json'].fontFamily.serif.$value, /^'Tobias', Georgia/, 'serif stack from CONFIG fallback');
assert.equal(files['primitives.json'].fontSize['32'].$value, '32px', 'font size/32 → fontSize.32');

// ── color semantic: aliases resolve through the color. prefix ──
assert.equal(files['color.json'].background.default.$value, '{color.gray.gray}');
assert.equal(files['color.json'].background['interactive-primary'].$value, '{color.blue.impactful}');
assert.equal(files['color.json'].background['interactive-primary'].$description, 'Primary action fill (resting).');
assert.equal(files['color.json'].text.default.$value, '{color.ink.100}');
assert.deepEqual(files['color.json'].$extensions['ds.modes'], ['light']);
assert.equal(files['color.json'].$description, 'kept doc');

// ── dimension: compression, unitless, and type/* EXCLUDED ──
const space4 = files['dimension.json'].space['4'];
assert.equal(space4.$value, '{size.12}');
assert.deepEqual(space4.$extensions['ds.modes'], { lg: '{size.16}', '2xl': '{size.24}' });
assert.equal(files['dimension.json'].layout.columns.$value, 12);
assert.ok(!files['dimension.json'].layout.columns.$extensions);
assert.ok(!files['dimension.json'].type, 'type/* must NOT land in dimension.json');

// ── typography ramp: variable-driven, terminal family, ranges, weights ──
const tf = files['typography.json'];
assert.deepEqual(Object.keys(tf.fontWeight).filter((k) => !k.startsWith('$')), ['light', 'bold'], 'no spurious normal:400');
assert.equal(tf.fontWeight.light.$value, 300);
const bm = tf.ramp['body-medium'];
assert.ok(bm['sm-2xl'] && bm['sm-2xl-strong'], 'constant size collapses to sm-2xl + strong');
assert.equal(bm['sm-2xl'].$value.fontFamily, '{fontFamily.sans}', 'family resolves to terminal primitive, not {body.family}');
assert.equal(bm['sm-2xl'].$value.fontSize, '{fontSize.16}');
assert.equal(bm['sm-2xl'].$value.lineHeight, 1.5);
assert.equal(bm['sm-2xl'].$value.letterSpacing, '-0.011em');
assert.equal(bm['sm-2xl-strong'].$value.fontWeight, 700);
const hd = tf.ramp['heading-display'];
assert.equal(hd.$description, 'Largest heading.', 'ramp role doc comes from the text style description');
assert.ok(hd.sm && hd['md-2xl'], 'heading-display: sm distinct, md..2xl equal → md-2xl');
assert.equal(hd.sm.$value.fontSize, '{fontSize.32}');
assert.equal(hd['md-2xl'].$value.fontSize, '{fontSize.42}');
const lsmall = tf.ramp['label-small']['sm-2xl'];
assert.equal(lsmall.$extensions['ds.textTransform'], 'uppercase');
assert.equal(lsmall.$value.letterSpacing, '0.075em');

// ── elevation: multi-drop array + bound focus color ──
assert.ok(Array.isArray(files['elevation.json'].shadow.md.$value));
assert.equal(files['elevation.json'].shadow.md.$value[0].blur, '2px');
assert.equal(files['elevation.json'].shadow.focus.$value.color, '{border.focus}');
assert.equal(files['elevation.json'].shadow.focus.$value.spread, '2px');

// ── routing report + .utility ignored ──
assert.equal(report.collections['.utility'], 'ignored');
assert.equal(report.ramp.styles, 4);
assert.equal(report.effectStyles.matched, 2);

console.log('✓ transform.test.mjs — all assertions passed');
console.log(`  ${Object.keys(files).length} files · ${report.ramp.roles} ramp roles · ${warnings.length} warnings`);
if (warnings.length) console.log(warnings.map((w) => `    ⚠ ${w}`).join('\n'));
