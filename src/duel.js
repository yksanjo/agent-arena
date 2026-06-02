// The duel mechanic. This is the framing Yoshi picked: two agents go head to
// head on the SAME claim, and whoever forecasts it better wins the duel.
//
// "Better" = lower Brier on that single claim. The loser transfers ELO to the
// winner. Over many claims, ELO surfaces who is genuinely sharper, independent
// of how easy or hard any individual claim was (both agents faced the same one).
//
// This is the betting-free core. Staked $SOAG duels (Approach B) settle on the
// exact same win/loss decision; only the escrow layer is added on top.

import { brierOne } from "./score.js";

export const DEFAULT_ELO = 1000;
const K = 24; // rating volatility per duel

function expectedScore(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

// Decide one duel. Returns { winner, loser, draw, brierA, brierB }.
// A draw happens only when both agents posted the identical probability.
export function judgeDuel(claim, fA, fB) {
  if (fA.outcome !== fB.outcome) {
    throw new Error("both forecasts must resolve against the same outcome");
  }
  const brierA = brierOne(fA.p, fA.outcome);
  const brierB = brierOne(fB.p, fB.outcome);
  if (brierA === brierB) return { draw: true, brierA, brierB };
  // Lower Brier wins.
  return brierA < brierB
    ? { winner: fA.forecasterId, loser: fB.forecasterId, draw: false, brierA, brierB }
    : { winner: fB.forecasterId, loser: fA.forecasterId, draw: false, brierA, brierB };
}

// Apply one duel result to a ratings map (mutates a copy, returns it).
export function applyElo(ratings, result, idA, idB) {
  const out = { ...ratings };
  const ra = out[idA] ?? DEFAULT_ELO;
  const rb = out[idB] ?? DEFAULT_ELO;
  const ea = expectedScore(ra, rb);
  const eb = 1 - ea;
  let sa;
  if (result.draw) sa = 0.5;
  else sa = result.winner === idA ? 1 : 0;
  const sb = 1 - sa;
  out[idA] = ra + K * (sa - ea);
  out[idB] = rb + K * (sb - eb);
  return out;
}

// Run a full round robin for one resolved claim: every pair of forecasts on
// that claim duels once, and ELO accumulates. Returns updated ratings + the
// per-duel log (useful for shareable "Agent A beat Agent B" cards).
export function roundRobin(claim, forecasts, ratings = {}) {
  let out = { ...ratings };
  const duels = [];
  for (let i = 0; i < forecasts.length; i++) {
    for (let j = i + 1; j < forecasts.length; j++) {
      const fA = forecasts[i];
      const fB = forecasts[j];
      const result = judgeDuel(claim, fA, fB);
      out = applyElo(out, result, fA.forecasterId, fB.forecasterId);
      duels.push({ claimId: claim.id, ...result, a: fA.forecasterId, b: fB.forecasterId });
    }
  }
  return { ratings: out, duels };
}
