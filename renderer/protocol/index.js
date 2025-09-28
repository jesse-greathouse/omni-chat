// Single source of truth for IRC parsing & normalization.
// Keep this file dependency-free and pure (no DOM, no events).

/** @typedef {{nick?:string,user?:string,host?:string}} Prefix */
/** @typedef {{tags?:Object,prefix?:Prefix,command:string,params:string[],raw:string}} IrcMsg */

export function stripCodes(s) {
  return String(s)
    .replace(/\x03(\d{1,2})(,\d{1,2})?/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

export function parsePrefix(pfx) {
  if (!pfx) return {};
  // nick!user@host  OR service name (NickServ)
  const [nickPart, rest] = String(pfx).split('!');
  if (!rest) return { nick: nickPart };
  const [user, host] = rest.split('@');
  return { nick: nickPart, user, host };
}

// Very small IRC line parser (no tags for now).
export function parseLine(line) {
  const raw = String(line);
  let s = raw;
  /** @type {Prefix|undefined} */
  let prefix;

  if (s.startsWith(':')) {
    const sp = s.indexOf(' ');
    // Guard: malformed line with only ':' prefix
    if (sp === -1) {
      return /** @type {IrcMsg} */ ({ raw, prefix: undefined, command: '', params: [] });
    }
    prefix = parsePrefix(s.slice(1, sp));
    // FIX: advance past the space; end index must be sp+1 (or use slice from start index only)
    s = s.slice(sp + 1);
  }

  const sp = s.indexOf(' ');
  const command = (sp === -1 ? s : s.slice(0, sp)).toUpperCase();
  s = (sp === -1) ? '' : s.slice(sp + 1);

  const params = [];
  while (s) {
    if (s.startsWith(':')) {
      // trailing parameter consumes the rest (without the leading ':')
      params.push(s.slice(1));
      break;
    }
    const i = s.indexOf(' ');
    if (i === -1) {
      params.push(s);
      break;
    }
    params.push(s.slice(0, i));
    // FIX: advance past the space correctly
    s = s.slice(i + 1);
  }

  return /** @type {IrcMsg} */ ({ raw, prefix, command, params });
}

export function isChannel(name) {
  return typeof name === 'string' && /^[#&]/.test(name);
}
export function normalizeChannel(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (isChannel(s)) return s;
  return s ? `#${s}` : null;
}
export function isDMTarget(target, selfNick) {
  // target is *not* a channel and equals our nick (case/locale tolerant)
  if (!target) return false;
  if (isChannel(target)) return false;
  if (!selfNick) return true; // best effort when we don't know yet
  return String(target).localeCompare(selfNick, undefined, { sensitivity: 'accent' }) === 0;
}
export function isNickServ(nick) {
  if (!nick) return false;
  return String(nick).localeCompare('NickServ', undefined, { sensitivity: 'accent' }) === 0;
}

// High-level classifier for incoming lines.
export function classify(line, selfNick) {
  const cleaned = stripCodes(line);
  const msg = parseLine(cleaned);

  const from = msg.prefix?.nick || '';
  const cmd  = msg.command || '';
  const p    = Array.isArray(msg.params) ? msg.params : [];

  // PRIVMSG / NOTICE
  if ((cmd === 'PRIVMSG' || cmd === 'NOTICE') && p.length >= 2) {
    const target = p[0];
    const text   = p.slice(1).join(' ');
    if (isChannel(target)) {
      return { kind: cmd, type: 'chan', from, target, text };
    }
    if (isDMTarget(target, selfNick)) {
      return { kind: cmd, type: 'dm', from, to: target, text, isNickServ: isNickServ(from) };
    }
  }

  // Numerics (LIST 321/322/323, etc.) and everything else fall through
  const numeric = /^\d{3}$/.test(cmd) ? Number(cmd) : null;
  return { kind: cmd, type: 'other', numeric, from, params: p, raw: cleaned };
}

// Normalize backend/user whois blobs to a single shape used by UI.
export function normalizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  const W = u.whois || {};
  const pick = (...xs) => {
    for (const v of xs) if (v !== undefined && v !== null && v !== '') return v;
    return null;
  };
  const arr = (a) => Array.isArray(a) ? a : [];
  const host = pick(u.host, W.actual_host, W.host);
  return {
    nick:        u.nick ?? null,
    user:        pick(u.user, u.username, u.ident, W.user),
    host,
    realname:    pick(u.realname, u.real_name, W.realname, u.gecos),
    account:     pick(u.account, W.account),
    away:        u.away ?? null,
    away_reason: pick(u.away_reason, W.away_reason),
    server:      pick(W.server, u.server),
    server_info: pick(W.server_info, u.server_info),
    channels:    arr(pick(W.channels, u.channels)),
    idle_secs:   pick(W.idle_secs, u.idle),
    signon_ts:   pick(W.signon_ts, u.signon_ts),
    secure:      pick(W.secure, u.secure),
    modes:       arr(u.modes),
    channel_modes: u.channel_modes || null,
  };
}

// Normalize the variety of "channel list" payloads into objects {name, users, topic}
export function normalizeChanlistItems(msg) {
  const out = [];
  const src = msg?.payload || msg?.data || msg?.chanlist || msg || {};
  const push = (o, k) => {
    const name = o?.name || o?.channel || o?.key || k;
    if (!name) return;
    const users = Number(
      o?.users ?? o?.user_count ?? o?.members ?? o?.num_users ?? 0
    ) || 0;
    const topic = typeof o?.topic === 'string' ? o.topic : '';
    out.push({ name, users, topic });
  };
  if (Array.isArray(src.items)) src.items.forEach(push);
  else if (Array.isArray(src.entries)) src.entries.forEach(push);
  else if (Array.isArray(src.channels)) src.channels.forEach((o) => push(o));
  else if (src.channels && typeof src.channels === 'object') {
    for (const [k, v] of Object.entries(src.channels)) push(v, k);
  }
  return out;
}
