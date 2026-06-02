// Price feeds. Two sources behind one interface:
//   - live:  free GeckoTerminal OHLCV (no key), for the real arena.
//   - synth: a seeded random-walk generator, for offline experiments + tests
//            (deterministic — same seed always yields the same path).
//
// The synth path is NOT a mock of the scoring logic; it is real price-shaped
// data the real forecasters and the real scorer chew on. It just lets the
// kill-or-continue experiment run with no network and lets tests be repeatable.

// Mulberry32 — tiny deterministic PRNG so experiments reproduce exactly.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geometric random walk with optional momentum AND a slow drift regime, so the
// forecaster theses have something real to be right or wrong about.
//
//   regimeVol = 0  -> a near-pure random walk. 24-step direction is unpredictable
//                     and EVERY forecaster collapses to ~0.25 Brier. This is the
//                     honest "no edge exists" world.
//   regimeVol > 0  -> a slow mean-reverting drift persists across ~dozens of
//                     steps, so trailing returns genuinely predict the next
//                     window's direction. Trend/momentum agents earn real skill;
//                     mean-reversion goes negative. This is the "edge exists" world
//                     the board must be able to detect.
//
// Returns an array of prices, length `steps + 1`.
export function synthSeries({
  seed = 1,
  start = 100,
  steps = 500,
  vol = 0.03,
  momentum = 0,
  regimeVol = 0,
  regimePersist = 0.97, // how slowly the drift regime decays toward 0
} = {}) {
  const r = rng(seed);
  const prices = [start];
  let lastRet = 0;
  let mu = 0; // the slow drift regime
  for (let i = 0; i < steps; i++) {
    mu = regimePersist * mu + regimeVol * gauss(r);
    const ret = mu + momentum * lastRet + vol * gauss(r);
    lastRet = ret;
    prices.push(prices[prices.length - 1] * Math.exp(ret));
  }
  return prices;
}

// Box-Muller standard normal.
function gauss(r) {
  const u1 = Math.max(1e-12, r());
  const u2 = r();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Live source: free Coinbase Exchange hourly candles (no key, not geoblocked
// where Binance is). Returns [{ ts, close }] oldest..newest. Paginates backward
// in 300-candle batches (Coinbase's per-request cap) to get real history.
//
// Anyone can reproduce these numbers from the same public endpoint, which is
// the point: the board is verifiable.
export async function coinbaseCandles({ product, hours = 720 }) {
  const GRAN = 3600;
  const batches = Math.ceil(hours / 300);
  let end = Math.floor(nowSec());
  const rows = [];
  for (let b = 0; b < batches; b++) {
    const start = end - 300 * GRAN;
    const url =
      `https://api.exchange.coinbase.com/products/${product}/candles` +
      `?granularity=${GRAN}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const res = await fetch(url, { headers: { "User-Agent": "agent-arena" } });
    if (!res.ok) throw new Error(`coinbase ${product} ${res.status}`);
    const batch = await res.json();
    // Coinbase rows: [time, low, high, open, close, volume], newest first.
    for (const r of batch) rows.push({ ts: Number(r[0]) * 1000, close: Number(r[4]) });
    end = start;
    await sleep(250); // be polite to the public endpoint
  }
  // Dedupe by ts and sort ascending.
  const seen = new Map();
  for (const r of rows) seen.set(r.ts, r);
  return [...seen.values()].sort((a, b) => a.ts - b.ts);
}

// Wall-clock seconds. Isolated so the rest of the module stays pure/testable.
function nowSec() {
  return Date.now() / 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
