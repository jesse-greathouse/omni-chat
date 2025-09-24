export function createProfilesPanel({ onConnect }) {
  const wrap = document.createElement('div');
  wrap.className = 'conn-wrap';
  wrap.innerHTML = `
    <div class="conn-card">
      <h3>Omni-Chat — Connections</h3>

      <div class="conn-grid">
        <section style="border:1px solid var(--border);border-radius:8px;padding:12px;">
          <h4 style="margin:0 0 8px 0;">Global Defaults</h4>
          <div class="form-row">
            <label>Authentication</label>
            <select id="gAuth">
              <option value="none">No authentication</option>
              <option value="nickserv">NickServ</option>
              <option value="sasl">SASL</option>
            </select>
          </div>
          <div class="form-row"><label>Nick</label><input id="gNick" type="text"/></div>
          <div class="form-row auth-extra" id="gAuthUserRow" style="display:none;">
            <label>Username</label><input id="gAuthUser" type="text" />
          </div>
          <div class="form-row auth-extra" id="gAuthPassRow" style="display:none;">
            <label>Password</label><input id="gAuthPass" type="password" />
          </div>
          <div class="form-row"><label>Realname</label><input id="gReal" type="text"/></div>
          <div class="row-actions">
            <button class="btn" id="saveGlobals">Save Defaults</button>
          </div>
          <div style="color:var(--muted);font-size:12px;margin-top:6px;">
            Server profiles inherit these when their Nick/Realname are empty or null.
          </div>
        </section>

        <section class="server-profiles" style="border:1px solid var(--border);border-radius:8px;padding:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <h4 style="margin:0;">Server Profiles</h4>
            <button class="btn" id="addServer">Add Server</button>
          </div>
          <div id="profilesList" class="profiles-list" style="margin-top:8px;"></div>
        </section>
      </div>
    </div>
  `;

  const gAuth = wrap.querySelector('#gAuth');
  const gNick = wrap.querySelector('#gNick');
  const gAuthUserRow = wrap.querySelector('#gAuthUserRow');
  const gAuthPassRow = wrap.querySelector('#gAuthPassRow');
  const gAuthUser = wrap.querySelector('#gAuthUser');
  const gAuthPass = wrap.querySelector('#gAuthPass');
  const gReal = wrap.querySelector('#gReal');
  const saveGlobalsBtn = wrap.querySelector('#saveGlobals');
  const addServerBtn = wrap.querySelector('#addServer');
  const listEl = wrap.querySelector('#profilesList');

  function serverRow(host, p) {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:8px;margin:6px 0;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;';
    const left = document.createElement('div');
    const right = document.createElement('div');
    right.style.display = 'flex'; right.style.gap = '8px';

    const authLabel = (() => {
      const t = (p.authType || '').toLowerCase();
      if (!t) return 'auth=inherit';
      if (t === 'none') return 'auth=None';
      if (t === 'nickserv') return 'auth=NickServ';
      if (t === 'sasl') return 'auth=SASL';
      return `auth=${t}`;
    })();

    left.innerHTML = `
      <div style="font-weight:600;">${host}</div>
      <div style="color:var(--muted);font-size:12px;">
        ${p.tls !== false ? 'TLS' : 'TCP'} • ${p.port ?? 6697}
        ${p.nick ? ` • nick=${escapeHtml(p.nick)}` : ''}
        ${p.realname ? ` • realname=${escapeHtml(p.realname)}` : ''}
        · ${authLabel}
      </div>
    `;
    const connectBtn = button('Connect', () => doConnect(host));
    const editBtn    = button('Edit',    () => openEditor(host));
    const delBtn     = button('Delete',  async () => {
      if (!confirm(`Delete server profile "${host}"?`)) return;
      await window.omni.profilesDelete(host);
      await hydrate();
    });
    right.append(connectBtn, editBtn, delBtn);
    row.append(left, right);
    return row;
  }

  function button(text, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function hydrate() {
    const all = await window.omni.getAllSettings();
    const globals = all.globals || { nick: 'guest', realname: 'Guest' };
    gAuth.value = (globals.authType || 'none').toLowerCase();
    gNick.value = globals.nick || '';
    gAuthUser.value = globals.authUsername || '';
    gAuthPass.value = globals.authPassword || '';
    const showUser = gAuth.value === 'sasl';
    const showPass = gAuth.value === 'sasl' || gAuth.value === 'nickserv';
    gAuthUserRow.style.display = showUser ? '' : 'none';
    gAuthPassRow.style.display = showPass ? '' : 'none';
    gReal.value = globals.realname || '';

    // Show Username only for SASL; show Password for SASL or NickServ
    const isSasl = gAuth.value === 'sasl';
    const isNickServ = gAuth.value === 'nickserv';
    gAuthUserRow.style.display = isSasl ? '' : 'none';
    gAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';

    listEl.innerHTML = '';
    const profs = await window.omni.profilesList();
    const hosts = Object.keys(profs).sort((a,b)=>a.localeCompare(b));
    if (hosts.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--muted)';
      empty.textContent = 'No server profiles yet. Click "Add Server" to create one.';
      listEl.appendChild(empty);
    } else {
      hosts.forEach(h => listEl.appendChild(serverRow(h, profs[h] || {})));
    }
  }

  gAuth.addEventListener('change', () => {
    const isSasl = gAuth.value === 'sasl';
    const isNickServ = gAuth.value === 'nickserv';
    gAuthUserRow.style.display = isSasl ? '' : 'none';
    gAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';
  });

  saveGlobalsBtn.addEventListener('click', async () => {
    const nick = gNick.value.trim() || 'guest';
    const realname = gReal.value.trim() || 'Guest';
    const authType = (gAuth.value || 'none').toLowerCase();
    const authUsername = authType === 'sasl' ? (gAuthUser.value.trim() || null) : null;
    const authPassword = gAuthPass.value || null;
    await window.omni.setSetting('globals', { nick, realname, authType, authUsername, authPassword });
    alert('Saved global defaults.');
  });
  addServerBtn.addEventListener('click', () => openEditor(null)); // new

  async function doConnect(host) {
    // resolve layered profile
    const resolved = await window.omni.profilesResolve(host);
    const opts = {
      server: resolved.host,
      ircPort: Number(resolved.port || 6697),
      tls: !!resolved.tls,
      nick: resolved.nick,
      realname: resolved.realname,
      authType: (resolved.authType || 'none').toLowerCase(),
      // Username only matters for SASL; keep NickServ simpler
      authUsername: ((resolved.authType || 'none').toLowerCase() === 'sasl'
        ? (resolved.authUsername || null)
        : null),
      authPassword: resolved.authPassword || null
    };
    // session start is handled by caller (renderer/main.js) so we just pass back
    onConnect?.(opts, host);
  }

  // Inline editor dialog
  function openEditor(host) {
    // load current or new
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:grid;place-items:center;z-index:50;';
    dialog.innerHTML = `
      <div style="width:520px;border:1px solid var(--border);background:var(--panel);border-radius:10px;padding:16px;">
        <h4 style="margin:0 0 8px 0;">${host ? 'Edit Server' : 'Add Server'}</h4>
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
          <label>Username</label><input id="eAuthUser" type="text" placeholder="SASL only · leave empty to inherit"/>
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
        const profs = await window.omni.profilesList();
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
        // auth: null/'' => inherit global
        authType: (eAuth.value || '') === '' ? null : (eAuth.value || '').toLowerCase(),
        // Username only meaningful for SASL; null in other modes or when left empty
        authUsername: ((eAuth.value || '').toLowerCase() === 'sasl')
          ? (eAuthUser.value.trim() || null)
          : null,
        // Password applies to SASL and NickServ; empty => inherit (null)
        authPassword: ((eAuth.value || '').toLowerCase() === 'sasl' || (eAuth.value || '').toLowerCase() === 'nickserv')
          ? (eAuthPass.value || null)
          : null
      };
      await window.omni.profilesUpsert(hostVal, payload);
      dialog.remove();
      await hydrate();
    });
    eCancel.addEventListener('click', () => dialog.remove());
    document.body.appendChild(dialog);
  }

  hydrate();
  return wrap;
}
