import { Controller } from "@hotwired/stimulus"

// Copy text to clipboard with visual feedback.
// Usage: data-controller="clipboard" data-clipboard-text-value="..."
//        data-action="click->clipboard#copy"
export default class extends Controller {
  static targets = ["label", "icon"]
  static values = { text: String }

  async copy() {
    await navigator.clipboard.writeText(this.textValue)

    const original = this.labelTarget.textContent
    this.labelTarget.textContent = "Copied!"

    setTimeout(() => {
      this.labelTarget.textContent = original
    }, 1500)
  }
}
