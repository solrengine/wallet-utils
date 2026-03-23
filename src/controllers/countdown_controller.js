import { Controller } from "@hotwired/stimulus"

// Live countdown timer with progress bar.
// Shows remaining time and auto-transitions to expired state.
// Persists initial remaining time in sessionStorage so the progress bar
// survives auto-refresh morphs and page reloads.
//
// Usage: data-controller="countdown"
//        data-countdown-expires-at-value="<unix_timestamp>"
//        data-countdown-expired-value="false"
export default class extends Controller {
  static targets = ["timer", "progress", "badge"]
  static values = {
    expiresAt: Number,
    expired: Boolean
  }

  connect() {
    if (this.expiredValue) return
    this.storageKey = `countdown:${this.expiresAtValue}`
    this.totalDuration = this.loadTotalDuration()
    this.tick()
    this.interval = setInterval(() => this.tick(), 1000)
  }

  disconnect() {
    if (this.interval) clearInterval(this.interval)
  }

  // Load or initialize the total duration for this lock.
  // On first connect, we store the remaining time as the baseline.
  // On subsequent connects (morph/reload), we reuse the stored value.
  loadTotalDuration() {
    const stored = sessionStorage.getItem(this.storageKey)
    if (stored) return parseInt(stored, 10)

    const remaining = this.expiresAtValue - Math.floor(Date.now() / 1000)
    if (remaining > 0) {
      sessionStorage.setItem(this.storageKey, remaining)
    }
    return remaining
  }

  tick() {
    const now = Math.floor(Date.now() / 1000)
    const remaining = this.expiresAtValue - now

    if (remaining <= 0) {
      clearInterval(this.interval)
      sessionStorage.removeItem(this.storageKey)
      this.markExpired()
      return
    }

    // Update timer text
    if (this.hasTimerTarget) {
      const minutes = Math.floor(remaining / 60)
      const seconds = remaining % 60
      if (minutes > 0) {
        this.timerTarget.textContent = `Unlocks in ${minutes}m ${String(seconds).padStart(2, "0")}s`
      } else {
        this.timerTarget.textContent = `Unlocks in ${seconds}s`
      }
    }

    // Update progress bar using stored total duration
    if (this.hasProgressTarget && this.totalDuration > 0) {
      const elapsed = this.totalDuration - remaining
      const progress = Math.min((elapsed / this.totalDuration) * 100, 100)
      this.progressTarget.style.width = `${progress}%`
    }
  }

  markExpired() {
    if (this.hasTimerTarget) {
      this.timerTarget.textContent = "Ready to unlock"
      this.timerTarget.className = "text-green-400"
    }

    if (this.hasProgressTarget) {
      this.progressTarget.style.width = "100%"
      this.progressTarget.className = "bg-green-500 h-1.5 rounded-full transition-all duration-1000"
    }

    if (this.hasBadgeTarget) {
      this.badgeTarget.textContent = "Ready"
      this.badgeTarget.className = "px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-800"
    }

    // Refresh via Turbo to show unlock button
    setTimeout(() => {
      import("@hotwired/turbo").then(({ visit }) => {
        visit(window.location.href, { action: "replace" })
      }).catch(() => {
        window.location.href = window.location.href
      })
    }, 2000)
  }
}
