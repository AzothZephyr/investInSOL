#![allow(unexpected_cfgs)]
mod instructions;
use instructions::*;
pub mod state;

use anchor_lang::prelude::*;

declare_id!("GwuTyisS2uwa8SNZ7gR298gyLLWioSfrwPEZQeTScfvS");

#[program]
pub mod invest_in_sol {
    use super::*;

    /// initializes the protocol config, treasury, and treasury vault.
    /// requires pre-existing CN, PT, and collection mints with authority
    /// delegated to the config PDA before calling.
    pub fn initialize(ctx: Context<Initialize>, option_duration: u32) -> Result<()> {
        Initialize::handler(ctx, option_duration) // pass argument
    }
    /// deposits SOL, mints CN tokens to the depositor,
    /// and mints PT tokens to the protocol treasury. (NFT minting moved)
    pub fn deposit(mut ctx: Context<Deposit>, amount: u64) -> Result<()> {
        Deposit::assert_protocol_state(&ctx)?;
        Deposit::deposit_sol(&mut ctx, amount)?;
        let tokens_to_mint = Deposit::calculate_tokens_to_mint(&ctx, amount)?;
        Deposit::set_deposit_receipt(&mut ctx, tokens_to_mint)?;
        Deposit::mint_cn_to_depositor(&ctx, tokens_to_mint)?;
        Deposit::mint_pt_to_protocol(&ctx, tokens_to_mint)?;
        Ok(())
    }
    /// initializes the option NFT, metadata, master edition, and OptionData PDA.
    /// this is intended to be called separately before or after deposit.
    pub fn initialize_option(mut ctx: Context<InitializeOption>) -> Result<()> {
        InitializeOption::verify_receipt(&ctx)?;
        InitializeOption::mint_option_to_depositor(&ctx)?;
        InitializeOption::create_option_metadata_account(&ctx)?;
        InitializeOption::verify_mint_with_collection(&ctx)?;
        InitializeOption::set_option_data(&mut ctx)?;
        InitializeOption::increment_config_option_count(&mut ctx)?;
        InitializeOption::update_deposit_receipt(&mut ctx)?;

        msg!(
            "option nft initialized and added to collection. mint: {}, amount: {}, expiration: {}",
            ctx.accounts.option_mint.key(),
            ctx.accounts.deposit_receipt.amount,
            ctx.accounts.deposit_receipt.expiration
        );
        Ok(())
    }

    /// burns user's CN tokens and NFT option, mints PT tokens to the user,
    /// and closes the OptionData account.
    pub fn convert(ctx: Context<Convert>) -> Result<()> {
        Convert::handler(ctx)
    }

    /// updates the protocol locks (global, deposit, convert).
    /// only callable by the config authority.
    pub fn update_locks(
        ctx: Context<UpdateLocks>,
        locked: Option<bool>,
        deposit_locked: Option<bool>,
        convert_locked: Option<bool>,
    ) -> Result<()> {
        UpdateLocks::handler(ctx, locked, deposit_locked, convert_locked)
    }
}
