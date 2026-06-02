// The arena wiring: price history -> claims -> forecasts -> resolution ->
// scoring + duel ELO. This is the offline backtest form of the exact loop the
// live arena runs (live just swaps synthSeries for a real feed and waits 24h
// between open and resolve instead of walking history).

import { tokenUp24h } from "./claims.js";
import { FORECASTERS, contextFromPrices } from "./forecasters.js";
import { brier, logLoss, brierSkill, expectedCalibrationError } from "./score.js";
import { roundRobin, DEFAULT_ELO } from "./duel.js";

// Walk a price series. At each step, every forecaster sees the trailing
// `window` prices and forecasts "up over the next `horizon` steps". We resolve
// against the actual future price, score it, and run a duel round robin.
//
// Returns a leaderboard plus the raw per-forecast records (for cards/persistence).
export function runBacktest(prices, { token = "TOKEN", window = 24, horizon = 24 } = {}) {
  const byForecaster = new Map(FORECASTERS.map((f) => [f.id, []]));
  let ratings = Object.fromEntries(FORECASTERS.map((f) => [f.id, DEFAULT_ELO]));
  let duelCount = 0;

  for (let t = window; t + horizon < prices.length; t += horizon) {
    const openPrice = prices[t];
    const closePrice = prices[t + horizon];
    const claim = tokenUp24h({ token, openTs: t, openPrice });
    const outcome = claim.resolve(closePrice);

    const ctx = contextFromPrices(prices.slice(t - window, t + 1));
    const forecasts = FORECASTERS.map((f) => ({
      forecasterId: f.id,
      p: f.predict(ctx),
      outcome,
    }));

    for (const fc of forecasts) byForecaster.get(fc.forecasterId).push({ p: fc.p, outcome });

    const rr = roundRobin(claim, forecasts, ratings);
    ratings = rr.ratings;
    duelCount += rr.duels.length;
  }

  const leaderboard = FORECASTERS.map((f) => {
    const fs = byForecaster.get(f.id);
    return {
      id: f.id,
      name: f.name,
      thesis: f.thesis,
      n: fs.length,
      brier: round(brier(fs)),
      logLoss: round(logLoss(fs)),
      brierSkill: round(brierSkill(fs)),
      ece: round(expectedCalibrationError(fs)),
      elo: Math.round(ratings[f.id]),
    };
  }).sort((a, b) => b.elo - a.elo);

  return { leaderboard, claims: countClaims(prices, window, horizon), duels: duelCount };
}

function countClaims(prices, window, horizon) {
  let c = 0;
  for (let t = window; t + horizon < prices.length; t += horizon) c++;
  return c;
}

function round(x, d = 4) {
  if (x == null) return null;
  const m = 10 ** d;
  return Math.round(x * m) / m;
}
