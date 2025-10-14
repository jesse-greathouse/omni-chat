import { api } from '../lib/adapter.js';
import { createProfilesListController } from './partials/serverProfiles.js';

export function createProfilesPanel({ onConnect }) {
  const wrap = document.createElement('div');
  wrap.className = 'conn-wrap';
  wrap.innerHTML = `
    <div class="conn-card panel">
      <h3>Connections</h3>

      <div class="conn-grid">
        <section class="card">
          <h4 class="h4-tight">Global Settings</h4>
          <div class="form-row">
            <label>Authentication</label>
            <select id="gAuth">
              <option value="none">No authentication</option>
              <option value="nickserv">NickServ</option>
              <option value="sasl">SASL</option>
            </select>
          </div>
          <div class="form-row"><label>Nick</label><input id="gNick" type="text"/></div>
          <div class="form-row auth-extra hidden" id="gAuthUserRow">
            <label>Username</label><input id="gAuthUser" type="text" />
          </div>
          <div class="form-row auth-extra hidden" id="gAuthPassRow">
            <label>Password</label><input id="gAuthPass" type="password" />
          </div>
          <div class="form-row"><label>Realname</label><input id="gReal" type="text"/></div>
          <div class="row-actions">
            <button class="btn" id="saveGlobals">Save Settings</button>
          </div>
          <div class="muted fs-12 mt-6">
            Server profiles inherit these when their Nick/Realname are empty or null.
          </div>
        </section>

        <section class="server-profiles card">
          <div class="row between">
            <h4 class="h4-tight">Server Profiles</h4>
            <button class="btn" id="addServer">Add Server</button>
          </div>
          <div id="profilesList" class="profiles-list mt-8"></div>
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

  // Shared profiles list (with Connect button in this view)
  const profilesCtl = createProfilesListController(listEl, {
    includeConnect: true,
    onConnect: (opts, host) => onConnect?.(opts, host),
  });

  async function hydrate() {
    const all = await api.settings.getAll();
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
    gAuthUserRow.classList.toggle('hidden', !isSasl);
    gAuthPassRow.classList.toggle('hidden', !(isSasl || isNickServ));

    await profilesCtl.hydrate();
  }

  gAuth.addEventListener('change', () => {
    const isSasl = gAuth.value === 'sasl';
    const isNickServ = gAuth.value === 'nickserv';
    gAuthUserRow.style.display = isSasl ? '' : 'none';
    gAuthPassRow.style.display = (isSasl || isNickServ) ? '' : 'none';
  });

  saveGlobalsBtn.addEventListener('click', async () => {
    const nick        = gNick.value.trim() || 'guest';
    const realname    = gReal.value.trim() || 'Guest';
    const authType    = (gAuth.value || 'none').toLowerCase();
    const authUsername= authType === 'sasl' ? (gAuthUser.value.trim() || null) : null;
    const authPassword= (authType === 'sasl' || authType === 'nickserv') ? (gAuthPass.value || null) : null;

    try { await Promise.all([
      api.settings.setPath('globals', 'nick',         nick),
      api.settings.setPath('globals', 'realname',     realname),
      api.settings.setPath('globals', 'authType',     authType),
      api.settings.setPath('globals', 'authUsername', authUsername),
      api.settings.setPath('globals', 'authPassword', authPassword),
    ]); alert('Settings saved.'); }
    catch (e) { console.error('[settings set globals]', e); alert('Failed to save settings. See console.'); }
  });
  addServerBtn.addEventListener('click', () => profilesCtl.openEditor(null));

  async function doConnect(host) {
    // resolve layered profile
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
      // Username only matters for SASL; keep NickServ simpler
      authUsername: ((resolved.authType || 'none').toLowerCase() === 'sasl'
        ? (resolved.authUsername || null)
        : null),
      authPassword: resolved.authPassword || null
    };
    // session start is handled by caller (renderer/main.js) so we just pass back
    try { onConnect?.(opts, host); } catch (e) { console.error('[onConnect]', e); }
  }

  hydrate();
  return wrap;
}
