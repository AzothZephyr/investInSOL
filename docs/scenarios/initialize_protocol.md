# Initialize protocol

Initialize: 

The initialize function is used to initialize the protocol. It is payable, creates a PDA, creates and mints the initial CN / PT based on the amount paid, initializes the nft and mints the first one, and set initial values for the vault account.

```mermaid
graph TD
    A[Start Initialization] --> B[Create Token Accounts for Protocol Tokens]
    
    subgraph "Token Setup"
        B --> G[Initialize CN Token]
        B --> H[Initialize PT Token]
        B --> I[Initialize NFT Metadata]
        G --> Z[Mint to creator based on value deposited]
        H --> Z
        I --> Z
    end
    
    Z --> F[Create Vault PDA]
    
    subgraph "Configure Protocol State"
        F --> J[Set Initial NAV]
        J --> K[Set Treasury Parameters]
        K --> L[Set Token Fields]
        L --> M[Set Lending/LP Parameters]
        M --> N[Set Admin Authority]
        N --> O[Finalize Initialization]
    end
    
    classDef primary fill:#d0e0ff,stroke:#3366ff,stroke-width:2px
    classDef secondary fill:#ffffdd,stroke:#b9944f,stroke-width:2px
    
    class A,B,Z,F,O primary
    class J,K,L,M,N secondary
    
 
    
    %% Style settings for better readability
    style A color:black
    style B color:black
    style F color:black
    style J color:black
    style K color:black
    style L color:black
    style M color:black
    style N color:black
    style O color:black
    style Z color:black
```