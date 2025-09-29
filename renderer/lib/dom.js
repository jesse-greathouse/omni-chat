// Minimal DOM helpers to keep us honest about tainted strings.
// Use textContent by default; only use esc() with innerHTML in rare, controlled cases.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  ));
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // Use only with already-sanitized strings.
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const ch of (Array.isArray(children) ? children : [children])) {
    if (ch == null) continue;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }
  return node;
}

// Tainted inputs checklist (reference):
// - nick, user, host, realname/account
// - server/host labels, channel names, topics
// - message text, DM peer, tab titles
// Never feed these into innerHTML. Prefer textContent or the el() builder.
