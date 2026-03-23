import { getWallets } from "@wallet-standard/app"
import { SolanaSignMessage } from "@solana/wallet-standard-features"
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features"

// Legacy window providers for Chrome popup workaround.
// Chrome only allows extension popups within a direct user action,
// so we call the legacy provider.connect() first to preserve the gesture.
const LEGACY_PROVIDERS = {
  phantom: () => window.phantom?.solana || window.solana,
  solflare: () => window.solflare,
  backpack: () => window.backpack
}

/**
 * Get the legacy window provider for a wallet by name.
 * Returns null if no legacy provider is available.
 *
 * @param {string} walletName - The wallet name (e.g. "Phantom", "Solflare")
 * @returns {object|null} The legacy provider object
 */
export function getLegacyProvider(walletName) {
  const name = walletName.toLowerCase()
  for (const [key, getter] of Object.entries(LEGACY_PROVIDERS)) {
    if (name.includes(key)) return getter()
  }
  return null
}

/**
 * Discover all wallets that support a given feature.
 * Returns immediately with currently registered wallets and calls onRegister
 * when new wallets are registered.
 *
 * @param {string} feature - The wallet feature to filter by (default: SolanaSignMessage)
 * @param {function} [onRegister] - Callback when new wallets are discovered
 * @returns {object[]} Array of wallet-standard wallet objects
 */
export function discoverWallets(feature = SolanaSignMessage, onRegister) {
  const { get, on } = getWallets()
  const wallets = get().filter(w => w.features[feature])

  if (onRegister) {
    on("register", (...newWallets) => {
      const matching = newWallets.filter(w => w.features[feature])
      if (matching.length > 0) onRegister(matching)
    })
  }

  return wallets
}

/**
 * Find a wallet-standard wallet + account that matches a given address.
 * Tries existing accounts first, then connects to each wallet to expose accounts.
 *
 * @param {string} targetAddress - The wallet address to find
 * @param {string} [feature] - Required wallet feature (default: SolanaSignAndSendTransaction)
 * @returns {Promise<{wallet: object, account: object}>}
 * @throws {Error} If no wallet matches the address
 */
export async function findWalletByAddress(targetAddress, feature = SolanaSignAndSendTransaction) {
  const { get } = getWallets()
  const wallets = get()

  // First pass: check already-exposed accounts
  for (const wallet of wallets) {
    if (!wallet.features[feature]) continue
    const account = wallet.accounts.find(a => a.address === targetAddress)
    if (account) return { wallet, account }
  }

  // Second pass: connect to expose accounts
  for (const wallet of wallets) {
    if (!wallet.features[feature]) continue
    if (!wallet.features["standard:connect"]) continue

    try {
      const { accounts } = await wallet.features["standard:connect"].connect()
      const account = accounts?.find(a => a.address === targetAddress)
      if (account) return { wallet, account }
    } catch {
      // User rejected or wallet doesn't have this account — try next
    }
  }

  const short = `${targetAddress.slice(0, 4)}...${targetAddress.slice(-4)}`
  throw new Error(
    `No wallet found for address ${short}. Please switch to the correct account in your wallet.`
  )
}

/**
 * Connect to a wallet and return the first account.
 * Used when you don't know the address yet (e.g. donations).
 *
 * @param {object} wallet - A wallet-standard wallet object
 * @returns {Promise<{wallet: object, account: object}>}
 * @throws {Error} If connection fails or no accounts returned
 */
export async function connectWallet(wallet) {
  const connectFeature = wallet.features["standard:connect"]
  if (!connectFeature) throw new Error("Wallet does not support connect")

  const { accounts } = await connectFeature.connect()
  if (!accounts?.length) throw new Error("No accounts found")

  return { wallet, account: accounts[0] }
}

/**
 * Sign a message using the legacy provider (preserving user gesture) or wallet-standard.
 * Legacy provider is preferred because Chrome requires popups to be triggered
 * by direct user actions.
 *
 * @param {object} wallet - Wallet-standard wallet object
 * @param {Uint8Array} messageBytes - The message bytes to sign
 * @param {object} [account] - Wallet-standard account (required if no legacy provider)
 * @returns {Promise<Uint8Array>} The signature bytes
 */
export async function signMessageWithLegacy(wallet, messageBytes, account) {
  const provider = getLegacyProvider(wallet.name)

  if (provider) {
    const isPhantom = provider.isPhantom === true
    const result = isPhantom
      ? await provider.signMessage(messageBytes, "utf8")
      : await provider.signMessage(messageBytes)

    if (result instanceof Uint8Array) return result
    if (result?.signature) return new Uint8Array(result.signature)
    return new Uint8Array(result)
  }

  // Fallback to wallet-standard
  if (!account) throw new Error("No account provided for wallet-standard signing")
  const signFeature = wallet.features[SolanaSignMessage]
  const [{ signature }] = await signFeature.signMessage({ account, message: messageBytes })
  return new Uint8Array(signature)
}

/**
 * Connect via legacy provider and return the public key.
 * Falls back to wallet-standard if no legacy provider is available.
 *
 * @param {object} wallet - Wallet-standard wallet object
 * @returns {Promise<{publicKey: string, signMessage: function}>}
 */
export async function connectWithLegacy(wallet) {
  const provider = getLegacyProvider(wallet.name)

  if (provider) {
    const response = await provider.connect()
    const pk = response?.publicKey || provider.publicKey
    if (!pk) throw new Error("Wallet connected but no public key returned")

    const publicKey = pk.toString()
    const signMessage = async (messageBytes) => {
      return signMessageWithLegacy(wallet, messageBytes)
    }

    return { publicKey, signMessage }
  }

  // Wallet-standard fallback
  const connectFeature = wallet.features["standard:connect"]
  const { accounts } = await connectFeature.connect()
  if (!accounts?.length) throw new Error("No accounts returned. Please unlock your wallet.")

  const account = accounts[0]
  const publicKey = account.address
  const signMessage = async (messageBytes) => {
    return signMessageWithLegacy(wallet, messageBytes, account)
  }

  return { publicKey, signMessage }
}
