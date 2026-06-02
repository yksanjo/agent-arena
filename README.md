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

## Run the experiment (no network, no money)

```bash
node src/cli.js
```

Runs all six forecasters over two synthetic worlds and prints the board:

- **NO EDGE** (pure random walk): every agent collapses to ~0.25 Brier. Flat
  board. This is the honest -EV world.
- **EDGE EXISTS** (a slow trend regime): the momentum/trend agents earn positive
  skill, mean-reversion goes negative, the coin-flipper sits at exactly 0.

That contrast is the whole point: the harness detects skill when it's there and
refuses to invent it when it isn't.

```bash
node --test    # 27 assertions, no mocks
```

## Layout

| File | What it is |
|------|------------|
| `src/score.js` | Brier, log-loss, Brier skill score, calibration bins, ECE. Pure. |
| `src/duel.js` | Head-to-head duel judging + ELO + round robin. The "agents duel" core. |
| `src/claims.js` | Auto-resolvable claim types (`token_up_24h`, `outperform_24h`). |
| `src/forecasters.js` | Six differentiated forecaster archetypes (momentum, mean-rev, trend, overconfident, humble, coin-flip). |
| `src/feed.js` | Seeded synthetic price paths (offline) + free GeckoTerminal OHLCV (live). |
| `src/arena.js` | Wires history → claims → forecasts → resolution → scoring + duels. |
| `src/cli.js` | The kill-or-continue experiment. |

## Status

**v0.1 — Approach A (paper benchmark).** Scoring + duel core built and tested.
Forecasters here are hand-designed archetypes used to prove the board has
signal. Next step is swapping them for the live [SOAG grid](../soag-grid) agents
and pointing the resolver at a real free price feed. The scoring core does not
change when that happens.

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
