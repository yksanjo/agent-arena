# Agent Battle Arena — Adversarial Review Findings (2026-06-03)

Three independent attackers reviewed `ESCROW.md` before any code. They converged
on two showstoppers. **Do not build the money game until these are resolved.**

## SHOWSTOPPER 1 — The house-banked 15s price bet is structurally -EV for the house

All three reviewers, independently:

- Outcome = `sign(Pyth_close − Pyth_open)` over 15s. **Pyth is a public, lagging
  aggregate of CEX prices.** Anyone watching Binance/Coinbase (ms latency) knows
  where Pyth will print 100ms–seconds early. Break-even at 1.90× is only **52.6%**
  accuracy; a lead-lag bot clears 55–70% on *selected* rounds.
- 15s moves also have real microstructure autocorrelation; a bot that **sits out
  ambiguous rounds** (the UI already allows zero-stake) and only fires at p>58%
  makes ~+10% per bet — the 5% house edge inverted.
- **Sybil:** wallets are free. One operator runs the bot across 1,000 wallets,
  each under the per-wallet cap, perfectly correlated. Per-wallet caps are
  cosmetic. The 1M/day cap only meters *how fast* the house bleeds, and lets the
  fleet also deny legit players (cap trips for everyone).

**Conclusion:** caps + a separate funded wallet bound the *loss*, they don't stop
it. House-banked on a public-oracle short-horizon bet is a money-loser vs pros.

### Fixes (if keeping house-banked)
- **Dead-band:** void/refund unless |move| > (Pyth confidence + typical drift) —
  kills the easy small-move lead-lag picks.
- **Randomize round length + close-sampling slot**, commit-and-hide the close
  point at open; settle on a **TWAP over multiple Pyth updates**, not one tick.
- **Per-round, per-direction hard cap** sized so even a 100%-informed round is
  survivable, regardless of how many wallets bet that side.
- **Bigger edge** for this horizon (≤1.7× / 15–20%), not 1.9×.
- **Automated kill-switch:** track realized house P&L and per-wallet/cluster
  win-rate; auto-pause + hold winning-voucher signing for clusters beating the
  house beyond a statistical threshold (deposits always remain reclaimable).
- **Stale-oracle policy:** if Pyth stale / confidence wide at close → VOID+refund
  the whole round (never auto-win/lose; never selective).

### The clean alternative
**Parimutuel** (players bet each other, house only rakes) makes this entire
showstopper disappear — there is no house bankroll to drain; sharp players win
from other players, not from your wallet. Strongly reconsider.

## SHOWSTOPPER 2 — "Non-custodial" is false as designed; one key drains everything

- **Commingling:** one vault token account holds deposits + house pool. A winner
  withdrawing 1.9× is paid from the same pot that holds others' principal. "Your
  deposit only returns to you" is not enforceable in one account.
- **Authority key = total drain:** the authority signs `{owner, balance, nonce}`.
  Steal it → sign `{owner: attacker_wallet, balance: vault_total}` → withdraw.
  "Can't pay itself" is worthless; it pays a colluding wallet. Entire vault gone.
- **Peak-voucher hoard:** nonce-monotonic stops replay of one voucher, not a user
  keeping their highest-balance voucher and cashing it after losing.
- **Upgrade authority:** if the program is upgrade-able by one key, non-custodial
  is false by construction.

### Fixes
- **Segregate accounts:** house pool in its OWN token account, separate from the
  deposit-backing account and from the treasury. Admin can fund/withdraw the
  *house* account; NO instruction can touch the *deposit* account except the
  user/voucher-gated withdraw.
- **Settle on-chain against Pyth** so the program computes win/loss and the
  off-chain authority can only *sequence* bets, never mint a balance.
- **Enforce solvency invariant on-chain:** `vault_balance >= sum(all claimable)`
  checked every state transition; reject settles that breach it (force top-up).
- **Voucher hardening:** domain separation (program_id, vault, mint, cluster,
  expiry_slot); on-chain balance always reflects latest settle so stale high
  vouchers are rejected; unify withdraw + emergency_withdraw bookkeeping (no
  double-pay).
- **Token-2022:** credit deposits by *actual received* amount; assert no transfer
  fee/hook/permanent-delegate, `freeze_authority == None`, exact mint + 6 decimals.
- **Immutable program** (or timelock multisig upgrade authority), disclosed.

## Smaller but real
- Off-chain engine is the bet source of truth: server-only clock, reject
  late/after-lock bets, idempotency keys, per-wallet serialized processing (no
  pump race / double-stake). Never trust client timestamps.
- Reserve house exposure on **every pump**, not just bet-open, or the cap is
  bypassable and solvency breaks.
- Stagger the daily cap (rolling window) so a fleet can't vacuum it at the roll.
- Regulatory: no-KYC house-banked real-money gambling is an existential legal
  exposure — geofence + legal read before mainnet; winning-voucher velocity holds.
- Demo's client-side `Math.random()` + public RPC must NOT shape the production
  trust boundary.

## Bottom line
Custody can be made genuinely non-custodial (segregate + on-chain solvency +
settle on-chain). But **house-banked on a public-oracle 15s price bet is
structurally drainable** — the realistic options are: (a) parimutuel (no house
risk), or (b) house-banked with dead-band + random timing + per-direction caps +
a bigger edge + a small, separate, pre-funded house wallet, accepting it's a
capped entertainment product, not a profit machine, against pros.
