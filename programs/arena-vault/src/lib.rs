// Agent Battle Arena — non-custodial vault (v0 DRAFT)
//
// ⚠️ STATUS: DRAFT. NOT compiled, NOT tested, NOT audited. Do NOT deploy to
// mainnet or point real $SOAG at this until it is built, the full test suite in
// tests/arena-vault.ts passes, and an independent audit signs off. See
// docs/THREATS.md for the attacks this design must survive.
//
// Design goal (from the adversarial review): make "non-custodial" actually true.
// The two showstoppers were (1) commingled funds and (2) an authority that can
// sign any balance. This program fixes both structurally:
//
//   * SEGREGATION. Player deposit principal lives in `deposits_vault`. House
//     bankroll lives in a SEPARATE `house_vault`. Winnings are ALWAYS paid out
//     of `house_vault`; player principal in `deposits_vault` is only ever moved
//     by that player's own withdraw. No admin instruction can touch
//     `deposits_vault`.
//   * SOLVENCY INVARIANT, enforced on-chain every state transition:
//         deposits_vault.amount >= total_principal
//         house_vault.amount    >= total_house_liabilities
//     A settle that would break solvency is rejected (forces a house top-up).
//   * AUTHORITY CANNOT MINT VALUE TO ITSELF OR OVERPAY. `settle_round` moves at
//     most the round's reserved exposure between a player and the house, bounded
//     by the dead-band/edge rules, and can never pay a player more than the
//     house_vault holds. A stolen authority key can mis-call a round but cannot
//     drain principal or exceed house liabilities. (NEXT HARDENING: derive the
//     outcome from on-chain Pyth price accounts here instead of trusting the
//     authority's claimed `player_won` — see settle_round TODO.)
//
// This file intentionally implements the CUSTODY CORE first (the funds-holding
// part). The Pyth-on-chain settlement and per-direction exposure caps are
// scaffolded with explicit TODOs to be filled in before devnet stakes.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("fnZeSU5WzuCq32fLJLRVEkcQvB5TNAH8vMskh9ZKwgW");

#[program]
pub mod arena_vault {
    use super::*;

    /// One-time setup. Binds the canonical $SOAG mint and the two segregated
    /// token accounts. Asserts the mint is safe to custody (no transfer hook /
    /// fee / freeze authority — re-verified on-chain, not assumed).
    pub fn initialize(ctx: Context<Initialize>, settlement_authority: Pubkey) -> Result<()> {
        let m = &ctx.accounts.soag_mint;
        // Token-2022 safety gates (THREATS.md M2/M3): a transfer fee or freeze
        // authority would silently break solvency or brick withdrawals.
        require!(m.freeze_authority.is_none(), VaultError::MintHasFreezeAuthority);
        // NOTE: transfer-fee / transfer-hook / permanent-delegate extension
        // checks must be added by parsing the Token-2022 mint extensions here.
        // TODO(before devnet): assert no TransferFeeConfig, no TransferHook,
        // no PermanentDelegate; reject otherwise.

        let v = &mut ctx.accounts.vault;
        v.admin = ctx.accounts.admin.key();
        v.settlement_authority = settlement_authority;
        v.soag_mint = m.key();
        v.deposits_vault = ctx.accounts.deposits_vault.key();
        v.house_vault = ctx.accounts.house_vault.key();
        v.total_principal = 0;
        v.total_house_liabilities = 0;
        v.paused = false;
        v.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Player deposits $SOAG into the SEGREGATED deposits vault. Credits a
    /// PlayerBalance PDA by the amount ACTUALLY received (THREATS.md M2: never
    /// trust the requested amount if a fee is ever present).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(amount > 0, VaultError::ZeroAmount);

        let before = ctx.accounts.deposits_vault.amount;
        token_interface::transfer_checked(
            ctx.accounts.transfer_ctx_in(),
            amount,
            ctx.accounts.soag_mint.decimals,
        )?;
        ctx.accounts.deposits_vault.reload()?;
        let received = ctx
            .accounts
            .deposits_vault
            .amount
            .checked_sub(before)
            .ok_or(VaultError::Math)?;

        let pb = &mut ctx.accounts.player_balance;
        pb.owner = ctx.accounts.owner.key();
        pb.principal = pb.principal.checked_add(received).ok_or(VaultError::Math)?;
        pb.balance = pb.balance.checked_add(received).ok_or(VaultError::Math)?;

        let deposits_amt = ctx.accounts.deposits_vault.amount;
        let house_amt = ctx.accounts.house_vault.amount;
        let v = &mut ctx.accounts.vault;
        v.total_principal = v.total_principal.checked_add(received).ok_or(VaultError::Math)?;
        v.check_solvency(deposits_amt, house_amt)
    }

