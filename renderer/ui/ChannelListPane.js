import { api, events, EVT } from '../lib/adapter.js';

export class ChannelListPane {
  constructor(net) {
    this.net = net;
    this.items = [];
    this.hasRequestedOnce = false;

    this.root = document.createElement('div');
    this.root.className = 'chanlist-pane hidden';

    // top bar
    this.top = document.createElement('div');
    this.top.className = 'chanlist-top';

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.className = 'btn btn--sm';
    this.refreshBtn.textContent = 'Refresh list';
    this.refreshBtn.addEventListener('click', () => this.requestList());

    this.info = document.createElement('div');
    this.info.className = 'chanlist-info';
    this.info.textContent = 'Sorted by users (desc)';

    const spacer = document.createElement('div');
    spacer.className = 'flex-1';

    this.top.append(this.refreshBtn, spacer, this.info);
    this.root.appendChild(this.top);

    // table area
    this.wrap = document.createElement('div');
    this.wrap.className = 'chanlist-tableWrap';
    this.root.appendChild(this.wrap);

    // loading
    this.loading = document.createElement('div');
    this.loading.className = 'chanlist-loading';
    this.loading.setAttribute('hidden', 'true');
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading');
    this.loading.appendChild(spinner);
    this.wrap.appendChild(this.loading);

    // table
    this.table = document.createElement('table');
    this.table.setAttribute('aria-label', 'Channel List');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const thUsers = document.createElement('th');
    thUsers.className = 'num';
    thUsers.textContent = 'Users';
    const thChan = document.createElement('th');
    thChan.textContent = 'Channel';
    const thTopic = document.createElement('th');
    thTopic.textContent = 'Topic';
    tr.append(thUsers, thChan, thTopic);
    thead.appendChild(tr);
    this.tbody = document.createElement('tbody');
    this.table.append(thead, this.tbody);
    this.tbody = this.table.querySelector('tbody');
    this.wrap.appendChild(this.table);

    // empty
    this.empty = document.createElement('div');
    this.empty.className = 'chanlist-empty';
    this.empty.textContent = 'No channel data yet. Click "Refresh list".';
    this.empty.hidden = true;
    this.wrap.appendChild(this.empty);

    this._off = events.on(EVT.CHAN_SNAPSHOT, (payload) => {
      if (!payload || payload.sessionId !== this.net.sessionId) return;
      this.items = Array.isArray(payload.items) ? payload.items : [];
      this.render();
      if (this.isLoading && this.items.length > 0) this.setLoading(false);
    });
  }

  mount(container) { container.appendChild(this.root); }
  show() {
    this.root.classList.remove('hidden');
    if (!this.hasRequestedOnce) {
      this.hasRequestedOnce = true;
      this.requestList();
    }
  }
  hide() { this.root.classList.add('hidden'); }

  requestList() {
    if (!this.net?.sessionId) return;
    this.setLoading(true);
    api.sessions.send(this.net.sessionId, '/list * 30');
  }

  setLoading(on) {
    this.isLoading = !!on;
    this.loading.hidden = !this.isLoading;
    this.refreshBtn.disabled = this.isLoading;
    this.info.textContent = this.isLoading ? 'Refreshing...' : 'Sorted by users (desc)';
  }

  render() {
    const rows = this.items.slice().sort((a, b) => (b.users - a.users) || a.name.localeCompare(b.name));
    this.tbody.innerHTML = '';
    if (rows.length === 0) {
      this.empty.hidden = this.isLoading ? true : false;
      return;
    }
    this.empty.hidden = true;

    const frag = document.createDocumentFragment();
    for (const { name, users, topic } of rows) {
      const tr = document.createElement('tr');

      const tdUsers = document.createElement('td');
      tdUsers.className = 'num';
      tdUsers.textContent = String(users ?? 0);

      const tdName = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'chan-btn';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        if (!this.net?.sessionId) return;
        const chan = (name.startsWith('#') || name.startsWith('&')) ? name : `#${name}`;
        api.sessions.send(this.net.sessionId, `/join ${chan}`);
      });
      tdName.appendChild(btn);

      const tdTopic = document.createElement('td');
      const t = document.createElement('div');
      t.className = 'topic';
      t.textContent = topic || '';
      tdTopic.appendChild(t);

      tr.appendChild(tdUsers);
      tr.appendChild(tdName);
      tr.appendChild(tdTopic);
      frag.appendChild(tr);
    }
    this.tbody.appendChild(frag);
  }

  destroy() {
    try { this._off?.(); } catch {}
    try { this.refreshBtn?.removeEventListener('click', this._boundRefresh); } catch {}
    try { this.root?.remove(); } catch {}
  }
}
