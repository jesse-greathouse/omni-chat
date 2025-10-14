import { api } from '../../lib/adapter.js';

function confirmModal(message) {
  return new Promise((resolve) => {
    document.body.classList.add('modal-open');
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-card modal-card--confirm">
        <h4 class="h4-tight">Confirm</h4>
        <p class="mt-6">${message}</p>
        <div class="row-actions mt-8">
          <button class="btn btn--danger" id="cOk">Delete</button>
          <button class="btn" id="cCancel">Cancel</button>
        </div>
      </div>
    `;
    const cleanup = (val) => {
      try { overlay.remove(); } catch {}
      document.body.classList.remove('modal-open');
      resolve(val);
    };
    overlay.querySelector('#cOk').addEventListener('click',    () => cleanup(true));
    overlay.querySelector('#cCancel').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.body.appendChild(overlay);
  });
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function authLabelFrom(p = {}) {
  const t = (p.authType || '').toLowerCase();
  if (!t) return 'auth=inherit';
  if (t === 'none') return 'auth=None';
  if (t === 'nickserv') return 'auth=NickServ';
  if (t === 'sasl') return 'auth=SASL';
  return `auth=${t}`;
}

export function createProfilesListController(listEl, {
  includeConnect = true,
  onConnect = null,
} = {}) {

  let hydrateSeq = 0;

  async function hydrate() {
    const seq = ++hydrateSeq;
    listEl.innerHTML = '';
    const profs = await api.profiles.list();
    // If a newer hydrate started while we were awaiting, abort this one.
    if (seq !== hydrateSeq) return;
    const hosts = Object.keys(profs).sort((a, b) => a.localeCompare(b));
    if (hosts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No server profiles yet. Click "Add Server" to create one.';
      listEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    hosts.forEach(h => frag.appendChild(serverRow(h, profs[h] || {})));
    listEl.replaceChildren(frag); // atomic replace to avoid flicker + dupes
  }

  function serverRow(host, p) {
    const row = document.createElement('div');
    // Restore styling and add a semantic hook for future tweaks
    row.className = 'card g-cols-1-auto mt-6 server-row';
    row.dataset.host = String(host ?? '');

    const left = document.createElement('div');
    const right = document.createElement('div');
    right.className = 'row';

    const top = document.createElement('div');
    top.className = 'fw-600';
    top.textContent = String(host ?? '');

    const sub = document.createElement('div');
    sub.className = 'muted fs-12';
    const parts = [
      (p.tls !== false ? 'TLS' : 'TCP'),
      String(p.port ?? 6697),
      (p.nick ? `nick=${p.nick}` : null),
      (p.realname ? `realname=${p.realname}` : null),
      authLabelFrom(p),
    ].filter(Boolean);
    sub.textContent = parts.join(' | ');
    left.append(top, sub);

    if (includeConnect && onConnect) {
      const connectBtn = button('Connect', () => doConnect(host));
      right.append(connectBtn);
    }
    const editBtn = button('Edit', () => openEditor(host));
    const delBtn  = button('Delete', async (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      const ok = await confirmModal(`Delete server profile "${host}"?`);
      if (!ok) return;
      delBtn.disabled = true;
      editBtn.disabled = true;
      const connectBtn = right.firstChild && right.firstChild.textContent === 'Connect'
        ? right.firstChild : null;
      if (connectBtn) connectBtn.disabled = true;
      try { delBtn.blur(); } catch {}

      // Optimistically remove the row now so the UI never blocks on IPC
      try { row.remove(); } catch {}

      // Kick off deletion WITHOUT awaiting it; attach handlers instead.
      const p = Promise.resolve().then(() => api.profiles.del(host));

      // Watchdog: if backend never responds, we won’t keep the UI “busy”
      const timeoutMs = 10000;
      const timeout = new Promise((_, rej) => setTimeout(() => rej(
        new Error(`profiles.del("${host}") timed out after ${timeoutMs}ms`)
      ), timeoutMs));

      Promise.race([p, timeout])
        .then(() => {
          // Happy path: backend finished; settings:changed will rehydrate if applicable.
        })
        .catch((err) => {
          console.error('[profiles.del]', host, err);
          alert('Failed to delete profile. See console.');
          // If we failed after removing the row, re-sync list for correctness.
          // (Safe even if hydrate() gets invoked by settings:changed too.)
          try { hydrate(); } catch {}
        })
        .finally(() => {
          // Re-enable controls on whatever is still mounted
          try { delBtn.disabled = false; } catch {}
          try { editBtn.disabled = false; } catch {}
          try { if (connectBtn) connectBtn.disabled = false; } catch {}
        });
    });
    right.append(editBtn, delBtn);

    row.append(left, right);
    return row;
  }

  async function doConnect(host) {
    if (!onConnect) return;
    let resolved;
    try { resolved = await api.profiles.resolve(host); }
    catch (e) { console.error('[profiles.resolve]', host, e); alert('Failed to resolve profile. See console.'); return; }
    const opts = {
      server: resolved.host,
      ircPort: Number(resolved.port || 6697),
      tls: !!resolved.tls,
      nick: resolved.nick,
      realname: resolved.realname,
      authType: (resolved.authType || 'none').toLowerCase(),
      authUsername: ((resolved.authType || 'none').toLowerCase() === 'sasl' ? (resolved.authUsername || null) : null),
      authPassword: resolved.authPassword || null
    };
    try { onConnect(opts, host); } catch (e) { console.error('[onConnect]', e); }
  }

  function openEditor(host) {
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal-card">
        <h4 class="h4-tight">${host ? 'Edit Server' : 'Add Server'}</h4>
        <div class="form-row"><label>Host</label><input id="eHost" type="text" ${host?'disabled':''}/></div>
        <div class="form-row"><label>Port</label><input id="ePort" type="number" value="6697"/></div>
        <div class="form-row"><label>TLS</label><input id="eTLS" type="checkbox" checked/></div>
        <div class="form-row"><label>Nick (override)</label><input id="eNick" type="text" placeholder="leave empty to inherit"/></div>
        <div class="form-row"><label>Realname (override)</label><input id="eReal" type="text" placeholder="leave empty to inherit"/></div>
        <div class="form-row">
          <label>Authentication</label>
          <select id="eAuth">
            <option value="">Inherit (use Global)</option>
            <option value="none">No authentication</option>
            <option value="nickserv">NickServ</option>
            <option value="sasl">SASL</option>
          </select>
        </div>
        <div class="form-row" id="eAuthUserRow" style="display:none;">
          <label>Username</label><input id="eAuthUser" type="text" placeholder="SASL only - leave empty to inherit"/>
        </div>
        <div class="form-row" id="eAuthPassRow" style="display:none;">
          <label>Password</label><input id="eAuthPass" type="password" placeholder="leave empty to inherit"/>
        </div>
        <div class="row-actions">
          <button class="btn" id="eSave">Save</button>
          <button class="btn" id="eCancel">Cancel</button>
        </div>
      </div>
    `;
    const eHost = dialog.querySelector('#eHost');
    const ePort = dialog.querySelector('#ePort');
    const eTLS  = dialog.querySelector('#eTLS');
    const eNick = dialog.querySelector('#eNick');
    const eReal = dialog.querySelector('#eReal');
    const eSave = dialog.querySelector('#eSave');
    const eAuth = dialog.querySelector('#eAuth');
    const eAuthUserRow = dialog.querySelector('#eAuthUserRow');
    const eAuthPassRow = dialog.querySelector('#eAuthPassRow');
    const eAuthUser = dialog.querySelector('#eAuthUser');
    const eAuthPass = dialog.querySelector('#eAuthPass');
    const eCancel = dialog.querySelector('#eCancel');

    const updateAuthVisibility = () => {
      const t = (eAuth.value || '').toLowerCase();
      const isSasl = t === 'sasl';
      const isNickServ = t === 'nickserv';
      eAuthUserRow.style.display = isSasl ? '' : 'none';
      eAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';
    };

    (async () => {
      if (host) {
        const profs = await api.profiles.list();
        const p = profs[host] || {};
        eHost.value = host;
        ePort.value = Number(p.port ?? 6697);
        eTLS.checked = p.tls !== false;
        eNick.value = p.nick ?? '';
        eReal.value = p.realname ?? '';
        eAuth.value = (p.authType || '').toLowerCase();
        eAuthUser.value = p.authUsername ?? '';
        eAuthPass.value = p.authPassword ?? '';
        updateAuthVisibility();
      } else {
        eHost.value = '';
        ePort.value = 6697;
        eTLS.checked = true;
        eNick.value = '';
        eReal.value = '';
        eAuth.value = '';
        eAuthUser.value = '';
        eAuthPass.value = '';
        updateAuthVisibility();
      }
    })();

    eAuth.addEventListener('change', updateAuthVisibility);

    eSave.addEventListener('click', async () => {
      const hostVal = (eHost.value || '').trim();
      if (!hostVal) { alert('Host is required'); return; }
      const payload = {
        port: Number(ePort.value || 6697),
        tls: !!eTLS.checked,
        nick: eNick.value.trim() === '' ? null : eNick.value.trim(),
        realname: eReal.value.trim() === '' ? null : eReal.value.trim(),
        authType: (eAuth.value || '') === '' ? null : (eAuth.value || '').toLowerCase(),
        authUsername: ((eAuth.value || '').toLowerCase() === 'sasl') ? (eAuthUser.value.trim() || null) : null,
        authPassword: ((eAuth.value || '').toLowerCase() === 'sasl' || (eAuth.value || '').toLowerCase() === 'nickserv')
          ? (eAuthPass.value || null)
          : null
      };
      try {
        await api.profiles.upsert(hostVal, payload);
        dialog.remove();
        await hydrate();
      } catch (e) {
        console.error('[profiles.upsert]', hostVal, e);
        alert('Failed to save server. See console.');
      }
    });

    eCancel.addEventListener('click', () => dialog.remove());
    document.body.appendChild(dialog);
  }

  return { hydrate, openEditor };
}