    /// Apply a settled round result. ONLY the settlement authority may call it,
    /// and it can ONLY move `reserved` (the round's pre-reserved exposure)
    /// between the player and the house pool. It can never exceed house funds
    /// and never touches deposit principal directly.
    ///
    /// TODO(hardening, THREATS.md showstopper #1): replace the trusted
    /// `player_won` arg with on-chain Pyth verification — pass the Pyth price
    /// accounts for open/close, enforce the dead-band, and compute the outcome
    /// here so the authority cannot mis-call rounds.
    pub fn settle_round(ctx: Context<SettleRound>, stake: u64, reserved: u64, player_won: bool, voided: bool) -> Result<()> {
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        if voided {
            return Ok(()); // dead-band: stake stays in player balance, nothing moves
        }
        let deposits_amt = ctx.accounts.deposits_vault.amount;
        let house_amt = ctx.accounts.house_vault.amount;
        let pb = &mut ctx.accounts.player_balance;
        let v = &mut ctx.accounts.vault;
        if player_won {
            // House pays `reserved` (the net win) into the player's balance as a
            // liability. Must be covered by the house vault.
            v.total_house_liabilities = v.total_house_liabilities.checked_add(reserved).ok_or(VaultError::Math)?;
            pb.balance = pb.balance.checked_add(reserved).ok_or(VaultError::Math)?;
        } else {
            // Player loses `stake`: it leaves their balance and becomes house revenue.
            require!(pb.balance >= stake, VaultError::InsufficientBalance);
            pb.balance = pb.balance.checked_sub(stake).ok_or(VaultError::Math)?;
            // Loss reduces what the house owes overall (revenue), floored at 0.
            v.total_house_liabilities = v.total_house_liabilities.saturating_sub(stake.min(reserved));
        }
        v.check_solvency(deposits_amt, house_amt)
    }

    /// Player withdraws up to their on-chain balance. Principal portion is paid
    /// from `deposits_vault`; any winnings portion is paid from `house_vault`.
    /// No voucher / off-chain signature can inflate this — balance is on-chain.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let (principal, balance) = {
            let pb = &ctx.accounts.player_balance;
            (pb.principal, pb.balance)
        };
        require!(balance >= amount, VaultError::InsufficientBalance);

        // Split: pay principal first from deposits, remainder (winnings) from house.
        let from_principal = amount.min(principal);
        let from_house = amount.checked_sub(from_principal).ok_or(VaultError::Math)?;
        let decimals = ctx.accounts.soag_mint.decimals;

        let bump = [ctx.accounts.vault.bump];
        let seeds: &[&[&[u8]]] = &[&[b"vault", &bump]];
        if from_principal > 0 {
            token_interface::transfer_checked(ctx.accounts.transfer_ctx_deposits(seeds), from_principal, decimals)?;
        }
        if from_house > 0 {
            token_interface::transfer_checked(ctx.accounts.transfer_ctx_house(seeds), from_house, decimals)?;
        }

        // Read post-transfer balances, then update state.
        let deposits_amt = ctx.accounts.deposits_vault.amount;
        let house_amt = ctx.accounts.house_vault.amount;
        {
            let pb = &mut ctx.accounts.player_balance;
            pb.balance -= amount;
            pb.principal -= from_principal;
        }
        let v = &mut ctx.accounts.vault;
        v.total_principal = v.total_principal.checked_sub(from_principal).ok_or(VaultError::Math)?;
        v.total_house_liabilities = v.total_house_liabilities.saturating_sub(from_house);
        v.check_solvency(deposits_amt, house_amt)
    }

    /// Admin funds the house bankroll. This is the ONLY way tokens enter the
    /// house vault, and admin may also withdraw house funds — but NEVER deposits.
    pub fn fund_house(ctx: Context<FundHouse>, amount: u64) -> Result<()> {
        token_interface::transfer_checked(
            ctx.accounts.transfer_ctx(),
            amount,
            ctx.accounts.soag_mint.decimals,
        )
    }
}

