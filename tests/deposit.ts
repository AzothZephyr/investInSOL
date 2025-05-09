import * as anchor from "@coral-xyz/anchor";
import { Program, Wallet } from "@coral-xyz/anchor";
import { InvestInSol } from "../target/types/invest_in_sol";
import { assert, expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import {
  CN_MINT_ADDRESS,
  PT_MINT_ADDRESS,
  COLLECTION_MINT_ADDRESS,
  initializeProtocol,
  parseAnchorError,
  requestAirdrop,
  updateLocks,
  deposit,
} from "./utils";

describe("deposit instruction (with hardcoded mints)", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.InvestInSol as Program<InvestInSol>;
  const initializer = provider.wallet as Wallet; // use provider's wallet as initializer/authority
  const depositor = Keypair.generate(); // create a new depositor for tests

  const cnMint = CN_MINT_ADDRESS;
  const ptMint = PT_MINT_ADDRESS;
  const collectionMint = COLLECTION_MINT_ADDRESS;

  let configPda: PublicKey;
  let treasuryPda: PublicKey;
  let protocolPtAta: PublicKey; // protocol's ATA for PT

  before(async () => {
    // airdrops
    await requestAirdrop(provider, initializer.publicKey, 2 * LAMPORTS_PER_SOL);
    await requestAirdrop(provider, depositor.publicKey, 2 * LAMPORTS_PER_SOL);

    console.log(`using Initializer: ${initializer.publicKey.toBase58()}`);
    console.log(`using Depositor: ${depositor.publicKey.toBase58()}`);
    console.log(`using CN Mint: ${cnMint.toBase58()}`);
    console.log(`using PT Mint: ${ptMint.toBase58()}`);
    console.log(`using Collection Mint: ${collectionMint.toBase58()}`);

    // initialize protocol using helper (idempotent check inside)
    // important: assumes the hardcoded mints exist and authority is set correctly externally.
    const optionDurationSeconds = 60 * 60 * 24 * 7; // 7 days default for this test
    const initResult = await initializeProtocol(
      program,
      provider,
      initializer.payer,
      cnMint,
      ptMint,
      collectionMint,
      optionDurationSeconds
    );
    configPda = initResult.configPda;
    treasuryPda = initResult.treasuryPda;

    console.log(`config PDA: ${configPda.toBase58()}`);
    console.log(`treasury PDA: ${treasuryPda.toBase58()}`);
  });

  it.only("allows deposit when protocol is unlocked & verifies state changes", async () => {
    console.log("updating locks with config PDA...", configPda);
    await updateLocks(
      program,
      provider,
      initializer.payer,
      configPda,
      false, // set globally unlocked
      false, // set deposits unlocked
      false // set converts unlocked
    );
    const depositAmount = new anchor.BN(1 * LAMPORTS_PER_SOL); // 1 SOL

    // get initial states
    const initialTreasuryBalance = await provider.connection.getBalance(
      treasuryPda
    );
    const initialTreasuryData = await program.account.treasury.fetch(
      treasuryPda
    );
    const initialDepositorSol = await provider.connection.getBalance(
      depositor.publicKey
    );
    let initialProtocolPtAtaBalance = BigInt(0);
    try {
      const acc = await getAccount(provider.connection, protocolPtAta);
      initialProtocolPtAtaBalance = acc.amount;
    } catch (e) {
      /* ATA doesn't exist yet */
    }

    console.log("attempting deposit...");
    // execute deposit
    const { depositorCnAta } = await deposit(
      program,
      provider,
      depositor,
      cnMint,
      ptMint,
      collectionMint,
      depositAmount
    );

    // --- assertions ---
    console.log("verifying state changes...");

    // 1. SOL transfer
    const finalTreasuryBalance = await provider.connection.getBalance(
      treasuryPda
    );
    const finalDepositorSol = await provider.connection.getBalance(
      depositor.publicKey
    );
    assert.strictEqual(
      finalTreasuryBalance,
      initialTreasuryBalance + depositAmount.toNumber(),
      "treasury balance mismatch"
    );
    expect(finalDepositorSol).to.be.lessThan(
      initialDepositorSol - depositAmount.toNumber(),
      "depositor SOL should decrease"
    );

    // 2. CN token mint
    const depositorCnAccount = await getAccount(
      provider.connection,
      depositorCnAta
    );
    assert.strictEqual(
      depositorCnAccount.amount.toString(),
      depositAmount.toString(),
      "depositor CN ATA balance mismatch"
    );

    // 3. PT token mint
    const protocolPtAccount = await getAccount(
      provider.connection,
      protocolPtAta
    );
    assert.strictEqual(
      protocolPtAccount.amount.toString(),
      (
        initialProtocolPtAtaBalance + BigInt(depositAmount.toString())
      ).toString(),
      "protocol PT ATA balance mismatch"
    );

    // 4. removed OptionData PDA assertion

    // 5. treasury state update
    const finalTreasuryData = await program.account.treasury.fetch(treasuryPda);
    assert.strictEqual(
      finalTreasuryData.totalDepositedSol.toString(),
      initialTreasuryData.totalDepositedSol.add(depositAmount).toString(),
      "treasury total_deposited_sol mismatch"
    );

    // 6. removed NFT mint assertion
    console.log("state changes verified.");
  });

  // --- lock tests (using hardcoded mints and utils) ---

  it("fails deposit when protocol is globally locked", async () => {
    console.log("testing global lock...");
    await updateLocks(
      program,
      provider,
      initializer.payer,
      configPda,
      true, // set locked
      false, // set deposits unlocked
      false // set converts unlocked
    );

    const depositAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    try {
      console.log("attempting deposit with global lock...");
      await deposit(
        program,
        provider,
        depositor,
        cnMint,
        ptMint,
        collectionMint,
        depositAmount
      );
      assert.fail("deposit should have failed due to global lock");
    } catch (err) {
      const anchorError = parseAnchorError(err);
      assert.ok(anchorError, "should be an AnchorError (global lock)");
      assert.strictEqual(
        anchorError.error.errorCode.code,
        "ProtocolLocked",
        "error code mismatch (global lock)"
      );
    }
  });

  it("fails deposit when deposits are locked (but protocol unlocked)", async () => {
    console.log("testing deposit lock...");
    await updateLocks(
      program,
      provider,
      initializer.payer,
      configPda,
      false, // set global unlocked
      true, // set deposits locked
      false // set converts unlocked
    );

    const depositAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    try {
      console.log("attempting deposit with deposits locked...");
      await deposit(
        program,
        provider,
        depositor,
        cnMint,
        ptMint,
        collectionMint,
        depositAmount
      );
      assert.fail("deposit should have failed due to deposit lock");
    } catch (err) {
      const anchorError = parseAnchorError(err);
      assert.ok(anchorError, "should be an AnchorError (deposit lock)");
      assert.strictEqual(
        anchorError.error.errorCode.code,
        "DepositsLocked",
        "error code mismatch (deposit lock)"
      );
    }
  });

  after(async () => {
    await updateLocks(
      program,
      provider,
      initializer.payer,
      configPda,
      false,
      false,
      false
    );
    console.log(
      "resetting protocol locks to unlocked state after deposit tests."
    );
  });
});
