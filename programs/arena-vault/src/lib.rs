// Agent Battle Arena — non-custodial vault (v1)
//
// ⚠️ Builds + passes the integration suite on a local validator. NOT audited.
// Do NOT point real $SOAG at this until the Pyth on-chain settlement is added
// and an independent audit signs off. See docs/THREATS.md.
//
// Model (corrected after the integration test caught a conservation bug):
//   * Two SEGREGATED token accounts: `deposits_vault` holds the player pool,
//     `house_vault` holds the house bankroll.
//   * INVARIANT, enforced on-chain: `deposits_vault.amount >= total_claims`
//     where total_claims = sum of every player's withdrawable balance. So the
//     deposit pool always covers what players can withdraw.
//   * settle_round MOVES REAL TOKENS so the books and the custody agree:
//       - player loses `stake`  -> stake moves deposits_vault -> house_vault
//       - player wins  `reserved` -> reserved moves house_vault -> deposits_vault
//     A win is rejected if the house can't cover it (forces a top-up).
//   * Residual trust (house-banked reality): the settlement authority can shift
//     a bet's stake between the pools. It is bounded by the player's balance and
//     by per-round caps + the off-chain kill-switch — but a fully on-chain Pyth
//     outcome (TODO) is what removes it. Custody guarantee that DOES hold: funds
//     can only ever leave to the player (withdraw) or move between the two
//     program-owned pools; no key can send them to an arbitrary address.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

declare_id!("fnZeSU5WzuCq32fLJLRVEkcQvB5TNAH8vMskh9ZKwgW");

// Pyth Crypto.SOL/USD feed id. The close price is read from this on-chain feed.
const SOL_USD_FEED_HEX: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

#[program]
pub mod arena_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, settlement_authority: Pubkey) -> Result<()> {
        // Token-2022 safety gate: a freeze authority could brick withdrawals.
        require!(ctx.accounts.soag_mint.freeze_authority.is_none(), VaultError::MintHasFreezeAuthority);
        // TODO(before mainnet): also reject transfer-fee / transfer-hook / permanent-delegate extensions.
        let v = &mut ctx.accounts.vault;
        v.admin = ctx.accounts.admin.key();
        v.settlement_authority = settlement_authority;
        v.soag_mint = ctx.accounts.soag_mint.key();
        v.deposits_vault = ctx.accounts.deposits_vault.key();
        v.house_vault = ctx.accounts.house_vault.key();
        v.total_claims = 0;
        v.paused = false;
        v.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(amount > 0, VaultError::ZeroAmount);

        let before = ctx.accounts.deposits_vault.amount;
        token_interface::transfer_checked(ctx.accounts.transfer_in(), amount, ctx.accounts.soag_mint.decimals)?;
        ctx.accounts.deposits_vault.reload()?;
        let received = ctx.accounts.deposits_vault.amount.checked_sub(before).ok_or(VaultError::Math)?;
        let deposits_amt = ctx.accounts.deposits_vault.amount;

