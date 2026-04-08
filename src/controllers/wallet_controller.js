import { Controller } from "@hotwired/stimulus"
import { getWallets } from "@wallet-standard/app"
import { SolanaSignMessage } from "@solana/wallet-standard-features"
import {
  isMobileDevice,
  getDeeplinkState,
  clearDeeplinkSession,
  buildConnectUrl,
  handleConnectResponse,
  buildSignMessageUrl,
  handleSignMessageResponse
} from "../deeplink.js"

// Wallet connection + SIWS authentication controller.
//
// Discovers wallets via Wallet Standard. Uses legacy provider for connect
// (preserves user gesture for popup), wallet-standard for signMessage.
// Falls back to Phantom deep links on mobile when no injected provider exists.
export default class extends Controller {
  static targets = ["connectBtn", "signing", "status", "walletList"]
  static values = {
    nonceUrl: String,
    verifyUrl: String,
    dashboardUrl: String
  }

  connect() {
    this.availableWallets = []
    this.selectedWallet = null
    this.isMobile = isMobileDevice()

    // Check if returning from a Phantom deep link redirect
    if (this.handleDeeplinkRedirect()) return

    this.discoverWallets()
  }

  // Handle Phantom deep link redirects (connect or signMessage response).
  // Returns true if a redirect was handled.
  handleDeeplinkRedirect() {
    const params = new URLSearchParams(window.location.search)
    const state = getDeeplinkState()
    if (!state) return false

    // Clean up URL params without triggering navigation
    const cleanUrl = window.location.pathname
    window.history.replaceState({}, "", cleanUrl)

    if (state.step === "connect" && params.has("phantom_encryption_public_key")) {
      this.completeDeeplinkConnect(params)
      return true
    }

    if (state.step === "signing" && params.has("data")) {
      this.completeDeeplinkSign(params)
      return true
    }

    // Error from Phantom
    if (params.has("errorCode")) {
      this.showStatus(params.get("errorMessage") || "Wallet request rejected", "error")
      clearDeeplinkSession()
      return true
    }

    return false
  }

  // Step 2 of deep link flow: decrypt connect response, fetch nonce, redirect to signMessage
  async completeDeeplinkConnect(params) {
    try {
      this.showSigning()
      const { publicKey, authConfig } = handleConnectResponse(params)

      // Fetch nonce from server
      const nonceUrl = authConfig?.nonceUrl || this.nonceUrlValue
      const nonceResponse = await fetch(`${nonceUrl}?wallet_address=${publicKey}`, {
        headers: { "Accept": "application/json" }
      })

      if (!nonceResponse.ok) throw new Error("Failed to get authentication challenge")
      const { message } = await nonceResponse.json()

      // Store the SIWS message for verification after signing
      const state = getDeeplinkState()
      sessionStorage.setItem("solrengine_deeplink_message", message)

      // Redirect to Phantom for message signing
      const redirectLink = window.location.origin + window.location.pathname
      const signUrl = buildSignMessageUrl({
        message: new TextEncoder().encode(message),
        redirectLink
      })

      window.location.href = signUrl
    } catch (error) {
      console.error("Deep link connect error:", error)
      this.showStatus(error.message || "Connection failed", "error")
      clearDeeplinkSession()
      this.resetUI()
    }
  }

