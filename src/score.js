// Scoring core for the arena. This is the heart of the product and it is the
// same regardless of whether forecasts are paper or staked on-chain.
//
// Design premise (see docs/DESIGN.md): rank agents by CALIBRATION, not by
// returns. A confident-and-wrong agent must be punished harder than an
// unsure-and-wrong one. Brier and log-loss both do this; we report both.
//
// All functions are pure. A "forecast" is { p, outcome } where p is the
// agent's stated probability of YES in [0,1] and outcome is 0 or 1.

const EPS = 1e-9;

export function clampP(p) {
  if (!Number.isFinite(p)) throw new Error(`forecast p must be finite, got ${p}`);
  if (p < 0 || p > 1) throw new Error(`forecast p must be in [0,1], got ${p}`);
  // Clamp strictly inside (0,1) so log-loss never blows up to Infinity.
  return Math.min(1 - EPS, Math.max(EPS, p));
}

// Brier score for a single forecast: (p - outcome)^2. Lower is better.
// Range [0,1]. Always-0.5 ("I have no idea") scores exactly 0.25, which is the
// no-skill baseline every agent must beat to claim any edge.
export function brierOne(p, outcome) {
  assertOutcome(outcome);
  const cp = clampP(p);
  return (cp - outcome) ** 2;
}

// Log loss (cross-entropy) for a single forecast. Lower is better. Punishes
// confident wrong calls much harder than Brier does (unbounded above).
export function logLossOne(p, outcome) {
  assertOutcome(outcome);
  const cp = clampP(p);
  return -(outcome * Math.log(cp) + (1 - outcome) * Math.log(1 - cp));
}

// Aggregate Brier over many forecasts.
export function brier(forecasts) {
  if (forecasts.length === 0) return null;
  let sum = 0;
  for (const f of forecasts) sum += brierOne(f.p, f.outcome);
  return sum / forecasts.length;
}

export function logLoss(forecasts) {
  if (forecasts.length === 0) return null;
  let sum = 0;
  for (const f of forecasts) sum += logLossOne(f.p, f.outcome);
  return sum / forecasts.length;
}

// Brier skill score vs the 0.25 no-skill baseline. >0 means real skill,
// =0 means no better than a coin flip, <0 means actively worse than guessing.
// This is the single number that answers "does this agent have edge".
export function brierSkill(forecasts) {
  const b = brier(forecasts);
  if (b == null) return null;
  return 1 - b / 0.25;
}

// Reliability diagram data: bucket forecasts by stated probability, then report
// the actual hit rate in each bucket. A well-calibrated agent's points sit on
// the diagonal (when it says 70%, things happen ~70% of the time).
export function calibrationBins(forecasts, nBins = 10) {
  const bins = Array.from({ length: nBins }, (_, i) => ({
    lo: i / nBins,
    hi: (i + 1) / nBins,
    n: 0,
    sumP: 0,
    sumOutcome: 0,
  }));
  for (const f of forecasts) {
    const cp = clampP(f.p);
    let idx = Math.floor(cp * nBins);
    if (idx >= nBins) idx = nBins - 1; // p === 1 lands in the last bin
    const b = bins[idx];
    b.n += 1;
    b.sumP += cp;
    b.sumOutcome += f.outcome;
  }
  return bins.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    n: b.n,
    meanP: b.n ? b.sumP / b.n : null,
    hitRate: b.n ? b.sumOutcome / b.n : null,
  }));
}

// Expected Calibration Error: average gap between stated probability and actual
// hit rate, weighted by how many forecasts fall in each bucket. 0 = perfect.
export function expectedCalibrationError(forecasts, nBins = 10) {
  if (forecasts.length === 0) return null;
  const bins = calibrationBins(forecasts, nBins);
  let ece = 0;
  for (const b of bins) {
    if (!b.n) continue;
    ece += (b.n / forecasts.length) * Math.abs(b.meanP - b.hitRate);
  }
  return ece;
}

function assertOutcome(o) {
  if (o !== 0 && o !== 1) throw new Error(`outcome must be 0 or 1, got ${o}`);
}
