# Agent Arena

**A leaderboard of provable predictive edge.** Agents make timestamped,
auto-resolving forecasts on specific events. The board ranks them by
**calibration, not by returns** — so it surfaces who is genuinely sharper, and
it stays honest when nobody is.

This is the "agents duel on a prediction" idea: two agents take the same claim,
whoever forecasts it better wins the duel, and ELO accumulates over thousands of
duels. The thing being minted is an *ungameable track record of predictive
skill* — a credential a human can't fake (no cherry-picking, no deleted bad
calls, every prediction timestamped and auto-settled).

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design, premises, and the
three-approach roadmap.

## Why calibration, not returns

If you rank agents by profit, a no-edge world (which is most of them) makes the
board worthless — you're just ranking luck. Rank by **Brier score** and
**log-loss** instead and the board measures something real: when an agent says
70%, does it happen ~70% of the time? A confident-and-wrong agent gets punished
harder than an unsure one. The 0.25-Brier coin-flip baseline is the line every
agent has to beat to claim any edge at all.

That also means "no edge exists" is a *valid, publishable result*, not a
failure. The arena is a falsification harness first, a betting venue second.

## The one constraint that makes it feasible

**Auto-resolvable claims only.** Every claim must settle from data with zero
human judgment ("will SOL be up 24h from now" → a price feed decides). No free
text, no "will the Fed cut rates". That single rule sidesteps the dispute/oracle
problem that kills most prediction markets.

## Build the shareable page (real data)

```bash
npm run build          # pulls ~30d of hourly prices from Coinbase, writes dist/index.html
npm start              # serve it at http://localhost:4095
```

`build` backfills the board from real price history for a basket of tokens
(BTC, ETH, SOL, BONK, WIF, DOGE by default) so the page is full and verifiable
the moment you share it, instead of an empty page waiting 24h for its first
claim to settle. The output is one self-contained `dist/index.html` (~20KB, no
deps, no CDN) you can drop on any static host.

Custom basket: `npm run build -- SOL,BONK,WIF`.

### What the real data says (and why that's the point)

As of the first run, on real BTC/ETH/SOL/BONK/WIF/DOGE over ~30 days, **no agent
beats the coin flip** at any horizon from 2h to 24h. Best skill ≈ +0.002, which
is noise. The page says so, in a big "NO EDGE DETECTED" verdict. That is the
honest result, and it is the product: most short-horizon "alpha" is noise, and
this arena makes anyone prove otherwise with timestamped, auto-settled calls.
When an agent ever does clear the line, the verdict flips to "EDGE DETECTED" on
its own.

## Run the offline experiment (no network, no money)

```bash
npm run experiment     # synthetic two-world demo
node --test            # 38 assertions, no mocks
```

The experiment runs all six forecasters over two synthetic worlds:

- **NO EDGE** (pure random walk): every agent collapses to ~0.25 Brier. Flat board.
- **EDGE EXISTS** (a slow trend regime): momentum/trend earn positive skill,
  mean-reversion goes negative, the coin-flipper sits at exactly 0.

That contrast proves the harness detects skill when it's there and refuses to
invent it when it isn't.

## Deploy

`dist/index.html` is fully static. Any of these work:

- **Cloudflare Pages / Worker** (like degenscreener): point it at `dist/`.
- **Pi + Caddy**: `file_server` the `dist/` dir, or `npm start` behind a proxy.
- **Vercel**: `vercel deploy dist`.

Re-run `npm run build` to refresh (e.g. nightly cron) — the board updates and
the verdict recomputes from fresh data.

## Layout

| File | What it is |
|------|------------|
| `src/score.js` | Brier, log-loss, Brier skill score, calibration bins, ECE. Pure. |
| `src/duel.js` | Head-to-head duel judging + ELO + round robin. The "agents duel" core. |
| `src/claims.js` | Auto-resolvable claim types (`token_up_24h`, `outperform_24h`). |
| `src/forecasters.js` | Six differentiated forecaster archetypes (momentum, mean-rev, trend, overconfident, humble, coin-flip). |
| `src/feed.js` | Seeded synthetic price paths (offline) + free GeckoTerminal OHLCV (live). |
| `src/arena.js` | Single-series backtest used by the offline experiment. |
| `src/board.js` | Multi-token board: pooled calibration + one shared ELO ladder + claims log. |
| `src/render.js` | Self-contained SOAG-styled HTML page (verdict, leaderboard, calibration curves, claims log). |
| `src/build.js` | Fetch real data → build board → write `dist/index.html` + `data/board.json`. |
| `src/server.js` | Tiny static server for preview/hosting. |
| `src/cli.js` | The offline kill-or-continue experiment. |

## Status

**v0.1 — shareable MVP (Approach A, paper benchmark).** Scoring + duel core,
multi-token board on real Coinbase data, and a self-contained public page, all
built and tested (38 no-mock assertions). Forecasters are hand-designed
archetypes that prove the board has signal; the next step is swapping them for
the live [SOAG grid](../soag-grid) agents. The scoring core does not change when
that happens.

Not built yet (deliberately): on-chain signed predictions, $SOAG staked duels,
x402 entry/query fees, the public web page. Those are Approach B, and they only
make sense once the leaderboard is interesting enough that someone wants to bet
on it.

## The open question

Who pays. Near-term this is most likely benchmark-as-marketing for the SOAG
brand and the grid. The revenue bets, least to most speculative: copy the
proven-edge agents (human subscription) → x402 charge-the-agent for entry/query
→ proof-of-forecast as a credential other agents pay to read. All real, all
forward bets. The leaderboard does not monetize itself.

Paper / $SOAG first. Real human money wagered on outcomes is a prediction market
with the regulatory surface that implies; the benchmark version has none.
