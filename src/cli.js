// The kill-or-continue experiment from the design doc, runnable today with zero
// network. It runs the SAME six forecasters over two synthetic worlds:
//
//   1. NO EDGE  — a pure random walk. 24-step direction is unpredictable.
//   2. EDGE     — a slow trend regime that trailing returns can actually detect.
//
// The point is NOT "who made money". It is: does the calibration board stay flat
// when there is nothing to find, and does it cleanly separate skill when there
// is? If yes, the harness works and we point it at the live SOAG grid agents.
//
//   node src/cli.js [seed]

import { synthSeries } from "./feed.js";
import { runBacktest } from "./arena.js";

const seed = Number(process.argv[2] ?? 7);

printScenario("NO EDGE  (pure random walk — the honest -EV world)", {
  seed,
  steps: 6000,
  vol: 0.025,
  momentum: 0.1,
  regimeVol: 0,
});

printScenario("EDGE EXISTS  (a slow trend regime the agents can detect)", {
  seed,
  steps: 6000,
  vol: 0.025,
  momentum: 0.1,
  regimeVol: 0.003,
});

function printScenario(title, params) {
  const prices = synthSeries(params);
  const { leaderboard, claims, duels } = runBacktest(prices, { token: "SYNTH", window: 24, horizon: 24 });
  const b = leaderboard.map((r) => r.brier);
  const spread = (Math.max(...b) - Math.min(...b)).toFixed(4);

  console.log(`\n${title}`);
  console.log(`${claims} claims · ${duels} duels · Brier spread ${spread}\n`);
  console.log("rank  agent        elo    brier   skill    logloss  ece     thesis");
  console.log("----  -----------  -----  ------  -------  -------  ------  ----------------------------------");
  leaderboard.forEach((r, i) => {
    console.log(
      `${String(i + 1).padEnd(4)}  ${r.name.padEnd(11)}  ${String(r.elo).padEnd(5)}  ` +
        `${fmt(r.brier)}  ${fmt(r.brierSkill, true)}  ${fmt(r.logLoss)}  ${fmt(r.ece)}  ${r.thesis}`,
    );
  });
  console.log("\nbaseline: Brier 0.25 / skill 0.000 = no edge. Positive skill beats a coin flip.\n");
}

function fmt(x, signed = false) {
  if (x == null) return "  -   ";
  const s = (signed && x >= 0 ? "+" : "") + x.toFixed(3);
  return s.padStart(6);
}
