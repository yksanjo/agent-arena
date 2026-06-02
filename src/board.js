// Build one arena board across many real tokens. Pools every agent's forecasts
// for calibration scoring and runs a single shared ELO ladder over all claims
// in time order (so beating a sharp agent on a hard day is worth more).
//
// Pure given the series + the forecaster set. `series` is
//   [{ token, candles: [{ ts, close }] (oldest..newest) }]
// Returns a board object ready to render or persist.

import { tokenUp24h } from "./claims.js";
import { FORECASTERS, contextFromPrices } from "./forecasters.js";
import { brier, logLoss, brierSkill, expectedCalibrationError, calibrationBins } from "./score.js";
import { roundRobin, DEFAULT_ELO } from "./duel.js";

export function buildBoard(series, { window = 24, horizon = 24, step = 8, forecasters = FORECASTERS } = {}) {
  // 1. Build every resolvable claim across every token.
  const claims = [];
  for (const { token, candles } of series) {
    for (let i = window; i + horizon < candles.length; i += step) {
      const open = candles[i];
      const close = candles[i + horizon];
      const claim = tokenUp24h({ token, openTs: open.ts, openPrice: open.close });
      const outcome = claim.resolve(close.close);
      const ctx = contextFromPrices(candles.slice(i - window, i + 1).map((c) => c.close));
      const forecasts = forecasters.map((f) => ({ forecasterId: f.id, p: f.predict(ctx), outcome }));
      claims.push({
        id: claim.id,
        token,
        openTs: open.ts,
        resolveTs: open.ts + horizon * 3600 * 1000,
        openPrice: open.close,
        closePrice: close.close,
        outcome,
        forecasts,
      });
    }
  }

  // 2. Resolve in time order: pool per-agent forecasts + run the ELO ladder.
  claims.sort((a, b) => a.openTs - b.openTs);
  const pools = new Map(forecasters.map((f) => [f.id, []]));
  const record = new Map(forecasters.map((f) => [f.id, { w: 0, l: 0, d: 0 }]));
  let ratings = Object.fromEntries(forecasters.map((f) => [f.id, DEFAULT_ELO]));

  for (const c of claims) {
    for (const fc of c.forecasts) pools.get(fc.forecasterId).push({ p: fc.p, outcome: c.outcome });
    const rr = roundRobin({ id: c.id }, c.forecasts, ratings);
    ratings = rr.ratings;
    for (const d of rr.duels) {
      if (d.draw) {
        record.get(d.a).d++;
        record.get(d.b).d++;
      } else {
        record.get(d.winner).w++;
        record.get(d.loser).l++;
      }
    }
  }

  // 3. Leaderboard, ranked by ELO.
  const meta = new Map(forecasters.map((f) => [f.id, f]));
  const leaderboard = forecasters
    .map((f) => {
      const fs = pools.get(f.id);
      return {
        id: f.id,
        name: meta.get(f.id).name,
        thesis: meta.get(f.id).thesis,
        n: fs.length,
        elo: Math.round(ratings[f.id]),
        brier: round(brier(fs)),
        logLoss: round(logLoss(fs)),
        skill: round(brierSkill(fs)),
        ece: round(expectedCalibrationError(fs)),
        record: record.get(f.id),
        calibration: calibrationBins(fs).map((b) => ({
          mid: round((b.lo + b.hi) / 2, 2),
          n: b.n,
          hitRate: b.hitRate == null ? null : round(b.hitRate),
        })),
      };
    })
    .sort((a, b) => b.elo - a.elo);

  // 4. Recent resolved claims for the verifiable log (newest first).
  const claimsLog = claims
    .slice()
    .sort((a, b) => b.openTs - a.openTs)
    .slice(0, 24)
    .map((c) => ({
      token: c.token,
      openTs: c.openTs,
      resolveTs: c.resolveTs,
      pct: round(((c.closePrice - c.openPrice) / c.openPrice) * 100, 2),
      outcome: c.outcome,
      calls: Object.fromEntries(c.forecasts.map((f) => [f.forecasterId, round(f.p, 2)])),
    }));

  const spread = leaderboard.length
    ? round(Math.max(...leaderboard.map((r) => r.brier)) - Math.min(...leaderboard.map((r) => r.brier)))
    : 0;

  return {
    tokens: series.map((s) => s.token),
    params: { window, horizon, step },
    totalClaims: claims.length,
    brierSpread: spread,
    leaderboard,
    claimsLog,
  };
}

function round(x, d = 4) {
  if (x == null) return null;
  const m = 10 ** d;
  return Math.round(x * m) / m;
}