  // Step 3 of deep link flow: decrypt signature, verify with server, redirect to dashboard
  async completeDeeplinkSign(params) {
    try {
      this.showSigning()
      const { signature, walletAddress, authConfig } = handleSignMessageResponse(params)

      const message = sessionStorage.getItem("solrengine_deeplink_message")
      sessionStorage.removeItem("solrengine_deeplink_message")

      if (!message) throw new Error("Authentication message not found. Please try again.")

      const signatureString = Array.from(signature).join(",")
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
      const verifyUrl = authConfig?.verifyUrl || this.verifyUrlValue

      const verifyResponse = await fetch(verifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          message,
          signature: signatureString
        })
      })

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json()
        throw new Error(error.error || "Verification failed")
      }

      const dashboardUrl = authConfig?.dashboardUrl || this.dashboardUrlValue
      window.location.href = dashboardUrl
    } catch (error) {
      console.error("Deep link sign error:", error)
      this.showStatus(error.message || "Verification failed", "error")
      this.resetUI()
    }
  }

  discoverWallets() {
    const { get, on } = getWallets()

    this.addWallets(get())

    on("register", (...newWallets) => {
      this.addWallets(newWallets)
    })

    // On mobile, if no wallets found after discovery, show deep link option
    if (this.isMobile && this.availableWallets.length === 0) {
      this.renderMobileWalletOptions()
    }
  }

  addWallets(wallets) {
    for (const wallet of wallets) {
      if (wallet.features[SolanaSignMessage]) {
        if (!this.availableWallets.find(w => w.name === wallet.name)) {
          this.availableWallets.push(wallet)
        }
      }
    }

    if (this.availableWallets.length > 0 && !this.selectedWallet) {
      this.selectedWallet = this.availableWallets[0]
    }

    this.renderWalletList()
  }

  renderMobileWalletOptions() {
    if (!this.hasWalletListTarget) return

    this.walletListTarget.replaceChildren()

    const button = document.createElement("button")
    button.dataset.action = "click->wallet#authenticateDeeplink"
    button.dataset.walletName = "phantom"
    button.className = "flex items-center gap-3 w-full p-3 rounded-xl border cursor-pointer border-purple-500 bg-purple-900/20"

    const img = document.createElement("img")
    img.src = "https://phantom.app/img/phantom-logo.svg"
    img.alt = "Phantom"
    img.className = "w-8 h-8 rounded-lg"
    button.appendChild(img)

    const span = document.createElement("span")
    span.className = "text-white font-medium"
    span.textContent = "Phantom (Mobile)"
    button.appendChild(span)

    this.walletListTarget.appendChild(button)
    this.walletListTarget.classList.remove("hidden")

    this.selectedWallet = null
    this.useDeeplink = true
  }

  renderWalletList() {
    if (!this.hasWalletListTarget) return
    if (this.availableWallets.length === 0) return

    // Desktop wallets found — clear any mobile deep link options
    this.useDeeplink = false
    this.walletListTarget.replaceChildren()

    this.availableWallets.forEach((wallet, index) => {
      const button = document.createElement("button")
      button.dataset.action = "click->wallet#selectWallet"
      button.dataset.walletIndex = index
      button.className = `flex items-center gap-3 w-full p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
        this.selectedWallet === wallet
          ? 'border-purple-500 bg-purple-900/20'
          : 'border-gray-700 hover:border-gray-500 bg-gray-800/30'
      }`

      if (wallet.icon && /^(https?:|data:image\/)/.test(wallet.icon)) {
        const img = document.createElement("img")
        img.src = wallet.icon
        img.alt = wallet.name
        img.className = "w-8 h-8 rounded-lg"
        button.appendChild(img)
      }

      const span = document.createElement("span")
      span.className = "text-white font-medium"
      span.textContent = wallet.name
      button.appendChild(span)

      this.walletListTarget.appendChild(button)
    })

    this.walletListTarget.classList.remove("hidden")
  }

  selectWallet(event) {
    const index = parseInt(event.currentTarget.dataset.walletIndex)
    this.selectedWallet = this.availableWallets[index]
    this.renderWalletList()
  }

  // Map wallet-standard wallets to their legacy window providers.
  // Legacy connect() is called first to preserve user gesture context
  // (Chrome only allows extension popups within a direct user action).
  getLegacyProvider(walletName) {
    const name = walletName.toLowerCase()
    if (name.includes("phantom")) return window.phantom?.solana || window.solana
    if (name.includes("solflare")) return window.solflare
    if (name.includes("backpack")) return window.backpack
    return null
  }

  // Deep link authentication — redirects to Phantom app
  authenticateDeeplink() {
    const appUrl = window.location.origin
    const redirectLink = window.location.origin + window.location.pathname

    const connectUrl = buildConnectUrl({
      appUrl,
      redirectLink,
      cluster: "mainnet-beta",
      authConfig: {
        nonceUrl: this.nonceUrlValue,
        verifyUrl: this.verifyUrlValue,
        dashboardUrl: this.dashboardUrlValue
      }
    })

    this.connectBtnTarget.disabled = true
    this.connectBtnTarget.textContent = "Opening Phantom..."

    window.location.href = connectUrl
  }

  async authenticate() {
    // Mobile deep link flow
    if (this.useDeeplink || (this.isMobile && this.availableWallets.length === 0)) {
      this.authenticateDeeplink()
      return
    }

    if (!this.selectedWallet) {
      this.showStatus("No Solana wallet found. Please install a Solana wallet extension.", "error")
      return
    }

    try {
      this.connectBtnTarget.disabled = true
      this.connectBtnTarget.textContent = `Connecting to ${this.selectedWallet.name}...`

      let publicKey
      let signMessage

      // Try legacy provider FIRST — this must happen immediately on user click
      // so Chrome allows the extension popup to open.
      const provider = this.getLegacyProvider(this.selectedWallet.name)

      if (provider) {
        // Legacy connect — happens immediately in the user gesture, popup shows
        const response = await provider.connect()

        const pk = response?.publicKey || provider.publicKey
        if (!pk) {
          throw new Error("Wallet connected but no public key returned. Please try again.")
        }
        publicKey = pk.toString()

        signMessage = async (messageBytes) => {
          const isPhantom = provider.isPhantom === true
          const result = isPhantom
            ? await provider.signMessage(messageBytes, "utf8")
            : await provider.signMessage(messageBytes)

          if (result instanceof Uint8Array) return result
          if (result?.signature) return new Uint8Array(result.signature)
          return new Uint8Array(result)
        }
      } else {
        // No legacy provider — use wallet-standard connect
        const connectFeature = this.selectedWallet.features["standard:connect"]
        const { accounts } = await connectFeature.connect()

        if (!accounts || accounts.length === 0) {
          throw new Error("No accounts returned. Please unlock your wallet and try again.")
        }

        const account = accounts[0]
        publicKey = account.address

        const signMessageFeature = this.selectedWallet.features[SolanaSignMessage]
        signMessage = async (messageBytes) => {
          const [{ signature }] = await signMessageFeature.signMessage(
            { account, message: messageBytes }
          )
          return new Uint8Array(signature)
        }
      }

      // Request a nonce from the server
      this.showSigning()
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content
      const nonceResponse = await fetch(`${this.nonceUrlValue}?wallet_address=${publicKey}`, {
        headers: { "Accept": "application/json" }
      })

      if (!nonceResponse.ok) {
        throw new Error("Failed to get authentication challenge")
      }

      const { message } = await nonceResponse.json()

      // Sign the SIWS message
      const encodedMessage = new TextEncoder().encode(message)
      const signatureBytes = await signMessage(encodedMessage)

      // Send the signed message to the server for verification
      const signatureString = Array.from(signatureBytes).join(",")

      const verifyResponse = await fetch(this.verifyUrlValue, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({
          wallet_address: publicKey,
          message: message,
          signature: signatureString
        })
      })

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json()
        throw new Error(error.error || "Verification failed")
      }

      // Redirect to dashboard
      window.location.href = this.dashboardUrlValue

    } catch (error) {
      console.error("Wallet authentication error:", error)

      if (error.message?.includes("User rejected") || error.message?.includes("cancelled")) {
        this.showStatus("Sign-in cancelled", "warning")
      } else if (error.message?.includes("Unexpected error")) {
        this.showStatus(`Please unlock ${this.selectedWallet.name} and try again.`, "error")
      } else {
        this.showStatus(error.message || "Connection failed.", "error")
      }

      this.resetUI()
    }
  }

  showSigning() {
    this.connectBtnTarget.classList.add("hidden")
    if (this.hasWalletListTarget) this.walletListTarget.classList.add("hidden")
    this.signingTarget.classList.remove("hidden")
  }

  resetUI() {
    this.connectBtnTarget.classList.remove("hidden")
    this.connectBtnTarget.disabled = false
    this.connectBtnTarget.textContent = "Connect Wallet"
    if (this.hasWalletListTarget) this.walletListTarget.classList.remove("hidden")
    this.signingTarget.classList.add("hidden")
  }

  showStatus(message, type = "info") {
    const statusEl = this.statusTarget
    statusEl.textContent = message
    statusEl.classList.remove("hidden", "bg-red-900/50", "text-red-300", "bg-yellow-900/50", "text-yellow-300", "bg-green-900/50", "text-green-300")

    switch (type) {
      case "error":
        statusEl.classList.add("bg-red-900/50", "text-red-300")
        break
      case "warning":
        statusEl.classList.add("bg-yellow-900/50", "text-yellow-300")
        break
      default:
        statusEl.classList.add("bg-green-900/50", "text-green-300")
    }
    statusEl.classList.remove("hidden")
  }
}
