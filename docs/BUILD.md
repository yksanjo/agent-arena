# Building the vault (devnet) — runbook

⚠️ The program in `programs/arena-vault/` is a **DRAFT**: written, not compiled,
not tested, not audited. This runbook is how we turn it into a real, tested
devnet deployment. Real $SOAG never touches it until after step 6.

## Prereqs (one-time, needs your OK to install)

This machine has Rust ✓, Solana CLI ✓, Node ✓ — but **Anchor is not installed**,
and the install builds external code so it's gated. To proceed, either:

- Run it yourself in this session with the `!` prefix:
  ```
  ! cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
  ! avm install latest && avm use latest
  ```
- Or add a Bash permission rule allowing it, and I'll run it.

Then a devnet keypair + airdrop:
```
solana-keygen new -o ~/.config/solana/devnet.json     # NOT your mainnet key
solana config set --url devnet --keypair ~/.config/solana/devnet.json
solana airdrop 5
```

## Build & test loop (local validator first — free, fast, no devnet needed)

```
cd ~/agent-arena
anchor build
anchor test            # runs tests/arena-vault.ts against a local validator
```

`anchor test` must pass the **entire** security checklist in `docs/ESCROW.md`
before we go further. These are the tests that matter (see tests/arena-vault.ts):

- deposit credits ACTUAL received amount; rejects zero / wrong mint / fake mint
- withdraw pays principal from deposits_vault, winnings from house_vault
- withdraw cannot exceed on-chain balance (no voucher inflation path exists)
- settle_round: only settlement_authority; loss debits player; win is bounded
  by reserved and by house_vault solvency; void moves nothing
- solvency invariant holds after every op (deposits >= principal, house >= liab)
- admin can fund/withdraw house_vault but has NO path to deposits_vault
- mint with freeze authority / transfer fee / transfer hook is REJECTED at init
- integer overflow/underflow guards on every balance op

## Devnet deploy (after local tests pass)

```
anchor deploy --provider.cluster devnet
# create a devnet $SOAG-equivalent Token-2022 mint for testing (NOT real SOAG)
spl-token create-token --program-2022 --decimals 6
# wire the deployed program id + devnet mint into the round engine + page
```

## Round engine (off-chain, devnet)

Separate service (next build): opens 15s rounds, enforces the dead-band +
randomized close + per-direction cap, reads Pyth for the outcome, calls
`settle_round`. Server-only clock; reject late bets; idempotency keys; per-wallet
serialized processing. (THREATS.md "Smaller but real".)

## Hardening gate before mainnet

1. Move settlement outcome on-chain (Pyth verification inside `settle_round`).
2. Per-direction exposure caps enforced on-chain.
3. Program made immutable OR upgrade authority → disclosed timelock multisig.
4. **Independent audit** of the program (gate, not a formality).
5. Legal/geofence read on operating a house-banked money game.
6. Mainnet soft launch: tiny house wallet, low caps, monitored.

Only after all six does real $SOAG go in.