        let pb = &mut ctx.accounts.player_balance;
        pb.owner = ctx.accounts.owner.key();
        pb.balance = pb.balance.checked_add(received).ok_or(VaultError::Math)?;
        let v = &mut ctx.accounts.vault;
        v.total_claims = v.total_claims.checked_add(received).ok_or(VaultError::Math)?;
        require!(deposits_amt >= v.total_claims, VaultError::Insolvent);
        Ok(())
    }

    /// Apply a settled round. Only the settlement authority may call it. The
    /// OUTCOME is DERIVED ON-CHAIN from the open/close prices + the dead-band —
    /// the authority cannot claim a win/void that the prices don't support.
    ///   * |move| < deadband_bps  -> VOID (refund, nothing moves)
    ///   * else player_won = (bet_up == close>open)
    /// TODO(devnet hardening, THREATS.md #1): replace the passed-in open/close
    /// prices with reads from on-chain Pyth PriceUpdateV2 accounts, so the price
    /// VALUES are un-fakeable too. The dead-band/outcome rule below is unchanged.
    pub fn settle_round(ctx: Context<SettleRound>, open_price: i64, deadband_bps: u32, bet_up: bool, stake: u64, reserved: u64, max_age_secs: u64) -> Result<()> {
        require!(!ctx.accounts.vault.paused, VaultError::Paused);
        require!(open_price > 0, VaultError::BadPrice);

        // CLOSE price comes from the on-chain Pyth SOL/USD feed — the authority
        // cannot fake it. open_price is the round's snapshot (same feed/exponent).
        let feed_id = get_feed_id_from_hex(SOL_USD_FEED_HEX).map_err(|_| error!(VaultError::BadPrice))?;
        let p = ctx.accounts.price_update
            .get_price_no_older_than(&Clock::get()?, max_age_secs, &feed_id)
            .map_err(|_| error!(VaultError::StaleOracle))?;
        let close_price = p.price;
        require!(close_price > 0, VaultError::BadPrice);

        // dead-band: signed basis-point move = (close-open)/open * 10000
        let move_bps = ((close_price as i128) - (open_price as i128))
            .checked_mul(10_000).ok_or(VaultError::Math)? / (open_price as i128);
        if move_bps.unsigned_abs() < deadband_bps as u128 {
            return Ok(()); // VOID: sub-dead-band move, stake stays with the player
        }
        let player_won = bet_up == (close_price > open_price);

        let decimals = ctx.accounts.soag_mint.decimals;
        let bump = [ctx.accounts.vault.bump];
        let seeds: &[&[&[u8]]] = &[&[b"vault", &bump]];

        if player_won {
            require!(ctx.accounts.house_vault.amount >= reserved, VaultError::InsolventHouse);
            if reserved > 0 {
                token_interface::transfer_checked(ctx.accounts.house_to_deposits(seeds), reserved, decimals)?;
            }
            let pb = &mut ctx.accounts.player_balance;
            pb.balance = pb.balance.checked_add(reserved).ok_or(VaultError::Math)?;
            let v = &mut ctx.accounts.vault;
            v.total_claims = v.total_claims.checked_add(reserved).ok_or(VaultError::Math)?;
        } else {
            require!(ctx.accounts.player_balance.balance >= stake, VaultError::InsufficientBalance);
            if stake > 0 {
                token_interface::transfer_checked(ctx.accounts.deposits_to_house(seeds), stake, decimals)?;
            }
            let pb = &mut ctx.accounts.player_balance;
            pb.balance = pb.balance.checked_sub(stake).ok_or(VaultError::Math)?;
            let v = &mut ctx.accounts.vault;
            v.total_claims = v.total_claims.checked_sub(stake).ok_or(VaultError::Math)?;
        }

        ctx.accounts.deposits_vault.reload()?;
        require!(ctx.accounts.deposits_vault.amount >= ctx.accounts.vault.total_claims, VaultError::Insolvent);
        Ok(())
    }

    /// Player withdraws up to their on-chain balance, paid from deposits_vault.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(ctx.accounts.player_balance.balance >= amount, VaultError::InsufficientBalance);
        let decimals = ctx.accounts.soag_mint.decimals;
        let bump = [ctx.accounts.vault.bump];
        let seeds: &[&[&[u8]]] = &[&[b"vault", &bump]];
        token_interface::transfer_checked(ctx.accounts.transfer_out(seeds), amount, decimals)?;
        let pb = &mut ctx.accounts.player_balance;
        pb.balance = pb.balance.checked_sub(amount).ok_or(VaultError::Math)?;
        let v = &mut ctx.accounts.vault;
        v.total_claims = v.total_claims.checked_sub(amount).ok_or(VaultError::Math)?;
        Ok(())
    }

    /// Admin tops up the house bankroll. Only ever adds to `house_vault`.
    pub fn fund_house(ctx: Context<FundHouse>, amount: u64) -> Result<()> {
        token_interface::transfer_checked(ctx.accounts.transfer(), amount, ctx.accounts.soag_mint.decimals)
    }
}

