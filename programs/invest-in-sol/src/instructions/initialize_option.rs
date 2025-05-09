use anchor_lang::{prelude::*, solana_program};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{mint_to, Mint, MintTo, Token2022, TokenAccount},
};
use mpl_token_metadata::{
    accounts::{MasterEdition, Metadata},
    instructions::{CreateV1CpiBuilder, VerifyCollectionV1CpiBuilder},
    types::{Creator, PrintSupply},
    ID as MPL_TOKEN_METADATA_ID,
};

use crate::state::{Config, DepositReceipt, OptionData};
#[derive(Accounts)]
pub struct InitializeOption<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut, // needs mut to increment option_count
        seeds = [Config::SEED_PREFIX],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [DepositReceipt::SEED_PREFIX, depositor.key().as_ref()],
        bump = deposit_receipt.bump,
    )]
    pub deposit_receipt: Account<'info, DepositReceipt>,

    #[account(
        init,
        seeds = [b"option_mint", depositor.key().as_ref()],
        bump,
        payer = depositor,
        mint::decimals = 0, // NFTs have 0 decimals
        mint::authority = config, // PDA is mint authority
        mint::freeze_authority = config, // PDA is freeze authority
        token::token_program = token_program, // specify token program
    )]
    pub option_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed, // initialize ATA if it doesn't exist
        payer = depositor,
        associated_token::mint = option_mint,
        associated_token::authority = depositor, // user owns the ATA
        token::token_program = token_program, // specify token program
    )]
    pub depositor_option_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: checked via CPI to token metadata program
    #[account(
        mut,
        address = Metadata::find_pda(&option_mint.key()).0 @ ErrorCode::AddressMismatch, // use imported metadata account type
    )]
    pub option_metadata_account: UncheckedAccount<'info>,

    /// CHECK: checked in constraints and CPI
    #[account(
        mut,
        address = MasterEdition::find_pda(&option_mint.key()).0 @ ErrorCode::AddressMismatch,
    )]
    pub option_master_edition: UncheckedAccount<'info>,

    // --- collection accounts ---
    /// CHECK: checked in constraints and CPI
    #[account(
        mut,
        address = config.collection_mint @ ErrorCode::AddressMismatch,
    )]
    pub collection_mint: UncheckedAccount<'info>, // read-only, just need the key

    /// CHECK: checked in constraints and CPI
    #[account(
        mut, // verification might change collection metadata account (e.g., size)
        address = Metadata::find_pda(&collection_mint.key()).0 @ ErrorCode::AddressMismatch,
    )]
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK: checked in constraints and CPI
    #[account(
        mut,
        address = MasterEdition::find_pda(&collection_mint.key()).0 @ ErrorCode::AddressMismatch,
    )]
    pub collection_master_edition: UncheckedAccount<'info>,
    // --- option data PDA ---
    #[account(
        init,
        payer = depositor,
        space = 8 + OptionData::INIT_SPACE,
        seeds = [OptionData::SEED_PREFIX, option_mint.key().as_ref()],
        bump
    )]
    pub option_data: Account<'info, OptionData>,

    // programs
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: address checked
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: Anchor will verify this is the sysvar instruction account
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> InitializeOption<'info> {
    pub fn verify_receipt(ctx: &Context<InitializeOption>) -> Result<()> {
        // 1. check if the deposit receipt is valid
        let deposit_receipt = &ctx.accounts.deposit_receipt;

        // check if the nft has already been issued
        if deposit_receipt.nft_issued {
            return Err(ErrorCode::DepositReceiptIssued.into());
        }

        // check if the deposit receipt is expired
        let current_time = Clock::get()?.unix_timestamp;
        if current_time > deposit_receipt.expiration {
            return Err(ErrorCode::DepositReceiptExpired.into());
        }

        Ok(())
    }

    pub fn mint_option_to_depositor(ctx: &Context<InitializeOption>) -> Result<()> {
        let config_bump = ctx.accounts.config.bump;
        let bump_seed = [config_bump];
        let config_seeds = Config::get_seeds_with_bump(&bump_seed);

        // 1. mint the option NFT to the depositor's ATA
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.option_mint.to_account_info(),
                    to: ctx.accounts.depositor_option_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[&config_seeds[..]],
            ),
            1, // mint 1 NFT
        )
    }

    pub fn create_option_metadata_account(ctx: &Context<InitializeOption>) -> Result<i64> {
        let amount = ctx.accounts.deposit_receipt.amount;
        let expiration = ctx.accounts.deposit_receipt.expiration;

        // format the metadata uri
        let uri = format!(
            "https://metadata.zephyr.haus/metadata/{}/{}",
            amount, expiration
        );
        let config_key = ctx.accounts.config.key();

        let config_bump = ctx.accounts.config.bump;
        let bump_seed = [config_bump];
        let config_seeds = Config::get_seeds_with_bump(&bump_seed);

        // 2. create the metadata account
        CreateV1CpiBuilder::new(&ctx.accounts.token_metadata_program.to_account_info())
            .metadata(&ctx.accounts.option_metadata_account.to_account_info())
            .mint(&ctx.accounts.option_mint.to_account_info(), false)
            .authority(&ctx.accounts.config.to_account_info())
            .payer(&ctx.accounts.depositor.to_account_info())
            .update_authority(&ctx.accounts.config.to_account_info(), true)
            .system_program(&ctx.accounts.system_program.to_account_info())
            .payer(&ctx.accounts.depositor.to_account_info())
            .master_edition(Some(&ctx.accounts.option_master_edition.to_account_info()))
            .spl_token_program(Some(&ctx.accounts.token_program.to_account_info()))
            .sysvar_instructions(&ctx.accounts.sysvar_instructions.to_account_info())
            .name("zOption".into()) // using the updated name
            .symbol("zOption".into()) // using the updated symbol
            .uri(uri.clone())
            .seller_fee_basis_points(0)
            .creators(vec![Creator {
                address: config_key,
                verified: true,
                share: 100,
            }])
            .print_supply(PrintSupply::Zero)
            .invoke_signed(&[&config_seeds[..]])?;

        Ok(expiration)
    }

    pub fn verify_mint_with_collection(ctx: &Context<InitializeOption>) -> Result<()> {
        let config_bump = ctx.accounts.config.bump;
        let bump_seed = [config_bump];
        let config_seeds = Config::get_seeds_with_bump(&bump_seed);

        // 3. set and verify collection item
        msg!("setting and verifying collection item");
        VerifyCollectionV1CpiBuilder::new(&ctx.accounts.token_metadata_program.to_account_info())
            .metadata(&ctx.accounts.option_metadata_account.to_account_info())
            .authority(&ctx.accounts.config.to_account_info())
            .collection_mint(&ctx.accounts.collection_mint.to_account_info())
            .collection_master_edition(Some(
                &ctx.accounts.collection_master_edition.to_account_info(),
            ))
            .collection_metadata(Some(&ctx.accounts.collection_mint.to_account_info()))
            .sysvar_instructions(&ctx.accounts.sysvar_instructions.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .invoke_signed(&[&config_seeds[..]])?;

        Ok(())
    }

    pub fn set_option_data(ctx: &mut Context<InitializeOption>) -> Result<()> {
        let amount = ctx.accounts.deposit_receipt.amount;
        let expiration = ctx.accounts.deposit_receipt.expiration;

        // 4. initialize the option data PDA
        *ctx.accounts.option_data = OptionData {
            mint: ctx.accounts.option_mint.key(),
            owner: ctx.accounts.depositor.key(),
            amount,
            expiration,
            bump: ctx.bumps.option_data,
        };

        Ok(())
    }

    pub fn increment_config_option_count(ctx: &mut Context<InitializeOption>) -> Result<()> {
        // increment the option count in the config account
        ctx.accounts.config.option_count = ctx
            .accounts
            .config
            .option_count
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;
        Ok(())
    }

    pub fn update_deposit_receipt(ctx: &mut Context<InitializeOption>) -> Result<()> {
        // update the deposit receipt to indicate that the NFT has been issued
        ctx.accounts.deposit_receipt.nft_issued = true;
        // mark as uninitialized so the receipt account can be reused
        ctx.accounts.deposit_receipt.initialized = false;
        Ok(())
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("calculation overflow")]
    Overflow,
    #[msg("address mismatch")] // added
    AddressMismatch,
    #[msg("already issued deposit receipt")]
    DepositReceiptIssued,
    #[msg("deposit receipt expired")]
    DepositReceiptExpired,
}
