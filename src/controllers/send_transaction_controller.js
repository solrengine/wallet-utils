import { Controller } from "@hotwired/stimulus"
import { getWallets } from "@wallet-standard/app"
import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features"
import { buildTransferTransaction, signAndSend, explorerUrl } from "../transaction.js"

// SendTransactionController — client-side SOL transfer flow.
//
// Intercepts the SendTransactionFormComponent submit, fetches a recent
// blockhash from the configured RPC, builds a System Program transfer with
// @solana/kit, asks the connected wallet to sign and send via the
// Wallet Standard `solana:signAndSendTransaction` feature, and renders a
// status message with a link to the explorer on success.
//
// No server-side endpoint is involved — the Rails app only serves the form.
// The wallet already has the user's keypair; the server has nothing to add.
export default class extends Controller {
  static targets = ["recipient", "amount", "status", "submit"]
  static values = {
    walletAddress: String,
    rpcUrl: String,
    chain: { type: String, default: "solana:mainnet" }
  }

  async send(event) {
    event.preventDefault()

    const recipient = this.hasRecipientTarget ? this.recipientTarget.value.trim() : ""
    const amountSol = this.hasAmountTarget ? parseFloat(this.amountTarget.value) : NaN

    if (!recipient) return this.showStatus("Recipient address is required.", "error")
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return this.showStatus("Amount must be greater than zero.", "error")
    }
    if (!this.walletAddressValue) {
      return this.showStatus("No wallet connected.", "error")
    }
    if (!this.rpcUrlValue) {
      return this.showStatus("RPC URL not configured.", "error")
    }

    this.setSubmitting(true)
    this.showStatus("Building transaction…", "info")

    try {
      const { wallet, account } = await this.findWalletAccount()
      const { blockhash, lastValidBlockHeight } = await this.fetchLatestBlockhash()

      const transaction = buildTransferTransaction({
        sender: this.walletAddressValue,
        recipient,
        amountSol,
        blockhash,
        lastValidBlockHeight
      })

      this.showStatus("Confirm in your wallet…", "info")
      const signature = await signAndSend({ wallet, account, transaction, chain: this.chainValue })

      const url = explorerUrl(signature, this.chainValue)
      this.showSuccess(`Sent ${amountSol} SOL`, signature, url)
      if (this.hasRecipientTarget) this.recipientTarget.value = ""
      if (this.hasAmountTarget) this.amountTarget.value = ""
    } catch (error) {
      this.showStatus(this.humanizeError(error), "error")
    } finally {
      this.setSubmitting(false)
    }
  }

  // Find the user's wallet + matching account via Wallet Standard.
  // The user has already connected once (SIWS), so the account is known —
  // we just need a live reference to it now.
  async findWalletAccount() {
    const { get } = getWallets()
    const wallets = get()

    for (const wallet of wallets) {
      if (!wallet.features[SolanaSignAndSendTransaction]) continue
      const connectFeature = wallet.features["standard:connect"]
      if (!connectFeature) continue

      try {
        const { accounts } = await connectFeature.connect({ silent: true })
        const account = accounts?.find(a => a.address === this.walletAddressValue)
        if (account) return { wallet, account }
      } catch {
        // wallet refused silent connect — try the next one
      }
    }

    throw new Error(`No connected wallet found for ${this.truncate(this.walletAddressValue)}. Please reconnect.`)
  }

  // Minimal JSON-RPC call — we don't want to bring in a full RPC client here.
  async fetchLatestBlockhash() {
    const response = await fetch(this.rpcUrlValue, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }]
      })
    })

    if (!response.ok) throw new Error(`RPC request failed: HTTP ${response.status}`)
    const payload = await response.json()
    if (payload.error) throw new Error(`RPC error: ${payload.error.message || payload.error}`)
    return payload.result.value
  }

  setSubmitting(busy) {
    if (!this.hasSubmitTarget) return
    this.submitTarget.disabled = busy
    if (busy) {
      this.submitTarget.dataset.originalLabel ||= this.submitTarget.textContent
      this.submitTarget.textContent = "Sending…"
    } else if (this.submitTarget.dataset.originalLabel) {
      this.submitTarget.textContent = this.submitTarget.dataset.originalLabel
    }
  }

  showStatus(message, type = "info") {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = message
    this.statusTarget.className = this.statusClassName(type)
    this.statusTarget.classList.remove("hidden")
  }

  showSuccess(message, signature, url) {
    if (!this.hasStatusTarget) return
    this.statusTarget.replaceChildren()
    this.statusTarget.className = this.statusClassName("success")
    this.statusTarget.classList.remove("hidden")

    const text = document.createElement("span")
    text.textContent = `${message} · `
    this.statusTarget.appendChild(text)

    const link = document.createElement("a")
    link.href = url
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.className = "underline hover:opacity-80"
    link.textContent = `${signature.slice(0, 8)}…${signature.slice(-8)}`
    this.statusTarget.appendChild(link)
  }

  statusClassName(type) {
    const base = "mt-3 p-3 rounded-lg text-sm"
    switch (type) {
      case "success": return `${base} bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800`
      case "error":   return `${base} bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800`
      default:        return `${base} bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800`
    }
  }

  humanizeError(error) {
    const message = error?.message || String(error)
    if (message.includes("User rejected") || message.toLowerCase().includes("cancelled")) {
      return "Transaction cancelled."
    }
    return message
  }

  truncate(address) {
    if (!address || address.length < 12) return address
    return `${address.slice(0, 4)}…${address.slice(-4)}`
  }
}
