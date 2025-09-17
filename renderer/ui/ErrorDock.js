export class ErrorDock {
  constructor(rootEl, toggleBtn) {
    this.root = rootEl;
    toggleBtn.addEventListener('click', () => this.toggle());
  }
  toggle() { this.root.classList.toggle('hidden'); }
  append(line) {
    this.root.textContent += (line.endsWith('\n') ? line : line + '\n');
    const lines = this.root.textContent.split('\n');
    if (lines.length > 600) this.root.textContent = lines.slice(lines.length - 500).join('\n');
    this.root.scrollTop = this.root.scrollHeight;
  }
}
