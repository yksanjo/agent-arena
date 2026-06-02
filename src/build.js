// Build the shareable page from REAL data: pull hourly history for a basket of
// tokens, run the arena, write dist/index.html + data/board.json.
//
//   node src/build.js            # default basket, ~30 days
//   node src/build.js BTC,SOL    # custom basket
//
// Backfilling from history is deliberate: it means the board is full and
// verifiable the moment you share it, instead of an empty page that takes 24h
// to resolve its first claim.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { coinbaseCandles } from "./feed.js";
import { buildBoard } from "./board.js";
import { renderPage } from "./render.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_BASKET = ["BTC", "ETH", "SOL", "BONK", "WIF", "DOGE"];
const basket = (process.argv[2]?.split(",").map((s) => s.trim().toUpperCase())) || DEFAULT_BASKET;
const HOURS = Number(process.env.HOURS ?? 720);

console.log(`Fetching ${HOURS}h of hourly candles for ${basket.join(", ")} from Coinbase...`);

const series = [];
for (const token of basket) {
  try {
    const candles = await coinbaseCandles({ product: `${token}-USD`, hours: HOURS });
    if (candles.length < 60) {
      console.log(`  ${token}: only ${candles.length} candles, skipping`);
      continue;
    }
    series.push({ token, candles });
    console.log(`  ${token}: ${candles.length} candles`);
  } catch (e) {
    console.log(`  ${token}: ${e.message}`);
  }
}

if (!series.length) {
  console.error("No data fetched. Aborting.");
  process.exit(1);
}

const board = buildBoard(series, { window: 24, horizon: 24, step: 8 });
const generatedAt = Date.now();

mkdirSync(join(ROOT, "dist"), { recursive: true });
mkdirSync(join(ROOT, "data"), { recursive: true });
writeFileSync(join(ROOT, "data", "board.json"), JSON.stringify({ generatedAt, ...board }, null, 2));
writeFileSync(join(ROOT, "dist", "index.html"), renderPage(board, { generatedAt }));
writeFileSync(join(ROOT, "dist", "CNAME"), "arena.agentsoag.com\n"); // keep custom domain across rebuilds

console.log(`\nBoard: ${board.totalClaims} claims · Brier spread ${board.brierSpread}`);
board.leaderboard.forEach((r, i) =>
  console.log(`  ${i + 1}. ${r.name.padEnd(8)} elo ${r.elo}  brier ${r.brier}  skill ${r.skill >= 0 ? "+" : ""}${r.skill}`),
);
console.log(`\nWrote dist/index.html and data/board.json`);
