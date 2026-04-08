import nacl from "tweetnacl"

// Base58 alphabet (Bitcoin/Solana standard)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE = BigInt(58)

function bs58encode(bytes) {
  let num = BigInt(0)
  for (const b of bytes) num = num * 256n + BigInt(b)

  let str = ""
  while (num > 0n) {
    str = ALPHABET[Number(num % BASE)] + str
    num /= BASE
  }

  // Preserve leading zeros
  for (const b of bytes) {
    if (b !== 0) break
    str = "1" + str
  }

  return str || "1"
}

function bs58decode(str) {
  let num = BigInt(0)
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`Invalid base58 character: ${ch}`)
    num = num * BASE + BigInt(idx)
  }

  const hex = num === 0n ? "" : num.toString(16).padStart(2, "0")
  const rawBytes = hex.match(/.{1,2}/g)?.map(h => parseInt(h, 16)) || []

  // Preserve leading zeros
  const leadingOnes = str.match(/^1*/)[0].length
  const result = new Uint8Array(leadingOnes + rawBytes.length)
  result.set(rawBytes, leadingOnes)

  return result
}

const PHANTOM_URL = "https://phantom.app/ul/v1"
const STORAGE_KEY = "solrengine_deeplink"

/**
 * Check if the current device is mobile (no browser extensions available).
 */
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/**
 * Get the current deep link session state from localStorage.
 * Returns null if no session exists.
 */
export function getDeeplinkState() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored ? JSON.parse(stored) : null
}

/**
 * Clear the deep link session from localStorage.
 */
export function clearDeeplinkSession() {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Build a Phantom connect deep link URL.
 * Generates an X25519 keypair and stores it in localStorage for later decryption.
 *
 * @param {Object} options
 * @param {string} options.appUrl - The dApp URL (used by Phantom for session validation)
 * @param {string} options.redirectLink - URL to redirect back to after connect
 * @param {string} [options.cluster] - Solana cluster (default: mainnet-beta)
 * @param {Object} [options.authConfig] - Auth URLs to persist across redirects
 * @returns {string} The Phantom connect deep link URL
 */
export function buildConnectUrl({ appUrl, redirectLink, cluster = "mainnet-beta", authConfig }) {
  const keypair = nacl.box.keyPair()

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    step: "connect",
    secretKey: Array.from(keypair.secretKey),
    publicKey: Array.from(keypair.publicKey),
    authConfig
  }))

  const params = new URLSearchParams({
    app_url: appUrl,
    dapp_encryption_public_key: bs58encode(keypair.publicKey),
    redirect_link: redirectLink,
    cluster
  })

  return `${PHANTOM_URL}/connect?${params}`
}

/**
 * Handle the redirect response from Phantom connect.
 * Decrypts the response to get the user's public key and session token.
 *
 * @param {URLSearchParams} urlParams - The URL search params from the redirect
 * @returns {{ publicKey: string, session: string, authConfig: Object } | null}
 */
export function handleConnectResponse(urlParams) {
  const stored = getDeeplinkState()
  if (!stored || stored.step !== "connect") return null

  // Check for error response
  if (urlParams.has("errorCode")) {
    clearDeeplinkSession()
    throw new Error(urlParams.get("errorMessage") || "Connection rejected")
  }

  const phantomPubKey = bs58decode(urlParams.get("phantom_encryption_public_key"))
  const nonce = bs58decode(urlParams.get("nonce"))
  const encryptedData = bs58decode(urlParams.get("data"))

  const secretKey = new Uint8Array(stored.secretKey)
  const sharedSecret = nacl.box.before(phantomPubKey, secretKey)

  const decrypted = nacl.box.open.after(encryptedData, nonce, sharedSecret)
  if (!decrypted) {
    clearDeeplinkSession()
    throw new Error("Failed to decrypt Phantom connect response")
  }

  const { public_key, session } = JSON.parse(new TextDecoder().decode(decrypted))

  // Persist state for signMessage step
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    step: "connected",
    secretKey: stored.secretKey,
    publicKey: stored.publicKey,
    phantomPublicKey: Array.from(phantomPubKey),
    sharedSecret: Array.from(sharedSecret),
    session,
    walletAddress: public_key,
    authConfig: stored.authConfig
  }))

  return { publicKey: public_key, session, authConfig: stored.authConfig }
}

/**
 * Build a Phantom signMessage deep link URL.
 * Encrypts the SIWS message using the shared secret from the connect step.
 *
 * @param {Object} options
 * @param {Uint8Array} options.message - The message bytes to sign
 * @param {string} options.redirectLink - URL to redirect back to after signing
 * @returns {string} The Phantom signMessage deep link URL
 */
export function buildSignMessageUrl({ message, redirectLink }) {
  const stored = getDeeplinkState()
  if (!stored || !stored.session) throw new Error("No active deep link session")

  const sharedSecret = new Uint8Array(stored.sharedSecret)
  const dappPubKey = new Uint8Array(stored.publicKey)

  const payload = JSON.stringify({
    message: bs58encode(message),
    session: stored.session,
    display: "utf8"
  })

  const nonce = nacl.randomBytes(24)
  const encrypted = nacl.box.after(
    new TextEncoder().encode(payload),
    nonce,
    sharedSecret
  )

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...stored,
    step: "signing"
  }))

  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58encode(dappPubKey),
    nonce: bs58encode(nonce),
    redirect_link: redirectLink,
    payload: bs58encode(encrypted)
  })

  return `${PHANTOM_URL}/signMessage?${params}`
}

/**
 * Handle the redirect response from Phantom signMessage.
 * Decrypts the response to get the signature bytes.
 *
 * @param {URLSearchParams} urlParams - The URL search params from the redirect
 * @returns {{ signature: Uint8Array, walletAddress: string, authConfig: Object } | null}
 */
export function handleSignMessageResponse(urlParams) {
  const stored = getDeeplinkState()
  if (!stored || stored.step !== "signing") return null

  // Check for error response
  if (urlParams.has("errorCode")) {
    clearDeeplinkSession()
    throw new Error(urlParams.get("errorMessage") || "Signing rejected")
  }

  const nonce = bs58decode(urlParams.get("nonce"))
  const encryptedData = bs58decode(urlParams.get("data"))
  const sharedSecret = new Uint8Array(stored.sharedSecret)

  const decrypted = nacl.box.open.after(encryptedData, nonce, sharedSecret)
  if (!decrypted) {
    clearDeeplinkSession()
    throw new Error("Failed to decrypt Phantom signature response")
  }

  const { signature } = JSON.parse(new TextDecoder().decode(decrypted))
  const walletAddress = stored.walletAddress
  const authConfig = stored.authConfig

  clearDeeplinkSession()

  return { signature: bs58decode(signature), walletAddress, authConfig }
}
