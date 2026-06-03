// Real integration test for arena-vault. Runs under `anchor test` (which starts
// a local validator, deploys the program, sets ANCHOR_PROVIDER_URL +
// ANCHOR_WALLET, then runs this). Creates a Token-2022 test mint and exercises
// the full money flow, asserting the solvency invariant + segregation + that a
// stranger cannot drain it. No mocks — real on-chain state on a local validator.

import anchor from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID, createMint, createAccount, mintTo, getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "node:fs";

const { BN } = anchor;
let passed = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  ✗ FAIL:", msg); process.exit(1); } passed++; console.log("  ✓", msg); };
async function expectFail(promise, msg) {
  try { await promise; } catch { passed++; console.log("  ✓", msg, "(rejected as expected)"); return; }
  console.error("  ✗ FAIL:", msg, "(should have rejected)"); process.exit(1);
}
const n = (bn) => Number(bn.toString());

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const conn = provider.connection;
const payer = provider.wallet.payer; // Keypair behind the NodeWallet
const idl = JSON.parse(readFileSync(new URL("../target/idl/arena_vault.json", import.meta.url)));
const program = new anchor.Program(idl, provider);
const PROGRAM_ID = program.programId;

async function airdrop(pubkey, sol = 10) {
  const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

async function main() {
  console.log("arena-vault integration test\n");
  await airdrop(payer.publicKey);

  // --- setup: Token-2022 mint (6 decimals, NO freeze authority) ---
  const player = Keypair.generate();
  const authority = Keypair.generate(); // settlement authority
  await airdrop(player.publicKey);

  const mint = await createMint(conn, payer, payer.publicKey, null /* no freeze authority */, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID);

  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
  const [balancePda] = PublicKey.findProgramAddressSync([Buffer.from("balance"), player.publicKey.toBuffer()], PROGRAM_ID);

  // two SEGREGATED token accounts owned by the vault PDA
  const depositsVault = await createAccount(conn, payer, mint, vaultPda, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  const houseVault = await createAccount(conn, payer, mint, vaultPda, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);

  // funded token accounts for the player and the admin (house funder)
  const playerToken = await createAccount(conn, payer, mint, player.publicKey, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  const adminToken = await createAccount(conn, payer, mint, payer.publicKey, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(conn, payer, mint, playerToken, payer, 1_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(conn, payer, mint, adminToken, payer, 1_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);

  const bal = (acc) => getAccount(conn, acc, undefined, TOKEN_2022_PROGRAM_ID).then((a) => Number(a.amount));

  // --- initialize ---
  await program.methods.initialize(authority.publicKey).accountsPartial({
    admin: payer.publicKey, vault: vaultPda, soagMint: mint,
    depositsVault, houseVault, systemProgram: SystemProgram.programId,
  }).rpc();
  let v = await program.account.vault.fetch(vaultPda);
  ok(n(v.totalClaims) === 0, "initialize: zeroed accounting");
  ok(v.depositsVault.equals(depositsVault) && v.houseVault.equals(houseVault), "initialize: bound segregated accounts");

  // --- fund the house bankroll ---
  await program.methods.fundHouse(new BN(10_000)).accountsPartial({
    vault: vaultPda, soagMint: mint, houseVault, admin: payer.publicKey, adminToken, tokenProgram: TOKEN_2022_PROGRAM_ID,
  }).rpc();
  ok((await bal(houseVault)) === 10_000, "fund_house: house bankroll funded (10,000)");

  // --- deposit ---
  await program.methods.deposit(new BN(5_000)).accountsPartial({
    vault: vaultPda, soagMint: mint, depositsVault, ownerToken: playerToken,
    owner: player.publicKey, playerBalance: balancePda, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([player]).rpc();
  let pb = await program.account.playerBalance.fetch(balancePda);
  v = await program.account.vault.fetch(vaultPda);
  ok(n(pb.balance) === 5_000, "deposit: credits balance");
  ok(n(v.totalClaims) === 5_000 && (await bal(depositsVault)) === 5_000, "deposit: lands in deposits_vault, total_claims tracks");

  // invariant helper: deposits_vault must always cover total_claims
  const invariant = async (label) => {
    const vv = await program.account.vault.fetch(vaultPda);
    ok((await bal(depositsVault)) >= n(vv.totalClaims), `INVARIANT ok — ${label}`);
  };

  // settle now DERIVES the outcome on-chain from prices + dead-band (15 bps).
  // open/close are scaled prices (e.g. 10000 = $100.00). bet_up = player backs "up".
  const DB = 15;
  const settle = (openP, closeP, betUp, stake, reserved, signer = authority) => program.methods
    .settleRound(new BN(openP), new BN(closeP), DB, betUp, new BN(stake), new BN(reserved))
    .accountsPartial({ vault: vaultPda, authority: signer.publicKey, soagMint: mint, playerBalance: balancePda, owner: player.publicKey, depositsVault, houseVault, tokenProgram: TOKEN_2022_PROGRAM_ID })
    .signers([signer]).rpc();

  // --- settle WIN: player backs UP, price goes UP (+200bps) -> house pays 850 ---
  await settle(10_000, 10_200, true, 1_000, 850);
  pb = await program.account.playerBalance.fetch(balancePda);
  ok(n(pb.balance) === 5_850, "settle WIN: balance grows by the 1.7x net win (850)");
  ok((await bal(houseVault)) === 9_150 && (await bal(depositsVault)) === 5_850, "settle WIN: tokens moved house_vault -> deposits_vault");
  await invariant("after win");

  // --- settle LOSS: player backs UP, price goes DOWN -> stake moves to house ---
  await settle(10_000, 9_800, true, 1_000, 850);
  pb = await program.account.playerBalance.fetch(balancePda);
  ok(n(pb.balance) === 4_850, "settle LOSS: stake debited from balance");
  ok((await bal(houseVault)) === 10_150 && (await bal(depositsVault)) === 4_850, "settle LOSS: tokens moved deposits_vault -> house_vault");
  await invariant("after loss");

  // --- VOID via DEAD-BAND: a +5bps move (< 15bps) refunds, nothing moves ---
  const beforeBal = n((await program.account.playerBalance.fetch(balancePda)).balance);
  const beforeHouse = await bal(houseVault);
  await settle(10_000, 10_005, true, 1_000, 850); // +5 bps -> under dead-band -> VOID
  ok(n((await program.account.playerBalance.fetch(balancePda)).balance) === beforeBal && (await bal(houseVault)) === beforeHouse, "settle VOID: sub-dead-band move refunds, nothing moves");

  // --- SECURITY: a stranger cannot settle (drain) ---
  const attacker = Keypair.generate();
  await airdrop(attacker.publicKey, 1);
  await expectFail(settle(10_000, 20_000, true, 1_000_000, 1_000_000, attacker), "unauthorized settle is rejected");

  // --- SECURITY: cannot withdraw more than balance ---
  await expectFail(program.methods.withdraw(new BN(999_999_999)).accountsPartial({
    vault: vaultPda, soagMint: mint, depositsVault, playerBalance: balancePda,
    owner: player.publicKey, ownerToken: playerToken, tokenProgram: TOKEN_2022_PROGRAM_ID,
  }).signers([player]).rpc(), "over-withdraw is rejected");

  // --- withdraw EVERYTHING (paid from deposits_vault) ---
  const playerBefore = await bal(playerToken);
  pb = await program.account.playerBalance.fetch(balancePda);
  const cashOut = n(pb.balance); // 4850
  await program.methods.withdraw(new BN(cashOut)).accountsPartial({
    vault: vaultPda, soagMint: mint, depositsVault, playerBalance: balancePda,
    owner: player.publicKey, ownerToken: playerToken, tokenProgram: TOKEN_2022_PROGRAM_ID,
  }).signers([player]).rpc();
  ok((await bal(playerToken)) === playerBefore + cashOut, "withdraw: player receives all tokens");
  ok((await bal(depositsVault)) === 0, "withdraw: deposits_vault emptied");
  pb = await program.account.playerBalance.fetch(balancePda);
  ok(n(pb.balance) === 0, "withdraw: balance zeroed");

  // --- CONSERVATION: player deposited 5000, cashed out 4850, house netted +150 ---
  ok((await bal(houseVault)) === 10_150, "conservation: house netted +150 = the player's net loss");
  await invariant("final");

  console.log(`\n✅ all ${passed} assertions passed`);
}

main().catch((e) => { console.error("\n✗ test crashed:", e); process.exit(1); });
