# solana vanity program deployment & how to update

## initial deployment

1. **build your program**:
   ```bash
   anchor build
   ```

2. **create buffer only**:
   ```bash
   solana program write-buffer ./target/deploy/<PROGRAM NAME>.so
   ```
   *save the returned buffer address*

3. **deploy program from buffer to vanity address**:

   i'm not doing a write up on cavey's vanity tool, you can find it [here](https://github.com/cavemanloverboy/vanity). use his vast.ai ref code pls and drink more water.

## program updates

1. **create new buffer with updated code**:

   ```bash
   anchor build
   solana program write-buffer ./target/deploy/your_program_name.so
   ```

2. **deploy update while preserving vanity address**:

   ```bash
   solana program deploy --buffer <NEW_BUFFER_ADDRESS> --program-id <VANITY_ADDRESS>
   ```

   *use same key from deploy unless you changed upgrade auth*

## notes

- program must be initially deployed as upgradeable (not with `--final` flag)
- wallet used to upgrade must be the designated upgrade authority
- check program details / upgrade authority: `solana program show <VANITY_ADDRESS>`