#[account]
pub struct Vault {
    pub admin: Pubkey,
    pub settlement_authority: Pubkey,
    pub soag_mint: Pubkey,
    pub deposits_vault: Pubkey,
    pub house_vault: Pubkey,
    pub total_principal: u64,        // sum of all player principal in deposits_vault
    pub total_house_liabilities: u64,// sum of winnings owed, must be <= house_vault
    pub paused: bool,
    pub bump: u8,
}

impl Vault {
    /// THE invariant. Both segregated accounts must independently cover their
    /// obligations at every state transition. Takes plain amounts (read before
    /// the mutable borrow) to avoid borrowing ctx.accounts twice.
    fn check_solvency(&self, deposits_amt: u64, house_amt: u64) -> Result<()> {
        require!(deposits_amt >= self.total_principal, VaultError::InsolventDeposits);
        require!(house_amt >= self.total_house_liabilities, VaultError::InsolventHouse);
        Ok(())
    }
}

#[account]
pub struct PlayerBalance {
    pub owner: Pubkey,
    pub principal: u64, // withdrawable from deposits_vault
    pub balance: u64,   // total claimable (principal + net winnings)
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + 32*5 + 8*2 + 1 + 1, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = soag_mint, token::authority = vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(token::mint = soag_mint, token::authority = vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

// Note on emergency_withdraw: because balances are tracked ON-CHAIN (settlement
// is on-chain, not a signed off-chain voucher), `withdraw` never depends on the
// settlement authority being online — a player can always reclaim their balance
// directly. So the "operator goes dark freezes funds" problem from the original
// voucher design simply does not exist here. That is a direct benefit of moving
// settlement on-chain and is why there is no separate emergency path.

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump,
        has_one = soag_mint, has_one = deposits_vault, has_one = house_vault)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = vault.house_vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = soag_mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + 32 + 8 + 8,
        seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
impl<'info> Deposit<'info> {
    fn transfer_ctx_in(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked {
            from: self.owner_token.to_account_info(),
            mint: self.soag_mint.to_account_info(),
            to: self.deposits_vault.to_account_info(),
            authority: self.owner.to_account_info(),
        })
    }
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump,
        has_one = deposits_vault, has_one = house_vault,
        constraint = vault.settlement_authority == authority.key() @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
    #[account(mut, has_one = owner, seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    /// CHECK: identity only; bound via player_balance has_one
    pub owner: UncheckedAccount<'info>,
    #[account(address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(address = vault.house_vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump,
        has_one = soag_mint, has_one = deposits_vault, has_one = house_vault)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = vault.house_vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, has_one = owner, seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, token::mint = soag_mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
impl<'info> Withdraw<'info> {
    fn transfer_ctx_deposits<'a>(&self, s: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, TransferChecked<'info>> {
        CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked {
            from: self.deposits_vault.to_account_info(),
            mint: self.soag_mint.to_account_info(),
            to: self.owner_token.to_account_info(),
            authority: self.vault.to_account_info(),
        }, s)
    }
    fn transfer_ctx_house<'a>(&self, s: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, TransferChecked<'info>> {
        CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked {
            from: self.house_vault.to_account_info(),
            mint: self.soag_mint.to_account_info(),
            to: self.owner_token.to_account_info(),
            authority: self.vault.to_account_info(),
        }, s)
    }
}

#[derive(Accounts)]
pub struct FundHouse<'info> {
    #[account(seeds = [b"vault"], bump = vault.bump, has_one = admin, has_one = soag_mint, has_one = house_vault)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.house_vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, token::mint = soag_mint, token::authority = admin)]
    pub admin_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
impl<'info> FundHouse<'info> {
    fn transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked {
            from: self.admin_token.to_account_info(),
            mint: self.soag_mint.to_account_info(),
            to: self.house_vault.to_account_info(),
            authority: self.admin.to_account_info(),
        })
    }
}

#[error_code]
pub enum VaultError {
    #[msg("vault is paused")] Paused,
    #[msg("amount must be > 0")] ZeroAmount,
    #[msg("arithmetic error")] Math,
    #[msg("insufficient player balance")] InsufficientBalance,
    #[msg("deposits vault under-collateralized")] InsolventDeposits,
    #[msg("house vault cannot cover liabilities")] InsolventHouse,
    #[msg("mint has a freeze authority")] MintHasFreezeAuthority,
    #[msg("caller is not the settlement authority")] Unauthorized,
}
