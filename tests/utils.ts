import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { InvestInSol } from "../target/types/invest_in_sol";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

export const CN_MINT_ADDRESS = new PublicKey(
  "FrDk5Zev998uhC1qDwx63b91JgQ8oy8uWEkPdeePV4oZ"
);
export const PT_MINT_ADDRESS = new PublicKey(
  "7ScNEUHZThdv5zMQfAAwnRMDNTh6VbKmXNYvinnFdhjR"
);
// NOTE: the below is the same as the PT mint to get around a non-base58 error and progress through the tests until i create collection on devnet
export const COLLECTION_MINT_ADDRESS = new PublicKey(
  "9p3TMAkB93PHP2j6461BMA8R8S7ob9SNtd3joYLqVDQM"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  MPL_TOKEN_METADATA_PROGRAM_ID
); // ensure it's a PublicKey object

/**
 * finds the metadata PDA for a given mint.
 */
export function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * finds the master edition PDA for a given mint.
 */
export function findMasterEditionPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * initializes the protocol if it hasn't been already.
 * assumes the provided mint public keys correspond to existing mints.
 * the initializer keypair must have authority to create the PDAs.
 */
export async function initializeProtocol(
  program: Program<InvestInSol>,
  provider: anchor.AnchorProvider,
  initializer: Keypair, // use Keypair as it needs to sign
  cnMintPk: PublicKey,
  ptMintPk: PublicKey,
  collectionMintPk: PublicKey,
  optionDurationSeconds: number
): Promise<{ configPda: PublicKey; treasuryPda: PublicKey }> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  const configInfo = await provider.connection.getAccountInfo(configPda);

  if (configInfo === null) {
    console.log("getting mint account for CN mint...", cnMintPk.toBase58());
    // make sure our config is the authority for the mints
    let cnMintAccount = await getMint(
      provider.connection,
      cnMintPk,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    if (cnMintAccount.mintAuthority.toBase58() !== configPda.toBase58()) {
      const tx = new Transaction().add(
        createSetAuthorityInstruction(
          cnMintPk,
          initializer.publicKey,
          AuthorityType.MintTokens,
          configPda,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      const sig = await provider.connection.sendTransaction(tx, [initializer], {
        skipPreflight: true,
      });
      await confirmTransaction(provider, sig);
    }

    let ptMintAccount = await getMint(
      provider.connection,
      ptMintPk,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    if (ptMintAccount.mintAuthority.toBase58() !== configPda.toBase58()) {
      const tx = new Transaction().add(
        createSetAuthorityInstruction(
          ptMintPk,
          initializer.publicKey,
          AuthorityType.MintTokens,
          configPda,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      const sig = await provider.connection.sendTransaction(tx, [initializer]);
      await confirmTransaction(provider, sig);
    }

    let collectionMintAccount = await getMint(
      provider.connection,
      collectionMintPk,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    if (
      collectionMintAccount.mintAuthority.toBase58() !== configPda.toBase58()
    ) {
      const tx = new Transaction().add(
        createSetAuthorityInstruction(
          collectionMintPk,
          initializer.publicKey,
          AuthorityType.MintTokens,
          configPda,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      const sig = await provider.connection.sendTransaction(tx, [initializer]);
      await confirmTransaction(provider, sig);
    }

    console.log(`initializing protocol (Config: ${configPda.toBase58()})...`);
    const tx = await program.methods
      .initialize(optionDurationSeconds)
      .accountsStrict({
        initializer: initializer.publicKey,
        cnMint: cnMintPk,
        ptMint: ptMintPk,
        collectionMint: collectionMintPk,
        config: configPda,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .transaction();
    await sendAndConfirmTransaction(provider, tx, initializer.publicKey, [
      initializer,
    ]);
  } else {
    console.log("protocol already initialized.");
  }
  return { configPda, treasuryPda };
}

export async function updateLocks(
  program: Program<InvestInSol>,
  provider: anchor.AnchorProvider,
  initializer: Keypair,
  configPda: PublicKey,
  setLocked: boolean | null,
  setDepositLocked: boolean | null,
  setConvertLocked: boolean | null
) {
  console.log(`updating protocol (Config: ${configPda.toBase58()})...`);
  if (setLocked !== null) {
    console.log("Setting protocol locked state to:", setLocked);
  }
  if (setDepositLocked !== null) {
    console.log("Setting deposit locked state to:", setDepositLocked);
  }
  if (setConvertLocked !== null) {
    console.log("Setting convert locked state to:", setConvertLocked);
  }
  const tx = await program.methods
    .updateLocks(setLocked, setDepositLocked, setConvertLocked)
    .accountsStrict({
      authority: initializer.publicKey,
      config: configPda,
    })
    .transaction();
  await sendAndConfirmTransaction(provider, tx, initializer.publicKey, [
    initializer,
  ]);
}

export async function deposit(
  program: Program<InvestInSol>,
  provider: anchor.AnchorProvider,
  depositor: Keypair,
  cnMint: PublicKey,
  ptMint: PublicKey,
  collectionMint: PublicKey,
  depositAmount: anchor.BN
): Promise<{
  optionMint: PublicKey;
  optionAta: PublicKey;
  depositorOptionAta: PublicKey;
  protocolPtAta: PublicKey;
  depositorCnAta: PublicKey;
}> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );

  const [optionMint] = await PublicKey.findProgramAddressSync(
    [Buffer.from("option_mint"), depositor.publicKey.toBuffer()],
    program.programId
  );
  const depositorOptionAta = await getAssociatedTokenAddress(
    optionMint,
    depositor.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const optionMetadataAccount = findMetadataPda(optionMint);
  const optionMasterEdition = findMasterEditionPda(optionMint);
  const collectionMasterEdition = findMasterEditionPda(collectionMint);
  const collectionMetadata = findMetadataPda(collectionMint);

  const protocolPtAta = await getAssociatedTokenAddress(
    ptMint,
    configPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const depositorCnAta = await getAssociatedTokenAddress(
    cnMint,
    depositor.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const [optionData] = PublicKey.findProgramAddressSync(
    [Buffer.from("option_data"), optionMint.toBuffer()],
    program.programId
  );

  const [depositReceiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_receipt"), depositor.publicKey.toBuffer()],
    program.programId
  );

  const depositIx = await program.methods
    .deposit(depositAmount)
    .accountsStrict({
      depositor: depositor.publicKey,
      depositReceipt: depositReceiptPda,
      depositorSolAccount: depositor.publicKey,
      depositorCnAta: depositorCnAta,
      config: configPda,
      treasury: treasuryPda,
      cnMint: cnMint,
      ptMint: ptMint,
      protocolPtAta: protocolPtAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const accounts = {
    depositor: depositor.publicKey,
    config: configPda,
    depositReceipt: depositReceiptPda,
    optionMint,
    depositorOptionAta,
    optionMetadataAccount,
    collectionMint,
    collectionMetadata,
    collectionMasterEdition,
    optionData,
    optionMasterEdition,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
    sysvarInstructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
  };
  console.log("accounts:", accounts);
  const initializeOptionIx = await program.methods
    .initializeOption()
    .accountsStrict(accounts)
    .instruction();

  const tx = new Transaction().add(depositIx, initializeOptionIx);

  console.log("Sending deposit transaction...");
  await sendAndConfirmTransaction(provider, tx, depositor.publicKey, [
    depositor,
  ]);
  return {
    optionMint,
    optionAta: depositorOptionAta,
    depositorOptionAta,
    protocolPtAta,
    depositorCnAta,
  };
}

/**
 * parses AnchorError from transaction error object.
 */
export function parseAnchorError(err: any): anchor.AnchorError | null {
  if (err instanceof anchor.AnchorError) return err;
  // basic parsing attempt from logs (may need refinement)
  const logs = err.transactionMessage?.split("\n") || err.logs || null;
  const errorLogs = logs?.find((log: string) =>
    log.includes("Program log: AnchorError")
  );

  if (errorLogs) {
    try {
      const parts = errorLogs.split(". Error Code: ");
      const codeParts = parts[1]?.split(". Error Number: ") || [];
      const errorCode = {
        code: codeParts[0],
        number: parseInt(codeParts[1]?.split(".")[0] || "0"),
      };
      const errorMessage = err.logs
        ?.find((log: string) => log.includes("Program log: Error Message:"))
        ?.split("Error Message: ")[1];
      return { error: { errorCode, errorMessage } } as anchor.AnchorError; // cast for assertion usage
    } catch (parseError) {
      console.error("failed to parse AnchorError from logs:", parseError);
    }
  }
  return null;
}

export async function sendAndConfirmTransaction(
  provider: anchor.AnchorProvider,
  transaction: anchor.web3.Transaction,
  payer: PublicKey,
  signers: Array<anchor.web3.Signer>,
  options?: anchor.web3.ConfirmOptions
) {
  transaction.recentBlockhash = (
    await provider.connection.getLatestBlockhash()
  ).blockhash;
  transaction.feePayer = payer;
  for (const signer of signers) {
    transaction.partialSign(signer);
  }
  const tx = await transaction.serialize();
  const sig = await provider.connection.sendRawTransaction(tx, options);
  await confirmTransaction(provider, sig);
}

/**
 * Helper to wait for a transaction to be confirmed. Used to avoid pinging surfpool over websockets.
 */
export async function confirmTransaction(
  provider: anchor.AnchorProvider,
  signature: string
) {
  let confirmed = false;
  while (confirmed == false) {
    let status = await provider.connection.getSignatureStatus(signature);
    if (status.value.err) {
      throw new Error(
        `Transaction failed: ${signature}, error: ${JSON.stringify(
          status.value.err
        )}`
      );
    }
    if (
      status.value.confirmationStatus == "confirmed" ||
      status.value.confirmationStatus == "finalized"
    ) {
      confirmed = true;
    }
  }
}

/**
 * helper to request and confirm an airdrop.
 */
export async function requestAirdrop(
  provider: AnchorProvider,
  publicKey: PublicKey,
  lamports: number
): Promise<void> {
  try {
    console.log(
      `requesting ${
        lamports / LAMPORTS_PER_SOL
      } SOL for ${publicKey.toBase58()}...`
    );
    const signature = await provider.connection.requestAirdrop(
      publicKey,
      lamports
    );
    confirmTransaction(provider, signature);
    console.log(`airdrop confirmed for ${publicKey.toBase58()}.`);
  } catch (error) {
    console.error(`airdrop failed for ${publicKey.toBase58()}:`, error);
  }
}
