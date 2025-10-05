# Preload API (window.api) – Omni-Chat

This file defines the only allowed renderer → main bridge. Anything not listed here is **not** exposed.

## Events

- `events.on(topic, fn): () => void`
  - Topics (canonical):
    - `conn:status`, `conn:error`, `conn:line`
    - `chan:snapshot`, `chan:update`
    - `dm:line`, `dm:user`, `dm:notify`
    - `ui:active-session`
    - `error`

## Sessions

- `sessions.start(sessionId: string, opts: { server: string, ircPort?: number, tls?: boolean, nick?: string, realname?: string, authType?: 'none'|'nickserv'|'sasl', authUsername?: string|null, authPassword?: string|null }): Promise<void>`
- `sessions.stop(sessionId: string): void`
- `sessions.send(sessionId: string, raw: string): void`

## DM

- `dm.open(sessionId: string, peer: string, initialLine?: { from?: string, kind?: 'PRIVMSG'|'NOTICE', text?: string }): Promise<void>`
- `dm.notify(sessionId: string, peer: string): void`
- `dm.requestUser(sessionId: string, peer: string): void`
- `dm.pushUser(sessionId: string, user: object): void` (bridge may ignore)

## Settings

- `settings.getAll(): Promise<object>`
- `settings.set(key: string, value: any): Promise<void>`

## Profiles

- `profiles.list(): Promise<Record<string, object>>`
- `profiles.resolve(hostOrNull: string|null): Promise<object>`
- `profiles.upsert(host: string, partial: object): Promise<void>`
- `profiles.del(host: string): Promise<void>`

## Bootstrap (installer)

- `bootstrap.runInTerminal(): void`
- `bootstrap.openLogsDir(): void`
- `bootstrap.proceedIfReady(): void`
- `bootstrap.onLog(fn: (line: string) => void): () => void`
- `bootstrap.onDone(fn: () => void): () => void`
- `bootstrap.onError(fn: (code: number) => void): () => void`
