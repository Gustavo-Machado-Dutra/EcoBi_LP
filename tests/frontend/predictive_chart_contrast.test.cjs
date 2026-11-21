const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

function extractChartPalettesFromAppJs() {
  const start = APP_JS.indexOf("const CHART_THEME_PALETTES =");
  assert.ok(start > -1, "CHART_THEME_PALETTES must exist in frontend/app.js");
  const eq = APP_JS.indexOf("{", start);
  let depth = 0;
  let end = eq;
  while (end < APP_JS.length) {
    if (APP_JS[end] === "{") depth += 1;
    else if (APP_JS[end] === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
    end += 1;
  }
  const objLiteral = APP_JS.slice(eq, end);
  return vm.runInNewContext(`(${objLiteral})`);
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

test("renderPredictiveChart uses explicit theme SVG presentation attributes and never relies solely on CSS or defaults to black", () => {
  const fnStart = APP_JS.indexOf("function renderPredictiveChart()");
  const fnEnd = APP_JS.indexOf("// 12. TELA 7:", fnStart);
  assert.ok(fnStart > -1 && fnEnd > fnStart, "renderPredictiveChart function bounds must exist");
  const body = APP_JS.slice(fnStart, fnEnd);

  for (const legacyHex of ["#183A32", "#35544B", "#DCE8D9", "#4F7A59", "#C8784A", "#B9D6C2", "#000000", "#000"]) {
    assert.ok(!body.includes(legacyHex), `renderPredictiveChart must not hardcode ${legacyHex}`);
  }

  // Every polyline/polygon/line/text must have explicit SVG attributes so stale CSS never causes black fills
  assert.ok(body.includes('<polygon class="predictive-ci-area"'), "CI area polygon must exist");
  assert.ok(body.includes('fill="${theme.ciFill}" fill-opacity="${theme.ciFillOpacity}" stroke="none"'), "CI polygon must carry explicit fill and fill-opacity");
  assert.ok(body.includes('<polyline class="predictive-ci-bound" points="${upperCoords.join(" ")}" fill="none"'), "CI upper polyline must explicitly set fill=none");
  assert.ok(body.includes('<polyline class="predictive-ci-bound" points="${lowerCoordsAsc.join(" ")}" fill="none"'), "CI lower polyline must explicitly set fill=none");
  assert.ok(body.includes('<polyline class="predictive-line-history" points="${histPolyPoints}" fill="none" stroke="${theme.historyLine}"'), "History polyline must explicitly set fill=none and stroke");
  assert.ok(body.includes('<polyline class="predictive-line-forecast" points="${forecastPolyPoints}" fill="none" stroke="${theme.forecastLine}"'), "Forecast polyline must explicitly set fill=none and stroke");
  assert.ok(body.includes('<rect class="predictive-plot-bg"'), "Plot background rect must exist");
  assert.ok(body.includes("syncPredictiveLegendTheme(theme)"), "Legend colors must sync directly with active chart theme");
});

test("updateDashboardFinanceChart and theme toggle explicitly preserve fill=none and live chart synchronization", () => {
  const finStart = APP_JS.indexOf("function updateDashboardFinanceChart(");
  const finEnd = APP_JS.indexOf("function updateDashboardOperations(", finStart);
  const finBody = APP_JS.slice(finStart, finEnd);
  assert.ok(finBody.includes('class="finance-series-line finance-series-revenue"'), "Revenue series path present");
  assert.ok(finBody.includes('fill="none" stroke="${chartTheme.financeRevenue}"'), "Revenue path sets explicit fill=none and stroke");
  assert.ok(finBody.includes('fill="none" stroke="${chartTheme.financeCost}"'), "Cost path sets explicit fill=none and stroke");
  assert.ok(finBody.includes('fill="none" stroke="${chartTheme.financeMargin}"'), "Margin path sets explicit fill=none and stroke");

  assert.ok(APP_JS.includes("syncAllChartsToTheme();"), "Theme toggle and observer must call syncAllChartsToTheme()");
  assert.ok(APP_JS.includes("new MutationObserver"), "MutationObserver watches data-theme updates");
});

test("RAM gauge SVG, cache-busting asset URLs, and predictive legend in index.html are properly configured", () => {
  const gaugeIdx = INDEX_HTML.indexOf('id="dash-ram-gauge-svg"');
  const gaugeSnippet = INDEX_HTML.slice(gaugeIdx, gaugeIdx + 550);
  assert.ok(gaugeSnippet.includes("ram-gauge-track"), "RAM gauge track should use .ram-gauge-track");
  assert.ok(gaugeSnippet.includes("ram-gauge-arc"), "RAM gauge arc should use .ram-gauge-arc");
  assert.ok(!gaugeSnippet.includes("#DCE8D9") && !gaugeSnippet.includes("#4F7A59"), "RAM gauge must not hardcode SVG strokes");

  const legendIdx = INDEX_HTML.indexOf("swatch-forest");
  const legendBlock = INDEX_HTML.slice(Math.max(0, legendIdx - 160), legendIdx + 550);
  assert.ok(!legendBlock.includes('<div class="chart-legend" aria-hidden="true">'), "Chart legend must be screen-reader accessible");

  assert.match(INDEX_HTML, /\/static\/styles\.css\?v=/, "styles.css link must include cache-busting query");
  assert.match(INDEX_HTML, /\/static\/app\.js\?v=/, "app.js script must include cache-busting query");
  assert.match(INDEX_HTML, /\/static\/onboarding\.js\?v=/, "onboarding.js script must include cache-busting query");
});

test("CHART_THEME_PALETTES in app.js matches CSS tokens and meets WCAG 2.1 contrast thresholds in Light and Dark Mode", () => {
  const lightBlock = extractBlock(CSS_TEXT, /\/\*\s*Modern Green Enterprise 3\.0[\s\S]*?:root\s*\{/);
  const darkBlock = extractBlock(CSS_TEXT, /html\[data-theme=dark\]\s*\{/);
  const light = parseTokens(lightBlock);
  const dark = parseTokens(darkBlock);
  const palettes = extractChartPalettesFromAppJs();

  assert.equal(palettes.light.surfaceBg, light["--chart-surface"]);
  assert.equal(palettes.light.historyLine, light["--chart-series-history"]);
  assert.equal(palettes.light.forecastLine, light["--chart-series-forecast"]);
  assert.equal(palettes.light.baselineLine, light["--chart-series-baseline"]);

  assert.equal(palettes.dark.surfaceBg, dark["--chart-surface"]);
  assert.equal(palettes.dark.historyLine, dark["--chart-series-history"]);
  assert.equal(palettes.dark.forecastLine, dark["--chart-series-forecast"]);
  assert.equal(palettes.dark.baselineLine, dark["--chart-series-baseline"]);

  for (const [modeName, p, t, cardHex] of [
    ["light", palettes.light, light, "#F5F6F5"],
    ["dark", palettes.dark, dark, "#1A2132"],
  ]) {
    const surface = parseColor(p.surfaceBg);
    const card = parseColor(cardHex);
    const axisText = parseColor(p.axisText);
    const splitBg = parseColor(p.splitBg);
    const splitText = parseColor(p.splitText);
    const histLine = parseColor(p.historyLine);
    const fcLine = parseColor(p.forecastLine);
    const baseLine = parseColor(p.baselineLine);
    const splitLine = parseColor(p.splitLine);
    const ciRgb = parseColor(p.ciFill);
    ciRgb.a = Number(p.ciFillOpacity);
    const ciBlend = compositeOver(ciRgb, surface);
    const legendText = parseColor(p.legendText);

    assert.ok(contrastRatio(axisText, surface) >= 4.5, `${modeName} axis text contrast must be >= 4.5:1`);
    assert.ok(contrastRatio(splitText, splitBg) >= 4.5, `${modeName} split pill text contrast must be >= 4.5:1`);
    assert.ok(contrastRatio(legendText, card) >= 4.5, `${modeName} legend text contrast must be >= 4.5:1`);
    assert.equal(p.legendText.toUpperCase(), t["--color-text-primary"].toUpperCase());

    assert.ok(contrastRatio(histLine, surface) >= 3.0, `${modeName} history series contrast must be >= 3:1`);
    assert.ok(contrastRatio(fcLine, surface) >= 3.0, `${modeName} forecast series contrast must be >= 3:1`);
    assert.ok(contrastRatio(baseLine, surface) >= 3.0, `${modeName} baseline series contrast must be >= 3:1`);
    assert.ok(contrastRatio(splitLine, surface) >= 3.0, `${modeName} split line contrast must be >= 3:1`);

    assert.ok(contrastRatio(fcLine, ciBlend) >= 3.0, `${modeName} forecast line over CI fill must be >= 3:1`);
    assert.ok(contrastRatio(baseLine, ciBlend) >= 3.0, `${modeName} baseline line over CI fill must be >= 3:1`);
  }
});
