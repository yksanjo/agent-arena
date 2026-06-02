import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brierOne,
  logLossOne,
  brier,
  brierSkill,
  calibrationBins,
  expectedCalibrationError,
  clampP,
} from "../src/score.js";

test("Brier rewards confident-correct and punishes confident-wrong", () => {
  assert.ok(brierOne(0.99, 1) < brierOne(0.6, 1)); // more confident + right is better
  assert.ok(brierOne(0.99, 0) > brierOne(0.6, 0)); // more confident + wrong is worse
  assert.equal(brierOne(0.5, 1), 0.25); // no-skill baseline
  assert.equal(brierOne(0.5, 0), 0.25);
});

test("log-loss punishes confident-wrong far harder than Brier, and never returns Infinity", () => {
  const confidentWrong = logLossOne(1, 0); // would be Infinity without clamping
  assert.ok(Number.isFinite(confidentWrong));
  assert.ok(logLossOne(0.99, 0) > brierOne(0.99, 0)); // log-loss is the harsher judge
});

test("clampP guards the input contract", () => {
  assert.throws(() => clampP(1.2));
  assert.throws(() => clampP(-0.1));
  assert.throws(() => clampP(NaN));
  assert.ok(clampP(0) > 0 && clampP(1) < 1); // pulled strictly inside (0,1)
});

test("outcome must be exactly 0 or 1", () => {
  assert.throws(() => brierOne(0.5, 2));
  assert.throws(() => logLossOne(0.5, 0.5));
});

test("brierSkill is 0 for a pure coin-flipper and positive for a perfect oracle", () => {
  const flip = [
    { p: 0.5, outcome: 1 },
    { p: 0.5, outcome: 0 },
  ];
  assert.equal(brierSkill(flip), 0);

  const oracle = [
    { p: 0.999, outcome: 1 },
    { p: 0.001, outcome: 0 },
  ];
  assert.ok(brierSkill(oracle) > 0.99);
});

test("brierSkill goes negative when an agent is confidently wrong (worse than guessing)", () => {
  const wrong = [
    { p: 0.9, outcome: 0 },
    { p: 0.1, outcome: 1 },
  ];
  assert.ok(brierSkill(wrong) < 0);
});

test("calibration bins recover a known hit rate", () => {
  // 10 forecasts all stated at 0.7; 7 of them happen. Bin [0.7,0.8) should show
  // meanP 0.7 and hitRate 0.7 — perfectly calibrated.
  const fs = [];
  for (let i = 0; i < 10; i++) fs.push({ p: 0.7, outcome: i < 7 ? 1 : 0 });
  const bins = calibrationBins(fs);
  const bin = bins.find((b) => b.lo === 0.7);
  assert.equal(bin.n, 10);
  assert.ok(Math.abs(bin.meanP - 0.7) < 1e-9);
  assert.ok(Math.abs(bin.hitRate - 0.7) < 1e-9);
  assert.ok(expectedCalibrationError(fs) < 1e-9); // perfectly calibrated => ECE ~0
});

test("ECE rises for a miscalibrated (overconfident) agent", () => {
  // States 0.95 every time but is only right half the time.
  const fs = [];
  for (let i = 0; i < 10; i++) fs.push({ p: 0.95, outcome: i < 5 ? 1 : 0 });
  assert.ok(expectedCalibrationError(fs) > 0.4);
});

test("empty inputs return null, not NaN", () => {
  assert.equal(brier([]), null);
  assert.equal(brierSkill([]), null);
  assert.equal(expectedCalibrationError([]), null);
});
