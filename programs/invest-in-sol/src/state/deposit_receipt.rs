use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct DepositReceipt {
    /// Whether this receipt has been initialized.
    /// Used to ensure we don't have multiple deposits for the same user before they claim the NFT.
    pub initialized: bool,
    /// Whether this receipt has been used to claim the Option NFT.
    pub nft_issued: bool,
    /// The amount of SOL deposited by the user.
    pub amount: u64,
    /// The expiration for the Option NFT in seconds since the Unix epoch.
    pub expiration: i64,
    /// The bump used to generate this DepositReceipt account.
    pub bump: u8,
}

impl DepositReceipt {
    pub const SEED_PREFIX: &'static [u8] = b"deposit_receipt";

    pub fn get_seeds<'a>(depositor_keypair_bytes: &'a [u8]) -> [&'a [u8]; 2] {
        [Self::SEED_PREFIX, depositor_keypair_bytes]
    }

    pub fn get_seeds_with_bump<'a>(
        depositor_keypair_bytes: &'a [u8],
        bump: &'a [u8],
    ) -> [&'a [u8]; 3] {
        [Self::SEED_PREFIX, depositor_keypair_bytes, bump]
    }
}
