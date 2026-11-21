const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const CSS_TEXT = fs.readFileSync(path.join(ROOT, "frontend", "styles.css"), "utf8");
const APP_JS = fs.readFileSync(path.join(ROOT, "frontend", "app.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");

function extractBlock(css, headerRegex) {
  const match = headerRegex.exec(css);
  assert.ok(match, `Missing CSS block matching ${headerRegex}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let idx = start;
  while (idx < css.length && depth > 0) {
    if (css[idx] === "{") depth += 1;
    else if (css[idx] === "}") depth -= 1;
    idx += 1;
  }
  return css.slice(start, idx - 1);
}

function parseTokens(block) {
  const tokens = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = hex[1];
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }
  throw new Error(`Unsupported color token: ${value}`);
}

function compositeOver(fg, bg) {
  const alpha = fg.a ?? 1;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance(rgb) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("renderPredictiveChart uses semantic CSS classes without hardcoded light-only SVG hex colors", () => {
  const fnStart = APP_JS.indexOf("function renderPredictiveChart()");
  const fnEnd = APP_JS.indexOf("// 12. TELA 7:", fnStart);
  assert.ok(fnStart > -1 && fnEnd > fnStart, "renderPredictiveChart function bounds must exist");
  const body = APP_JS.slice(fnStart, fnEnd);

  for (const legacyHex of ["#183A32", "#35544B", "#DCE8D9", "#4F7A59", "#C8784A", "#B9D6C2"]) {
    assert.ok(!body.includes(legacyHex), `renderPredictiveChart must not hardcode ${legacyHex}`);
  }

  for (const cls of [
    "predictive-grid-line",
    "predictive-axis-line",
    "predictive-axis-label",
    "predictive-ci-area",
    "predictive-ci-bound",
    "predictive-split-line",
    "predictive-split-badge",
    "predictive-split-label",
    "predictive-line-history",
    "predictive-line-forecast",
    "predictive-line-baseline",
    "predictive-point-history",
    "predictive-point-forecast",
  ]) {
    assert.ok(body.includes(cls), `renderPredictiveChart must emit .${cls}`);
  }
});

test("RAM gauge SVG and predictive legend in index.html use theme-aware markup", () => {
  const gaugeIdx = INDEX_HTML.indexOf('id="dash-ram-gauge-svg"');
  const gaugeSnippet = INDEX_HTML.slice(gaugeIdx, gaugeIdx + 550);
  assert.ok(gaugeSnippet.includes("ram-gauge-track"), "RAM gauge track should use .ram-gauge-track");
  assert.ok(gaugeSnippet.includes("ram-gauge-arc"), "RAM gauge arc should use .ram-gauge-arc");
  assert.ok(!gaugeSnippet.includes("#DCE8D9") && !gaugeSnippet.includes("#4F7A59"), "RAM gauge must not hardcode SVG strokes");

  const legendIdx = INDEX_HTML.indexOf("swatch-forest");
  const legendBlock = INDEX_HTML.slice(Math.max(0, legendIdx - 160), legendIdx + 550);
  assert.ok(!legendBlock.includes('aria-hidden="true"\n            >') && !legendBlock.includes('<div class="chart-legend" aria-hidden="true">'), "Chart legend must be screen-reader accessible");
});

test("Light and Dark Mode chart tokens meet WCAG 2.1 contrast thresholds (>=4.5:1 text, >=3:1 graphics)", () => {
  const lightBlock = extractBlock(CSS_TEXT, /\/\*\s*Modern Green Enterprise 3\.0[\s\S]*?:root\s*\{/);
  const darkBlock = extractBlock(CSS_TEXT, /html\[data-theme=dark\]\s*\{/);
  const light = parseTokens(lightBlock);
  const dark = parseTokens(darkBlock);

  for (const [modeName, t, cardHex] of [
    ["light", light, "#F5F6F5"],
    ["dark", dark, "#1A2132"],
  ]) {
    const surface = parseColor(t["--chart-surface"]);
    const card = parseColor(cardHex);
    const axisText = parseColor(t["--chart-axis-text"]);
    const splitBg = parseColor(t["--chart-split-bg"]);
    const splitText = parseColor(t["--chart-split-text"]);
    const histLine = parseColor(t["--chart-series-history"]);
    const fcLine = parseColor(t["--chart-series-forecast"]);
    const baseLine = parseColor(t["--chart-series-baseline"]);
    const splitLine = parseColor(t["--chart-split-line"]);
    const ciBlend = compositeOver(parseColor(t["--chart-ci-fill"]), surface);
    const legendText = parseColor(t["--color-text-primary"]);

    assert.ok(contrastRatio(axisText, surface) >= 4.5, `${modeName} axis text contrast must be >= 4.5:1`);
    assert.ok(contrastRatio(splitText, splitBg) >= 4.5, `${modeName} split pill text contrast must be >= 4.5:1`);
    assert.ok(contrastRatio(legendText, card) >= 4.5, `${modeName} legend text contrast must be >= 4.5:1`);

    assert.ok(contrastRatio(histLine, surface) >= 3.0, `${modeName} history series contrast must be >= 3:1`);
    assert.ok(contrastRatio(fcLine, surface) >= 3.0, `${modeName} forecast series contrast must be >= 3:1`);
    assert.ok(contrastRatio(baseLine, surface) >= 3.0, `${modeName} baseline series contrast must be >= 3:1`);
    assert.ok(contrastRatio(splitLine, surface) >= 3.0, `${modeName} split line contrast must be >= 3:1`);

    assert.ok(contrastRatio(fcLine, ciBlend) >= 3.0, `${modeName} forecast line over CI fill must be >= 3:1`);
    assert.ok(contrastRatio(baseLine, ciBlend) >= 3.0, `${modeName} baseline line over CI fill must be >= 3:1`);
  }

  // Palette must adapt semantically across Light and Dark rather than reusing identical colors
  assert.notEqual(light["--chart-surface"], dark["--chart-surface"]);
  assert.notEqual(light["--chart-axis-text"], dark["--chart-axis-text"]);
  assert.notEqual(light["--chart-series-history"], dark["--chart-series-history"]);
  assert.notEqual(light["--chart-series-forecast"], dark["--chart-series-forecast"]);
  assert.notEqual(light["--chart-series-baseline"], dark["--chart-series-baseline"]);
});
