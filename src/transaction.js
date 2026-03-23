import {
  pipe,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  address,
  getBase58Decoder,
  AccountRole,
} from "@solana/kit"
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features"

const SYSTEM_PROGRAM = "11111111111111111111111111111111"

/**
 * Detect the Solana chain from an RPC URL.
 *
 * @param {string} rpcUrl - The RPC endpoint URL
 * @returns {string} Chain identifier (e.g. "solana:devnet")
 */
export function detectChain(rpcUrl) {
  if (rpcUrl.includes("devnet")) return "solana:devnet"
  if (rpcUrl.includes("testnet")) return "solana:testnet"
  return "solana:mainnet"
}

/**
 * Build Solana explorer URL for a transaction.
 *
 * @param {string} signature - Transaction signature
 * @param {string} [chain] - Chain identifier (default: "solana:mainnet")
 * @returns {string} Explorer URL
 */
export function explorerUrl(signature, chain = "solana:mainnet") {
  if (chain === "solana:mainnet") {
    return `https://solscan.io/tx/${signature}`
  }
  const cluster = chain === "solana:devnet" ? "devnet" : "testnet"
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`
}

/**
 * Build a SystemProgram.transfer instruction data buffer.
 *
 * @param {number|bigint} lamports - Amount in lamports
 * @returns {Uint8Array} 12-byte instruction data
 */
export function buildTransferData(lamports) {
  const lamportsBI = BigInt(lamports)
  const data = new Uint8Array(12)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, 2, true) // SystemProgram.transfer = instruction index 2
  dv.setUint32(4, Number(lamportsBI & 0xFFFFFFFFn), true)
  dv.setUint32(8, Number(lamportsBI >> 32n), true)
  return data
}

/**
 * Build a SOL transfer instruction.
 *
 * @param {string} sender - Sender wallet address
 * @param {string} recipient - Recipient wallet address
 * @param {number} amountSol - Amount in SOL
 * @returns {object} Instruction object for @solana/kit
 */
export function buildTransferInstruction(sender, recipient, amountSol) {
  const lamports = BigInt(Math.round(amountSol * 1_000_000_000))
  return {
    programAddress: address(SYSTEM_PROGRAM),
    accounts: [
      { address: address(sender), role: AccountRole.WRITABLE_SIGNER },
      { address: address(recipient), role: AccountRole.WRITABLE },
    ],
    data: buildTransferData(lamports)
  }
}

/**
 * Build a custom program instruction from server-provided data.
 * Decodes base64 instruction data and maps account roles.
 *
 * @param {object} params
 * @param {string} params.programId - Program address
 * @param {string} params.instructionData - Base64-encoded instruction data
 * @param {object[]} params.accounts - Account objects with {pubkey, is_signer, is_writable}
 * @returns {object} Instruction object for @solana/kit
 */
export function buildProgramInstruction({ programId, instructionData, accounts }) {
  const data = Uint8Array.from(atob(instructionData), c => c.charCodeAt(0))

  return {
    programAddress: address(programId),
    accounts: accounts.map(a => ({
      address: address(a.pubkey),
      role: mapAccountRole(a)
    })),
    data
  }
}

/**
 * Map server account metadata to @solana/kit AccountRole.
 *
 * @param {object} account - {is_signer: boolean, is_writable: boolean}
 * @returns {number} AccountRole enum value
 */
export function mapAccountRole(account) {
  if (account.is_signer && account.is_writable) return AccountRole.WRITABLE_SIGNER
  if (account.is_signer) return AccountRole.READONLY_SIGNER
  if (account.is_writable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}

/**
 * Compile a transaction with a single instruction into wire-format bytes.
 *
 * @param {object} params
 * @param {string} params.feePayer - Fee payer wallet address
 * @param {string} params.blockhash - Recent blockhash
 * @param {bigint|number} params.lastValidBlockHeight - Last valid block height
 * @param {object} params.instruction - Instruction object from build* functions
 * @param {string} [params.version] - Transaction version ("legacy" or 0, default: 0)
 * @returns {object} Compiled transaction object (can be signed with keypair signers)
 */
export function compileTransactionMessage({ feePayer, blockhash, lastValidBlockHeight, instruction, version = 0 }) {
  const txMessage = pipe(
    createTransactionMessage({ version }),
    tx => setTransactionMessageFeePayer(address(feePayer), tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(
      { blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
      tx
    ),
    tx => appendTransactionMessageInstruction(instruction, tx),
  )

  return compileTransaction(txMessage)
}

/**
 * Convert a compiled transaction to wire-format bytes ready for wallet signing.
 *
 * @param {object} compiled - Compiled transaction from compileTransactionMessage
 * @returns {Uint8Array} Wire-format transaction bytes
 */
export function toWireBytes(compiled) {
  const base64 = getBase64EncodedWireTransaction(compiled)
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

/**
 * Build a complete SOL transfer transaction as wire-format bytes.
 * Convenience function combining buildTransferInstruction + compileTransactionMessage + toWireBytes.
 *
 * @param {object} params
 * @param {string} params.sender - Sender wallet address
 * @param {string} params.recipient - Recipient wallet address
 * @param {number} params.amountSol - Amount in SOL
 * @param {string} params.blockhash - Recent blockhash
 * @param {bigint|number} params.lastValidBlockHeight - Last valid block height
 * @returns {Uint8Array} Wire-format transaction bytes
 */
export function buildTransferTransaction({ sender, recipient, amountSol, blockhash, lastValidBlockHeight }) {
  const instruction = buildTransferInstruction(sender, recipient, amountSol)
  const compiled = compileTransactionMessage({
    feePayer: sender,
    blockhash,
    lastValidBlockHeight,
    instruction
  })
  return toWireBytes(compiled)
}

/**
 * Sign and send a transaction via wallet-standard.
 *
 * @param {object} params
 * @param {object} params.wallet - Wallet-standard wallet object
 * @param {object} params.account - Wallet-standard account object
 * @param {Uint8Array} params.transaction - Wire-format transaction bytes
 * @param {string} [params.chain] - Chain identifier (default: "solana:mainnet")
 * @returns {Promise<string>} Transaction signature as base58 string
 */
export async function signAndSend({ wallet, account, transaction, chain = "solana:mainnet" }) {
  const feature = wallet.features[SolanaSignAndSendTransaction]
  if (!feature) throw new Error("Wallet does not support signAndSendTransaction")

  const [{ signature: sigBytes }] = await feature.signAndSendTransaction({
    account,
    transaction,
    chain,
    options: { skipPreflight: false }
  })

  const decoder = getBase58Decoder()
  return decoder.decode(sigBytes)
}

/**
 * Get the CSRF token from the page meta tag.
 *
 * @returns {string|undefined} CSRF token value
 */
export function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content
}
