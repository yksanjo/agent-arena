# Agent Battle Arena — Escrow & Settlement Design

Status: DRAFT (design before code — this holds real money)

## Decisions (LOCKED 2026-06-03)

- **Custody:** non-custodial vault — player deposits are program-owned and can
  only ever return to the depositing wallet.
- **Payout model:** **house-banked** — players bet against the house, not each
  other. Winners are paid from a house liquidity pool.
- **House edge:** **~5%** — a winning 50/50 pays **1.90×** stake, not 2×. This
  is the house's revenue over volume and the reason the book is profitable
  rather than break-even.
- **Daily exposure cap:** **1,000,000 (units TBD: SOAG vs USD)** of *house
  at-risk*, enforced by pausing NEW rounds once hit — never by capping a won
  player's withdrawal (stranding a winner is unacceptable).
- **Anti-gaming:** lock-bet-then-snapshot-price, single Pyth oracle, per-wallet
  + global caps, min/max bet, rate limits, anomaly flags.

## Goal

Let a player commit 100,000 $SOAG, spend it across fast 15s rounds, and withdraw
their balance (winnings included) at any time — without anyone, including us,
being able to take their *deposit*. The house liquidity pool is funded by us and
bounded by the daily exposure cap.

## House solvency model

The house wins ~5% of staked volume in expectation (the edge) but takes variance
each round. The daily exposure cap bounds worst-case loss per day. Concretely:
once the sum of *potential payouts on open rounds* would exceed the cap, no new
bets are accepted until rounds settle / the day rolls. This guarantees the house
can always cover every open position. Skilled players who beat short-horizon
price moves are the main threat to the edge — see anti-gaming.

## Honest trust model (read this first)

A fast, inter-player betting game cannot be fully trustless: funds move between
players every round, and an off-chain engine has to declare each round's result.
So we are explicit about what is and isn't trustless:

- **Custody: trustless.** Deposits sit in a program-owned vault. Funds can ONLY
  ever be released back to the depositing wallet. The operator key cannot send
  funds to itself. A bug or a hack of our servers cannot redirect funds.
- **Settlement: semi-trusted, but verifiable.** A settlement authority posts
  signed balance updates after rounds. It cannot steal (see above), but it could
  in principle mis-report a result. We shrink this risk by settling round
  outcomes from a **real on-chain price oracle (Pyth)** — so any settlement is
  checkable against public data, and disputes are detectable.
- **Solvency: enforced on-chain.** The vault can never pay out more than it
  holds; per-user withdrawable balance is capped by signed, sequenced vouchers.

This is meaningfully safer than custodial (we never hold withdrawable keys to
user funds) while being buildable. We do not claim "fully trustless."

## Components

### 1. Vault program (Anchor / Solana)
- `init_vault` — one global vault PDA owning a $SOAG (Token-2022) token account.
- `deposit(amount)` — user transfers $SOAG into the vault; program credits an
  on-chain `Balance { owner, amount, nonce }` PDA for that user.
- `withdraw(amount, voucher)` — user withdraws up to their settled balance.
  `voucher` = a message `{ owner, balance, nonce }` signed by the settlement
  authority. Program checks: signature valid, nonce strictly increasing (no
  replay), `amount <= balance`, vault has funds. Transfers $SOAG to the user.
- `emergency_withdraw` — if the authority goes dark for N days, a user can
  reclaim their last on-chain settled balance unconditionally (liveness escape
  hatch so funds are never frozen by an offline operator).

### 2. Settlement authority (off-chain service)
- Runs the round engine: opens 15s events, takes pumps, resolves against the
  **Pyth price** for the token at round close.
- Maintains each player's running balance. Periodically (and on withdraw
  request) issues a fresh signed voucher `{ owner, balance, nonce+1 }`.
- Its signing key can ONLY attest balances; it can never move funds to itself.

### 3. Price oracle (Pyth)
- Round outcome = sign of `price(close) - price(open)` from Pyth on-chain feeds.
- Open/close prices are recorded so any user can verify a result independently.

## Flows

**Deposit:** wallet → `deposit(100_000)` → vault holds it, on-chain balance set.
**Play:** pumps/wins/losses adjust the off-chain balance; nothing on-chain per round.
**Withdraw:** client asks authority for a current voucher → `withdraw(amount, voucher)`
→ $SOAG lands back in the wallet (~1s, ~$0.0005 fee). Winnings included.

## Security checklist (must all pass before mainnet)

- [ ] Token-2022 transfer semantics correct (SOAG mint
      `ADue87cPcDhsyGq2hrDsukp7j8AFTSnaYHSanDATpump`, 6 decimals, no transfer hook
      — re-verify on-chain).
- [ ] Voucher replay impossible (strictly increasing per-user nonce).
- [ ] Withdraw cannot exceed signed balance or vault solvency.
- [ ] Authority key compromise cannot move funds to a non-owner.
- [ ] Emergency withdraw works when authority is offline.
- [ ] Integer over/underflow guards on every balance math op.
- [ ] No `unwrap()`/panics on attacker-controlled input.
- [ ] Re-entrancy / double-settle within one round impossible.
- [ ] Bets lock BEFORE the resolution price is sampled (no peeking the move).
- [ ] Daily house exposure cap enforced; new rounds pause at the cap.
- [ ] Per-wallet + global bet caps and rate limits enforced server-side.
- [ ] House liquidity pool always covers all open positions (solvency invariant).
- [ ] Payout uses the 1.90× edge consistently; no path pays full 2×.

## Build path (devnet first — NO real $SOAG until the end)

1. **Spec review** — this doc reviewed (eng + security pass, e.g. `/codex review`).
2. **Program on devnet** — implement vault + tests (deposit/withdraw/voucher/
   replay/solvency/emergency). 100% of the security checklist covered by tests.
3. **Settlement service on devnet** — round engine + Pyth + voucher signing,
   wired to the deployed page against a devnet $SOAG-equivalent.
4. **Adversarial review / audit** — independent review of the program before
   any mainnet deploy. Treat as a gate, not a formality.
5. **Mainnet, soft launch** — small caps first (e.g. cap deposits) to limit
   blast radius, watch, then raise.

## What is shipped today (for reference)

- Real Phantom connect + real $SOAG balance read (read-only, no funds move).
- The game loop with mock stack + mock outcome.

Nothing in this doc is built yet. This is the plan we build against.
