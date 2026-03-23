# @solrengine/wallet-utils

Wallet discovery, transaction building, and Stimulus controllers for Solana + Rails apps.

Part of the [SolRengine](https://solrengine.org) framework.

## Install

```sh
yarn add @solrengine/wallet-utils
```

Peer dependencies (already in SolRengine apps):

```sh
yarn add @hotwired/stimulus @hotwired/turbo @solana/kit @solana/wallet-standard-features @wallet-standard/app
```

## Stimulus Controllers

Ready-made controllers for Solana dApps built with Rails + Hotwire.

```js
import { application } from "./application"
import {
  WalletController,
  AutoRefreshController,
  ClipboardController,
  CountdownController
} from "@solrengine/wallet-utils/controllers"

application.register("wallet", WalletController)
application.register("auto-refresh", AutoRefreshController)
application.register("clipboard", ClipboardController)
application.register("countdown", CountdownController)
```

### WalletController

SIWS (Sign In With Solana) authentication. Discovers wallets via Wallet Standard, uses legacy provider for Chrome popup compatibility.

```erb
<div data-controller="wallet"
     data-wallet-nonce-url-value="<%= auth_nonce_path %>"
     data-wallet-verify-url-value="<%= auth_verify_path %>"
     data-wallet-dashboard-url-value="<%= dashboard_path %>">

  <div data-wallet-target="walletList" class="hidden"></div>
  <div data-wallet-target="status" class="hidden"></div>

  <button data-wallet-target="connectBtn"
          data-action="click->wallet#authenticate">
    Connect Wallet
  </button>

  <div data-wallet-target="signing" class="hidden">
    Approve in your wallet...
  </div>
</div>
```

**Values:** `nonceUrl`, `verifyUrl`, `dashboardUrl`
**Targets:** `connectBtn`, `signing`, `status`, `walletList`

### AutoRefreshController

Invisible page refresh using Turbo morphing. Fetches fresh HTML and morphs only changed elements — no loading bar, no scroll reset.

```erb
<div data-controller="auto-refresh" data-auto-refresh-interval-value="60">
  <!-- content morphs every 60 seconds -->
</div>
```

**Values:** `interval` (seconds, default: 60)

### ClipboardController

Copy text to clipboard with visual feedback.

```erb
<button data-controller="clipboard"
        data-clipboard-text-value="<%= @address %>"
        data-action="click->clipboard#copy">
  <span data-clipboard-target="label">Copy</span>
</button>
```

**Values:** `text`
**Targets:** `label`

### CountdownController

Live countdown timer with progress bar. Persists state in sessionStorage to survive morphs and reloads.

```erb
<div data-controller="countdown"
     data-countdown-expires-at-value="<%= lock.exp %>"
     data-countdown-expired-value="false">
  <div data-countdown-target="badge">Locked</div>
  <div data-countdown-target="progress" style="width: 0%"></div>
  <span data-countdown-target="timer">Calculating...</span>
</div>
```

**Values:** `expiresAt` (unix timestamp), `expired` (boolean)
**Targets:** `timer`, `progress`, `badge`

## Wallet Utilities

Functions for wallet discovery and connection.

```js
import {
  discoverWallets,
  findWalletByAddress,
  connectWallet,
  connectWithLegacy,
  getLegacyProvider,
} from "@solrengine/wallet-utils"
```

### findWalletByAddress(address)

Find a wallet + account matching a given address. Tries exposed accounts first, then connects to each wallet.

```js
const { wallet, account } = await findWalletByAddress("Fqgr...HC12")
```

### discoverWallets(feature, onRegister)

List all wallets supporting a given feature. Optionally listen for new wallets.

```js
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features"

const wallets = discoverWallets(SolanaSignAndSendTransaction, (newWallets) => {
  console.log("New wallets:", newWallets)
})
```

### connectWallet(wallet)

Connect to a wallet and return the first account.

```js
const { wallet, account } = await connectWallet(selectedWallet)
```

### getLegacyProvider(walletName)

Get the legacy window provider for Chrome popup compatibility.

```js
const provider = getLegacyProvider("Phantom") // window.phantom.solana
```

## Transaction Utilities

Build and send Solana transactions with `@solana/kit`.

```js
import {
  buildTransferTransaction,
  buildTransferInstruction,
  buildProgramInstruction,
  compileTransactionMessage,
  toWireBytes,
  signAndSend,
  detectChain,
  explorerUrl,
  getCsrfToken,
} from "@solrengine/wallet-utils"
```

### buildTransferTransaction({ sender, recipient, amountSol, blockhash, lastValidBlockHeight })

Build a complete SOL transfer as wire-format bytes, ready for wallet signing.

```js
const txBytes = buildTransferTransaction({
  sender: account.address,
  recipient: "ABC...xyz",
  amountSol: 0.5,
  blockhash,
  lastValidBlockHeight
})
```

### buildProgramInstruction({ programId, instructionData, accounts })

Build a custom program instruction from server-provided data. Decodes base64 instruction data and maps account roles.

```js
const instruction = buildProgramInstruction({
  programId: "ZaU8j...",
  instructionData: response.instruction_data, // base64
  accounts: response.accounts // [{pubkey, is_signer, is_writable}]
})
```

### compileTransactionMessage({ feePayer, blockhash, lastValidBlockHeight, instruction, version })

Compile an instruction into a transaction.

```js
const compiled = compileTransactionMessage({
  feePayer: account.address,
  blockhash,
  lastValidBlockHeight,
  instruction,
  version: "legacy" // or 0
})
```

### signAndSend({ wallet, account, transaction, chain })

Sign and send a transaction via wallet-standard. Returns the signature as a base58 string.

```js
const signature = await signAndSend({
  wallet, account,
  transaction: toWireBytes(compiled),
  chain: "solana:devnet"
})
```

### Helper functions

```js
detectChain("https://api.devnet.solana.com")  // "solana:devnet"
explorerUrl(signature, "solana:devnet")         // "https://explorer.solana.com/tx/...?cluster=devnet"
explorerUrl(signature, "solana:mainnet")         // "https://solscan.io/tx/..."
getCsrfToken()                                   // Rails CSRF token from meta tag
toWireBytes(compiled)                             // compiled transaction → Uint8Array
```

## License

MIT
