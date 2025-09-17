# Omni Chat

A minimal, multi-platform IRC client.
**Frontend:** Electron (this repo)
**Backend:** [`omni-irc`](https://github.com/jesse-greathouse/omni-irc) OCaml client, exposed via a local “loopback” UI socket that the Electron app connects to.

> On Windows, we assume PowerShell and `opam` (2.2+) are available. macOS/Linux instructions are included too.

---

## ✨ Quick Start (Windows PowerShell)

```powershell
# Clone the Electron app
git clone https://github.com/jesse-greathouse/omni-chat.git
cd omni-chat

# Install Node deps
npm install

# Install OCaml backend via opam (creates switch "omni-irc-dev")
#    You only need to do this once.
opam init -y                       # (if you haven't already)
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

# Option A: install from GitHub (recommended for users)
opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y
# The pin brings in packages; now install the client binary:
opam install -y omni-irc-client

# Option B: local dev checkout (recommended for contributors)
# (in a sibling folder to omni-chat)
#   cd ..
#   git clone https://github.com/jesse-greathouse/omni-irc.git
#   cd omni-irc
#   opam install -y . --deps-only
#   dune build @install
# Electron will auto-detect the built client in omni-irc/_build/install/...

# 3) Run the app
cd ..\omni-chat
npm run start
```

That’s it. The Electron app will:

* resolve the `opam` environment for the `omni-irc-dev` switch,
* locate the `omni-irc-client(.exe)` binary (from `opam var bin` **or** from a local `omni-irc/_build/...`),
* spawn the client with the loopback UI socket,
* connect the UI.

---

## Why the `omni-irc-dev` switch?

The app (see `main.js`) calls:

* `opam env --switch=omni-irc-dev --set-switch`
* `opam var bin`

and then looks for `omni-irc-client(.exe)` in that switch. Creating that specific switch keeps the setup predictable across dev machines.

If you **must** use a different switch, change the hardcoded `'omni-irc-dev'` in `main.js` (function `resolveOpamEnv`) to your switch name.

---

## Installing the OCaml backend

You have two routes. Either is fine; the Electron app supports both.

### Option A: Install from GitHub (pin)

**PowerShell (Windows):**

```powershell
opam init -y
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

# Bring the packages in via a pinned repo
opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y

# Ensure system deps (optional; depext may be limited on Windows)
# opam install -y opam-depext
# opam depext -y omni-irc-client

# Install the client binary
opam install -y omni-irc-client
```

**macOS/Linux (bash/zsh):**

```bash
opam init -y
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y
opam install -y opam-depext
opam depext -y omni-irc-client
opam install -y omni-irc-client
```

This produces an `omni-irc-client` binary in `$(opam var bin)` for that switch (on Windows it’s `omni-irc-client.exe`). The Electron app will find it automatically.

### Option B: Local dev checkout (side-by-side)

Place `omni-irc` **next to** this repo:

```sh
parent/
├─ omni-chat/   # this repo
└─ omni-irc/    # local backend checkout
```

Then:

```powershell
# Windows PowerShell
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

cd ..\omni-irc
opam install -y . --deps-only
dune build @install
```

Electron checks:

```sh
<omni-chat app folder>/../omni-irc/_build/install/default/bin/omni-irc-client(.exe)
```

If present, it will use this local build—great for tight inner-loop development.

---

## Running the Electron app

```powershell
# In the omni-chat repo
npm install
npm run start
```

### What happens under the hood

* The app resolves `opam` env for the `omni-irc-dev` switch in a Windows-friendly way (parsing the `set VAR=...` output).
* It finds `omni-irc-client(.exe)` via:

  1. local `../omni-irc/_build/install/default/bin/`,
  2. `opam var bin`,
  3. or falls back to `PATH`.
* It spawns the client like:

  ```sh
  omni-irc-client --server irc.libera.chat --port 6697 --tls \
                  --nick <nick> --realname <real> \
                  --ui loopback --socket <random_port>
  ```

* The UI connects to that loopback socket and renders channels/messages.

You can override the binary explicitly:

```powershell
$env:OMNI_IRC_CLIENT="C:\path\to\custom\omni-irc-client.exe"
npm run start
```

---

## Configuring servers and identity

The app stores settings via `electron-store` in `omni-chat.json`. From the UI:

* Set **Global Defaults** (Nick, Realname).
* Add **Server Profiles** (host/port/TLS; optional overrides for nick/realname).
* Click **Connect** to spin up a tab + session.

Defaults include Libera at `6697` (TLS on).

---

## Platform Notes

### Windows (PowerShell)

* Use `opam` 2.2+.
* The app handles `opam env` → Node env translation automatically—no manual PATH edits needed.
* TLS is enabled by default in the backend (uses OCaml TLS with CA verification).

### macOS

```bash
brew install opam     # if you use Homebrew
```

Then follow the Option A or B steps above.

### Linux

Install `opam` from your distro or from the official installer, then follow the Option A or B steps.

---

## Troubleshooting

### “loopback connect timeout” on start

* The backend didn’t start or didn’t open the socket yet.
* Check the **Errors** toggle (bottom panel) for spawn logs.
* Verify the binary exists:

  ```powershell
  opam switch set omni-irc-dev
  opam var bin
  # Ensure omni-irc-client(.exe) is present in that bin dir
  ```

* Try the local build route (Option B) to ensure the binary is there.

### “opam not found” or wrong switch

* Confirm `opam --version` works in PowerShell.
* Ensure the switch is exactly `omni-irc-dev` or change it in `main.js` (function `resolveOpamEnv`).

### Can’t find the binary even though it’s built

* Point the app directly:

  ```powershell
  $env:OMNI_IRC_CLIENT="C:\path\to\omni-irc-client.exe"
  npm run start
  ```

### TLS/port mismatch auto-fix

* If you choose port 6667 with TLS on (or 6697 with TLS off), the app corrects it for you.

---

## Scripts you can copy/paste

### One-shot backend setup (Windows PowerShell, GitHub pin)

```powershell
opam init -y
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update
opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y
opam install -y omni-irc-client
```

### One-shot backend setup (macOS/Linux, GitHub pin)

```bash
opam init -y
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update
opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y
opam install -y opam-depext
opam depext -y omni-irc-client
opam install -y omni-irc-client
```

### Local dev checkout (side-by-side, all platforms)

```bash
# create switch
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

# build local backend
cd ../omni-irc
opam install -y . --deps-only
dune build @install
```
