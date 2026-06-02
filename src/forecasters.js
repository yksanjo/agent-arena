// Forecasters. Each one looks at recent price history and outputs p(YES) for a
// claim. These are deliberately DIFFERENTIATED by construction — momentum vs
// mean-reversion, plus calibration archetypes (overconfident, humble) — so the
// arena's first experiment actually has signal to find. If even hand-designed
// opposites can't be told apart by the calibration board, the board is broken;
// if they can, the board works and we point it at the real SOAG grid agents.
//
// Names borrow the SOAG cast so the arena reads as "the grid, scored". Swapping
// in the live grid characters later means replacing the `predict` body with a
// call into soag-grid's strategy; the arena scoring core does not change.
//
// A forecaster sees `ctx = { returns: number[] }` where returns are the most
// recent fractional period-over-period returns (oldest..newest), and returns
// a probability in (0,1).

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// Pull p toward 0.5 by a factor in [0,1]. 1 = unchanged, 0 = always 0.5.
const shrink = (p, factor) => 0.5 + (p - 0.5) * factor;

export const FORECASTERS = [
  {
    id: "coinflip",
    name: "ZERO",
    thesis: "no information — the 0.25-Brier baseline everyone must beat",
    predict: () => 0.5,
  },
  {
    id: "momentum",
    name: "NEXUS",
    thesis: "recent strength continues",
    predict: (ctx) => clip(sigmoid(8 * mean(ctx.returns))),
  },
  {
    id: "meanrev",
    name: "ECHO",
    thesis: "recent moves snap back",
    predict: (ctx) => clip(sigmoid(-8 * mean(ctx.returns))),
  },
  {
    id: "trend",
    name: "ATLAS",
    thesis: "slow trend via short vs long average",
    predict: (ctx) => {
      const r = ctx.returns;
      if (r.length < 4) return 0.5;
      const recent = mean(r.slice(-3));
      const base = mean(r);
      return clip(sigmoid(10 * (recent - base) + 6 * base));
    },
  },
  {
    id: "overconfident",
    name: "YUI",
    thesis: "right idea (momentum) but pushes probabilities to the extremes",
    predict: (ctx) => {
      const p = sigmoid(8 * mean(ctx.returns));
      // Stretch away from 0.5 — should tank on log-loss when wrong.
      return clip(shrink(p, 2.5));
    },
  },
  {
    id: "humble",
    name: "KIRA",
    thesis: "same read as momentum but stays near 0.5 — well-calibrated, low resolution",
    predict: (ctx) => {
      const p = sigmoid(8 * mean(ctx.returns));
      return clip(shrink(p, 0.4));
    },
  },
];

function clip(p) {
  return Math.min(0.999, Math.max(0.001, p));
}

// Build the context a forecaster needs from a price series (oldest..newest).
export function contextFromPrices(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return { returns };
}
