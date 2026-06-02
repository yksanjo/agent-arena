import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeDuel, applyElo, roundRobin, DEFAULT_ELO } from "../src/duel.js";

const claim = { id: "c1" };

test("the better forecast wins the duel", () => {
  const a = { forecasterId: "a", p: 0.9, outcome: 1 }; // sharp + right
  const b = { forecasterId: "b", p: 0.4, outcome: 1 }; // wrong-ish
  const r = judgeDuel(claim, a, b);
  assert.equal(r.draw, false);
  assert.equal(r.winner, "a");
  assert.equal(r.loser, "b");
});

test("identical forecasts draw", () => {
  const a = { forecasterId: "a", p: 0.7, outcome: 1 };
  const b = { forecasterId: "b", p: 0.7, outcome: 1 };
  assert.equal(judgeDuel(claim, a, b).draw, true);
});

test("duel requires both forecasts to share the resolved outcome", () => {
  const a = { forecasterId: "a", p: 0.7, outcome: 1 };
  const b = { forecasterId: "b", p: 0.7, outcome: 0 };
  assert.throws(() => judgeDuel(claim, a, b));
});

test("winning raises your ELO and lowers the loser's, conserving total", () => {
  const before = { a: DEFAULT_ELO, b: DEFAULT_ELO };
  const result = { winner: "a", loser: "b", draw: false };
  const after = applyElo(before, result, "a", "b");
  assert.ok(after.a > before.a);
  assert.ok(after.b < before.b);
  assert.ok(Math.abs(after.a + after.b - (before.a + before.b)) < 1e-9); // zero-sum
});

test("beating a higher-rated opponent earns more than beating a peer", () => {
  const vsPeer = applyElo({ a: 1000, b: 1000 }, { winner: "a", draw: false }, "a", "b");
  const vsStrong = applyElo({ a: 1000, b: 1400 }, { winner: "a", draw: false }, "a", "b");
  const gainPeer = vsPeer.a - 1000;
  const gainStrong = vsStrong.a - 1000;
  assert.ok(gainStrong > gainPeer);
});

test("a consistently sharper agent climbs the round-robin board", () => {
  // Three agents on one claim: sharp, ok, terrible. Sharp should end on top.
  const forecasts = [
    { forecasterId: "sharp", p: 0.95, outcome: 1 },
    { forecasterId: "ok", p: 0.6, outcome: 1 },
    { forecasterId: "bad", p: 0.05, outcome: 1 },
  ];
  let ratings = {};
  for (let i = 0; i < 20; i++) ratings = roundRobin(claim, forecasts, ratings).ratings;
  assert.ok(ratings.sharp > ratings.ok);
  assert.ok(ratings.ok > ratings.bad);
});

test("round robin runs every unique pair once", () => {
  const forecasts = [
    { forecasterId: "a", p: 0.6, outcome: 1 },
    { forecasterId: "b", p: 0.5, outcome: 1 },
    { forecasterId: "c", p: 0.4, outcome: 1 },
    { forecasterId: "d", p: 0.3, outcome: 1 },
  ];
  const { duels } = roundRobin(claim, forecasts);
  assert.equal(duels.length, 6); // 4 choose 2
});
