export const DEFAULTS = Object.freeze({
  IRC: {
    PORT_TLS: 6697,
    PORT_PLAIN: 6667,
    TLS_BY_DEFAULT: true,
  }
});

export function defaultPort(tls) {
  return tls ? DEFAULTS.IRC.PORT_TLS : DEFAULTS.IRC.PORT_PLAIN;
}

/**
 * Normalize an options object coming from any caller into canonical
 * { server, ircPort, tls, nick, realname, auth* } with consistent defaults.
 */
export function canonicalizeConnOptions(input = {}) {
  const tls = (input.tls !== false); // default true
  const ircPort = Number(
    input.ircPort ?? input.port ?? defaultPort(tls)
  );
  return {
    ...input,
    tls,
    ircPort,
    port: ircPort, // keep compatibility if some callsites look for port
  };
}