#[account]
pub struct Vault {
    pub admin: Pubkey,
    pub settlement_authority: Pubkey,
    pub soag_mint: Pubkey,
    pub deposits_vault: Pubkey,
    pub house_vault: Pubkey,
    pub total_claims: u64, // sum of all player balances; deposits_vault must cover it
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct PlayerBalance {
    pub owner: Pubkey,
    pub balance: u64, // withdrawable
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + 32*5 + 8 + 1 + 1, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = soag_mint, token::authority = vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(token::mint = soag_mint, token::authority = vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump, has_one = soag_mint, has_one = deposits_vault)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = soag_mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init_if_needed, payer = owner, space = 8 + 32 + 8, seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
impl<'info> Deposit<'info> {
    fn transfer_in(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked {
            from: self.owner_token.to_account_info(), mint: self.soag_mint.to_account_info(),
            to: self.deposits_vault.to_account_info(), authority: self.owner.to_account_info(),
        })
    }
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump, has_one = soag_mint, has_one = deposits_vault, has_one = house_vault,
        constraint = vault.settlement_authority == authority.key() @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, has_one = owner, seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    /// CHECK: identity only; bound via player_balance has_one
    pub owner: UncheckedAccount<'info>,
    #[account(mut, address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = vault.house_vault)]
    pub house_vault: InterfaceAccount<'info, TokenAccount>,
    /// The Pyth SOL/USD price update account (close price source).
    pub price_update: Account<'info, PriceUpdateV2>,
    pub token_program: Interface<'info, TokenInterface>,
}
impl<'info> SettleRound<'info> {
    fn house_to_deposits<'a>(&self, s: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, TransferChecked<'info>> {
        CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked {
            from: self.house_vault.to_account_info(), mint: self.soag_mint.to_account_info(),
            to: self.deposits_vault.to_account_info(), authority: self.vault.to_account_info(),
        }, s)
    }
    fn deposits_to_house<'a>(&self, s: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, TransferChecked<'info>> {
        CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked {
            from: self.deposits_vault.to_account_info(), mint: self.soag_mint.to_account_info(),
            to: self.house_vault.to_account_info(), authority: self.vault.to_account_info(),
        }, s)
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault"], bump = vault.bump, has_one = soag_mint, has_one = deposits_vault)]
    pub vault: Account<'info, Vault>,
    pub soag_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = vault.deposits_vault)]
    pub deposits_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, has_one = owner, seeds = [b"balance", owner.key().as_ref()], bump)]
    pub player_balance: Account<'info, PlayerBalance>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, token::mint = soag_mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}
impl<'info> Withdraw<'info> {
    fn transfer_out<'a>(&self, s: &'a [&'a [&'a [u8]]]) -> CpiContext<'a, 'a, 'a, 'info, TransferChecked<'info>> {
        CpiContext::new_with_signer(self.token_program.to_account_info(), TransferChecked {
            from: self.deposits_vault.to_account_info(), mint: self.soag_mint.to_account_info(),
            to: self.owner_token.to_account_info(), authority: self.vault.to_account_info(),
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
    fn transfer(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked {
            from: self.admin_token.to_account_info(), mint: self.soag_mint.to_account_info(),
            to: self.house_vault.to_account_info(), authority: self.admin.to_account_info(),
        })
    }
}

#[error_code]
pub enum VaultError {
    #[msg("vault is paused")] Paused,
    #[msg("amount must be > 0")] ZeroAmount,
    #[msg("arithmetic error")] Math,
    #[msg("insufficient player balance")] InsufficientBalance,
    #[msg("deposits vault under-collateralized")] Insolvent,
    #[msg("house vault cannot cover the win")] InsolventHouse,
    #[msg("mint has a freeze authority")] MintHasFreezeAuthority,
    #[msg("caller is not the settlement authority")] Unauthorized,
    #[msg("price must be > 0")] BadPrice,
    #[msg("oracle price is stale or unavailable")] StaleOracle,
}
