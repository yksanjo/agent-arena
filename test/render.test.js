import { test } from "node:test";
import assert from "node:assert/strict";
import { synthSeries } from "../src/feed.js";
import { buildBoard } from "../src/board.js";
import { renderPage } from "../src/render.js";

function candles(prices, startTs = 1_700_000_000_000) {
  return prices.map((close, i) => ({ ts: startTs + i * 3600 * 1000, close }));
}
// Two tokens + more steps so the no-edge board is robustly flat (not noise).
function series({ momentum = 0, regimeVol = 0 } = {}) {
  return [
    { token: "AAA", candles: candles(synthSeries({ seed: 11, steps: 2000, vol: 0.025, momentum, regimeVol })) },
    { token: "BBB", candles: candles(synthSeries({ seed: 22, steps: 2000, vol: 0.03, momentum, regimeVol })) },
  ];
}

test("renderPage emits a complete self-contained HTML document", () => {
  const html = renderPage(buildBoard(series()), { generatedAt: 1_700_000_000_000 });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("</html>"));
  assert.ok(!html.includes("http://") || html.includes("https://")); // no insecure external refs
  assert.ok(!/<script\s+src=/.test(html)); // no external scripts
});

test("the verdict reflects the data: flat board says NO EDGE", () => {
  const html = renderPage(buildBoard(series()), { generatedAt: 1 });
  assert.ok(html.includes("NO EDGE DETECTED"));
  assert.ok(!html.includes("◆ EDGE DETECTED"));
});

test("the verdict reflects the data: a real regime says EDGE DETECTED", () => {
  const html = renderPage(buildBoard(series({ regimeVol: 0.004 })), { generatedAt: 1 });
  assert.ok(html.includes("EDGE DETECTED"));
  assert.ok(!html.includes("NO EDGE DETECTED"));
});

test("token names are HTML-escaped (no injection from feed data)", () => {
  const board = buildBoard(series());
  board.tokens = ['<img src=x onerror=alert(1)>'];
  board.claimsLog[0].token = '<script>bad</script>';
  const html = renderPage(board, { generatedAt: 1 });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>bad"));
  assert.ok(html.includes("&lt;script&gt;bad"));
});

test("every agent name appears in the rendered leaderboard", () => {
  const board = buildBoard(series());
  const html = renderPage(board, { generatedAt: 1 });
  for (const r of board.leaderboard) assert.ok(html.includes(r.name), `${r.name} missing from page`);
});
