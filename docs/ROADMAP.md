# Agent Battle Arena — Roadmap

A capital-efficient, risk-staged plan. Each phase is funded by the proof from the
phase before it: validate for free → spend on safety once demand is proven →
spend on legal once it's profitable. No big spend before the evidence justifies it.

---

## Phase 1 — Research / Validate  (NOW · $0 · no mainnet)

**Goal:** prove people actually want to play and that the economics work, before
spending a dollar.

- Game runs **off-chain** on existing infra (Pi / GitHub Pages) — $0 hosting.
- Real Pyth prices, the real 15s round loop, dead-band, 1.7× edge — same logic
  already tested on devnet.
- **Money: play-money / paper** (recommended) so there is **zero custody and zero
  risk** during research. (If any real $SOAG is used, keep it tiny + manual +
  clearly labeled a custodial beta — see docs/THREATS.md on the risks.)
- Measure: do players come back? what's the volume? does the house edge actually
  net positive at real volume? **This data is what tells us it can make profit.**

**Exit when:** demonstrated demand + the house edge nets a real, repeatable profit
at observed volume. Only then do we spend on Phase 2.

---

## Phase 2 — Go real / Verify  (once Phase 1 proves it can profit)

**Goal:** put real money on it, safely.

- Deploy the **non-custodial vault** (already built + 19/19 tested + Pyth-verified
  on devnet) to **mainnet** (~$450–900 in SOL — mostly a recoverable deposit).
- **Pay for verification / audit** (~$3k–10k for an independent review minimum)
  — funded by early profit / a small reserve, not upfront capital.
- Real $SOAG, **small caps**, separate small house wallet (bounded downside).

**Trigger:** only when Phase 1 data proves the thing makes money, so the spend is
justified by evidence, not hope.

---

## Phase 3 — Legal / Stay in business  (once profitable)

**Goal:** operate sustainably and legally for the long term.

- Reinvest profits into **legal**: licensing / geofencing / compliance / entity
  structure for running a money game.
- This is what lets it survive past "fun experiment" into a real business.

**Trigger:** real, recurring revenue exists to fund it.

---

## Why this order is right

- A money game's two big costs are **audit** and **legal**. Spending either before
  you know people will play is how you go broke proving nothing.
- Phase 1 is free and answers the only question that matters first: **does anyone
  want this, and does the edge actually print?**
- Safety (Phase 2) and compliance (Phase 3) are bought with the profit they
  protect — not with money you don't have.

## What's already done (reusable across phases)
- ✅ Live playable game (`arena.agentsoag.com/battle.html`)
- ✅ Non-custodial vault: compiles, 19/19 on-chain tests, real Pyth settlement,
  **deployed on devnet** — ready for Phase 2 mainnet.
- ✅ Security audit of the design (docs/THREATS.md), locked economics (docs/ESCROW.md).

## Next build (Phase 1, free)
The **off-chain round engine + signed cash-out certificates** — the service that
runs rounds, snapshots Pyth open/close, enforces the dead-band + caps, tracks
balances, and issues a verifiable payout voucher when a player leaves.
