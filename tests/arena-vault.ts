// Security test plan for arena-vault, expressed as Anchor tests.
//
// ⚠️ DRAFT — these are the cases that MUST pass before devnet stakes (and a
// superset before mainnet). They run with `anchor test` against a local
// validator once the Anchor toolchain is installed (see docs/BUILD.md). The
// bodies are scaffolded; fill them in as the program compiles.
//
// Every test maps to a line in the docs/ESCROW.md security checklist and a
// finding in docs/THREATS.md. A failing test here = a way real $SOAG leaves.

import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";

describe("arena-vault — custody & solvency", () => {
  // anchor.setProvider(anchor.AnchorProvider.env());
  // const program = anchor.workspace.ArenaVault;

  it("rejects a mint with a freeze authority at init (THREATS M3)");
  it("rejects a mint with transfer fee / transfer hook / permanent delegate (THREATS M2)");

  it("deposit credits the ACTUAL received amount, not the requested (THREATS M2)");
  it("deposit rejects zero amount and wrong/fake mint (THREATS M4)");

  it("withdraw pays principal from deposits_vault, winnings from house_vault (segregation)");
  it("withdraw can NEVER exceed the on-chain player balance (no voucher inflation, THREATS C2/C3)");
  it("a stolen settlement-authority key cannot drain principal or overpay beyond house_vault (THREATS C2)");

  it("settle_round: only the settlement_authority may call it");
  it("settle_round loss debits the player; win is bounded by `reserved` AND house solvency");
  it("settle_round void moves nothing (dead-band refund stays in player balance)");

  it("solvency invariant holds after every op: deposits>=principal, house>=liabilities (THREATS H3)");
  it("admin can fund and withdraw house_vault but has NO instruction touching deposits_vault (THREATS H4)");

  it("checked math: no overflow/underflow on deposit/settle/withdraw (THREATS M6)");
  it("double-withdraw via withdraw + emergency_withdraw nets to <= entitlement (THREATS H1)");
});

describe("arena-vault — round engine invariants (off-chain, integration)", () => {
  it("bet locks on server clock; a late/after-lock bet is rejected (THREATS #3)");
  it("a move under the dead-band voids and refunds the whole round (THREATS #1)");
  it("house exposure is reserved on EVERY pump, not just bet-open (THREATS #5)");
  it("per-direction round cap bounds total at-risk regardless of wallet count (THREATS #2)");
  it("stale / wide-confidence Pyth at close → round VOID + refund, non-selective (THREATS #7)");
});
