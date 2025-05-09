import { PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, Keypair } from '@solana/web3.js';
import { connection, wallet, logSignature } from './utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  percentAmount,
  signerIdentity,
  createSignerFromKeypair,
  keypairIdentity,
  publicKey as umiPublicKey
} from '@metaplex-foundation/umi'
import {
  createV1,
  TokenStandard,
} from '@metaplex-foundation/mpl-token-metadata';

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

const umi = createUmi("https://api.devnet.solana.com");

export async function createCollection(
    programId: PublicKey
) {
    /// ------------------------------------------------------------------------
    // create parent collection NFT (zOPTION)
    /// ------------------------------------------------------------------------
    console.log('\n1. creating zOption option collection NFT...');
    
    // Derive PDA for program authority
    const [authorityPDA, authorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        programId
    );
    // read keypair from $HOME/.config/solana/devnet.json
    // set as keypair used to pay / set 
    const homeDir = os.homedir();
    const keypairPath = path.join(homeDir, '.config', 'solana', 'devnet.id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    const payerUMIKeypair = umi.eddsa.createKeypairFromSecretKey(payerKeypair.secretKey);
    const payer = createSignerFromKeypair(umi, payerUMIKeypair);
    umi.use(keypairIdentity(payer));

    const keypair = Keypair.generate()
    const mintKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey);
    const mintSigner = createSignerFromKeypair(umi, mintKeypair);

    // convert the Solana PublicKey to UMI PublicKey
    const programUmiPubkey = umiPublicKey(programId.toBase58());
    
    // find PDA using UMI's findPda method
    const authorityPda = umi.eddsa.findPda(programUmiPubkey, [
      Buffer.from("config")
    ]);
    
    console.log(`Authority PDA from UMI: ${authorityPda[0].toString()}`);
    // this sets the collection to being a collection, we need to call VerifyCollectionV1 on initialization
    // to make a call where config pda signs the master nft to verify it
    const signature = await createV1(umi, {
        mint: mintSigner,
        authority: payer,
        updateAuthority: payer,
        name: 'zOption Collection',
        symbol: 'zOPTION',
        uri: 'https://example.com/my-collection.json',
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.NonFungible,
        isCollection: true
    }).sendAndConfirm(umi);
    
    // Convert the transaction signature to a string
    logSignature(signature.signature.toString());

    // The PDA is already set as the update authority in the createV1 call
    console.log('\n2. Authority information:');
    console.log(`   Collection NFT Initialized: ${mintSigner.publicKey.toString()}`);
    console.log(`   Update Authority (PDA): ${payer.toString()}`);
    console.log(`   Config PDA: ${authorityPDA.toString()}`);
}