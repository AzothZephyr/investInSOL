# Handle Expired Options

The `sync` function is an admin only function that takes an array of mint addresses for NFT Options, checks if they're expired, and, if they're expired, takes the amount that the option was good for and burns that number of protocol tokens. Because we mint 1 PT for each CN token, this function is maintaining the protocol by insuring that the number of PT tokens held in the protocol vault is equal to the number of CN tokens that are available to claim.



```mermaid
graph TD
    subgraph "Admin Sync Function Flow"
        F[Admin calls sync function] -->|"For each mint address"| G[Check NFT Option]
        G -->|"Is expired?"| H{Option Expired?}
        H -->|"Yes"| I[Read amount left]
        H -->|"No"| L[Skip to next option]
        I -->|"Amount > 0?"| J{Amount > 0?}
        J -->|"Yes"| K[Burn that many protocol tokens]
        J -->|"No"| L
        K --> M[Update NFT metadata to expired]
        M --> N[Continue to next mint address]
    end

    %% Description notes
    classDef note fill:#f9f,stroke:#333,stroke-width:1px
```