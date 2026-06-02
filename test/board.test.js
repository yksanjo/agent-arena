import { test } from "node:test";
import assert from "node:assert/strict";
import { synthSeries } from "../src/feed.js";
import { buildBoard } from "../src/board.js";
import { FORECASTERS } from "../src/forecasters.js";

// Turn a price array into {ts, close} candles at hourly spacing.
function candles(prices, startTs = 1_700_000_000_000) {
  return prices.map((close, i) => ({ ts: startTs + i * 3600 * 1000, close }));
}

function twoTokenSeries({ regimeVol = 0 } = {}) {
  return [
    { token: "AAA", candles: candles(synthSeries({ seed: 11, steps: 1200, vol: 0.025, momentum: 0.1, regimeVol })) },
    { token: "BBB", candles: candles(synthSeries({ seed: 22, steps: 1200, vol: 0.03, momentum: 0.1, regimeVol })) },
  ];
}

test("buildBoard scores every forecaster over every claim", () => {
  const board = buildBoard(twoTokenSeries(), { step: 12 });
  assert.equal(board.leaderboard.length, FORECASTERS.length);
  assert.ok(board.totalClaims > 0);
  for (const row of board.leaderboard) {
    assert.equal(row.n, board.totalClaims); // each agent forecast every claim
    assert.ok(Array.isArray(row.calibration));
  }
  assert.deepEqual(board.tokens, ["AAA", "BBB"]);
});

test("duel records are zero-sum: total wins equal total losses", () => {
  const board = buildBoard(twoTokenSeries(), { step: 12 });
  let w = 0, l = 0;
  for (const r of board.leaderboard) {
    w += r.record.w;
    l += r.record.l;
  }
  assert.equal(w, l);
});

test("ELO is conserved (mean stays at the starting rating)", () => {
  const board = buildBoard(twoTokenSeries(), { step: 12 });
  const mean = board.leaderboard.reduce((s, r) => s + r.elo, 0) / board.leaderboard.length;
  assert.ok(Math.abs(mean - 1000) < 2, `mean elo drifted to ${mean}`);
});

test("on a pure random walk the coin-flipper is not beaten (flat board)", () => {
  const board = buildBoard(twoTokenSeries({ regimeVol: 0 }), { step: 12 });
  for (const r of board.leaderboard) assert.ok(Math.abs(r.skill) < 0.03, `${r.id} skill ${r.skill}`);
});

test("with a real regime, at least one agent clears the edge line", () => {
  const board = buildBoard(twoTokenSeries({ regimeVol: 0.004 }), { step: 12 });
  assert.ok(board.leaderboard.some((r) => r.skill > 0.02), "expected some real skill under a trend regime");
});

test("claims log is bounded, newest-first, and verifiable", () => {
  const board = buildBoard(twoTokenSeries(), { step: 12 });
  assert.ok(board.claimsLog.length > 0 && board.claimsLog.length <= 24);
  for (let i = 1; i < board.claimsLog.length; i++) {
    assert.ok(board.claimsLog[i - 1].openTs >= board.claimsLog[i].openTs); // newest first
  }
  // outcome must agree with the reported move direction (skip near-flat rounding edge)
  for (const c of board.claimsLog) {
    if (c.pct > 0.02) assert.equal(c.outcome, 1);
    if (c.pct < -0.02) assert.equal(c.outcome, 0);
  }
});
