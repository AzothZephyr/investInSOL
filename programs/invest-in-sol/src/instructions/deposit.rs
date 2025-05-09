use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{mint_to, Mint, MintTo, Token2022, TokenAccount},
};

use crate::state::{Config, DepositReceipt, Treasury};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: using SystemAccount for direct SOL transfer.
    #[account(mut)]
    pub depositor_sol_account: SystemAccount<'info>,

    // depositor's CN ATA (initialized if needed)
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = cn_mint,
        associated_token::authority = depositor,
        token::token_program = token_program, // specify token program for ATA? or token 2022?
    )]
    pub depositor_cn_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = depositor,
        seeds = [DepositReceipt::SEED_PREFIX, depositor.key().as_ref()],
        bump,
        space = 8 + DepositReceipt::INIT_SPACE,
    )]
    pub deposit_receipt: Account<'info, DepositReceipt>,

    #[account(
        seeds = [Config::SEED_PREFIX],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.treasury_bump,
    )]
    pub treasury: Account<'info, Treasury>,

    // mints (checked against config)
    #[account(
        mut,
        address = config.cn_mint @ DepositError::AddressMismatch
    )]
    pub cn_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = config.pt_mint @ DepositError::AddressMismatch
    )]
    pub pt_mint: InterfaceAccount<'info, Mint>,

    // protocol's PT ATA
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = pt_mint,
        associated_token::authority = config, // config PDA owns the protocol's PT ATA
        token::token_program = token_program, // specify token program for ATA
    )]
    pub protocol_pt_ata: InterfaceAccount<'info, TokenAccount>,

    // programs
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    pub fn assert_protocol_state(ctx: &Context<Deposit>) -> Result<()> {
        // Ensure the protocol is not locked
        require!(!ctx.accounts.config.locked, DepositError::ProtocolLocked);
        require!(
            !ctx.accounts.config.deposit_locked,
            DepositError::DepositsLocked
        );
        require!(
            ctx.accounts.deposit_receipt.initialized == false,
            DepositError::UnclaimedDepositPending
        );
        Ok(())
    }

    pub fn deposit_sol(ctx: &mut Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, DepositError::ZeroAmount);
        let transfer_accounts = system_program::Transfer {
            from: ctx.accounts.depositor_sol_account.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
        );
        system_program::transfer(cpi_ctx, amount)?;
        msg!("transferred {} SOL to treasury vault", amount);

        // update treasury state to track total sol deposits
        let treasury = &mut ctx.accounts.treasury;
        treasury.total_deposited_sol = treasury
            .total_deposited_sol
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        Ok(())
    }

    pub fn calculate_tokens_to_mint(ctx: &Context<Deposit>, amount: u64) -> Result<u64> {
        // calculate nav and determine tokens to mint
        let nav = ctx.accounts.treasury.calculate_nav()?;
        // todo: add precision handling here. for now, nav=1 so amount/nav = amount
        let tokens_to_mint = amount
            .checked_div(nav)
            .ok_or(ProgramError::ArithmeticOverflow)?; // placeholder calculation

        msg!("calculated NAV: {}", nav);
        msg!("tokens to mint: {}", tokens_to_mint);
        Ok(tokens_to_mint)
    }

    pub fn set_deposit_receipt(ctx: &mut Context<Deposit>, amount: u64) -> Result<()> {
        let option_duration = ctx.accounts.config.option_duration;
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        let expiration = current_timestamp
            .checked_add(option_duration as i64)
            .ok_or(DepositError::Overflow)?;

        *ctx.accounts.deposit_receipt = DepositReceipt {
            initialized: true,
            nft_issued: false,
            amount,
            expiration,
            bump: ctx.bumps.deposit_receipt,
        };

        msg!(
            "issuing deposit receipt - amount: {}, expiration: {}",
            amount,
            expiration
        );
        Ok(())
    }

    pub fn mint_cn_to_depositor(ctx: &Context<Deposit>, tokens_to_mint: u64) -> Result<()> {
        // prepare PDA signer seeds using helper
        let bump_seed = [ctx.accounts.config.bump];
        let config_seeds_with_bump = Config::get_seeds_with_bump(&bump_seed);
        let signer_seeds = &[&config_seeds_with_bump[..]];

        // mint CN tokens to depositor's CN ATA
        let cpi_accounts_cn = MintTo {
            mint: ctx.accounts.cn_mint.to_account_info(),
            to: ctx.accounts.depositor_cn_ata.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        let cpi_ctx_cn = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts_cn,
            signer_seeds,
        );
        mint_to(cpi_ctx_cn, tokens_to_mint)?;
        msg!("minted {} CN tokens to depositor", tokens_to_mint);

        Ok(())
    }

    pub fn mint_pt_to_protocol(ctx: &Context<Deposit>, tokens_to_mint: u64) -> Result<()> {
        // prepare PDA signer seeds using helper
        let bump_seed = [ctx.accounts.config.bump];
        let config_seeds_with_bump = Config::get_seeds_with_bump(&bump_seed);
        let signer_seeds = &[&config_seeds_with_bump[..]];

        // mint PT tokens to protocol's PT ATA
        let cpi_accounts_pt = MintTo {
            mint: ctx.accounts.pt_mint.to_account_info(),
            to: ctx.accounts.protocol_pt_ata.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        let cpi_ctx_pt = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts_pt,
            signer_seeds,
        );
        mint_to(cpi_ctx_pt, tokens_to_mint)?;
        msg!("minted {} PT tokens to protocol's ATA", tokens_to_mint);

        Ok(())
    }
}

#[error_code]
pub enum DepositError {
    #[msg("deposit amount must be greater than zero.")]
    ZeroAmount,
    #[msg("account address mismatch.")]
    AddressMismatch,
    #[msg("protocol is locked.")]
    ProtocolLocked,
    #[msg("deposits are currently locked.")]
    DepositsLocked,
    #[msg("calculation overflow")]
    Overflow,
    #[msg("unclaimed deposit receipt pending.")]
    UnclaimedDepositPending,
}
