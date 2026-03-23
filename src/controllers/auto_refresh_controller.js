import { Controller } from "@hotwired/stimulus"
import { morphChildren } from "@hotwired/turbo"

// Periodically fetches fresh HTML and morphs only the changed DOM elements.
// No Turbo visit, no loading bar, no scroll reset — completely invisible.
export default class extends Controller {
  static values = {
    interval: { type: Number, default: 60 }
  }

  connect() {
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        this.morph()
      }
    }, this.intervalValue * 1000)
  }

  disconnect() {
    clearInterval(this.timer)
  }

  async morph() {
    try {
      const response = await fetch(window.location.href, {
        headers: { "Accept": "text/html" }
      })
      if (!response.ok) return

      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, "text/html")
      const newContent = doc.querySelector(`[data-controller~="auto-refresh"]`)

      if (newContent) {
        morphChildren(this.element, newContent)
      }
    } catch {
      // Silently fail — next interval will retry
    }
  }
}
