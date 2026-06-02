import { test } from "node:test";
import assert from "node:assert/strict";
import { synthSeries } from "../src/feed.js";
import { runBacktest } from "../src/arena.js";
import { FORECASTERS, contextFromPrices } from "../src/forecasters.js";

test("synth series is deterministic for a fixed seed", () => {
  const a = synthSeries({ seed: 42, steps: 100 });
  const b = synthSeries({ seed: 42, steps: 100 });
  assert.deepEqual(a, b);
  const c = synthSeries({ seed: 43, steps: 100 });
  assert.notDeepEqual(a, c);
});

test("every forecaster returns a probability strictly inside (0,1)", () => {
  const prices = synthSeries({ seed: 1, steps: 60 });
  const ctx = contextFromPrices(prices.slice(0, 25));
  for (const f of FORECASTERS) {
    const p = f.predict(ctx);
    assert.ok(p > 0 && p < 1, `${f.id} produced ${p}`);
  }
});

test("coinflipper lands at the no-skill baseline; it cannot have edge", () => {
  const prices = synthSeries({ seed: 7, steps: 4000, momentum: 0.15 });
  const { leaderboard } = runBacktest(prices);
  const flip = leaderboard.find((r) => r.id === "coinflip");
  assert.ok(Math.abs(flip.brier - 0.25) < 1e-6);
  assert.ok(Math.abs(flip.brierSkill) < 1e-6);
});

test("when edge EXISTS (a trend regime), the board detects it and separates agents", () => {
  // A persistent drift regime makes trailing returns predict the next window.
  // The trend/momentum theses should earn positive skill and out-rank
  // mean-reversion, which should go negative.
  const prices = synthSeries({ seed: 7, steps: 6000, vol: 0.025, momentum: 0.1, regimeVol: 0.003 });
  const { leaderboard } = runBacktest(prices);
  const mom = leaderboard.find((r) => r.id === "momentum");
  const rev = leaderboard.find((r) => r.id === "meanrev");
  assert.ok(mom.brierSkill > 0, "momentum should show positive skill on a trending path");
  assert.ok(rev.brierSkill < 0, "mean-reversion should be actively wrong on a trending path");
  assert.ok(mom.elo > rev.elo, "momentum should out-rank mean-reversion in duels");

  const briers = leaderboard.map((r) => r.brier);
  const spread = Math.max(...briers) - Math.min(...briers);
  assert.ok(spread > 0.02, `expected a real Brier spread when edge exists, got ${spread}`);
});

test("when NO edge exists (pure random walk), the board collapses to noise", () => {
  // This is the kill-or-continue check: with no regime, 24-step direction is
  // unpredictable, so every agent should sit on the 0.25 baseline and the
  // board should be ~flat. A leaderboard here would be ranking luck, and that
  // is exactly the honest negative result the arena is built to surface.
  const prices = synthSeries({ seed: 7, steps: 6000, vol: 0.025, momentum: 0.1, regimeVol: 0 });
  const { leaderboard } = runBacktest(prices);
  for (const r of leaderboard) {
    assert.ok(Math.abs(r.brierSkill) < 0.02, `${r.id} should have ~0 skill, got ${r.brierSkill}`);
  }
  const briers = leaderboard.map((r) => r.brier);
  const spread = Math.max(...briers) - Math.min(...briers);
  assert.ok(spread < 0.01, `expected a flat board with no edge, got spread ${spread}`);
});

test("overconfident agent pays for it on log-loss vs its humble twin", () => {
  // YUI (overconfident) and KIRA (humble) share the SAME momentum read but
  // differ only in how hard they push probabilities. On a hard/noisy path the
  // overconfident one should bleed more log-loss.
  const prices = synthSeries({ seed: 3, steps: 6000, momentum: 0.05, vol: 0.05, regimeVol: 0 });
  const { leaderboard } = runBacktest(prices);
  const over = leaderboard.find((r) => r.id === "overconfident");
  const humble = leaderboard.find((r) => r.id === "humble");
  assert.ok(over.logLoss > humble.logLoss);
});

test("backtest reports a coherent claim/duel count", () => {
  const prices = synthSeries({ seed: 7, steps: 1000 });
  const { leaderboard, claims, duels } = runBacktest(prices, { window: 24, horizon: 24 });
  assert.ok(claims > 0);
  // round robin over 6 forecasters = 15 duels per claim.
  assert.equal(duels, claims * 15);
  for (const row of leaderboard) assert.equal(row.n, claims);
});
