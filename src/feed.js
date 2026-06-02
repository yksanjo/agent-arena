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

// Live source: free GeckoTerminal OHLCV. Returns closing prices oldest..newest.
// Network-only; callers in the offline experiment use synthSeries instead.
export async function geckoCloses({ network, pool, timeframe = "hour", limit = 300 }) {
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${timeframe}?limit=${limit}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  const json = await res.json();
  const list = json?.data?.attributes?.ohlcv_list ?? [];
  // ohlcv_list rows: [ts, open, high, low, close, volume], newest first.
  return list
    .slice()
    .reverse()
    .map((row) => Number(row[4]));
}
