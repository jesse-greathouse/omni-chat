# Omni Chat

A minimal, multi-platform IRC client.
**Frontend:** Electron (this repo)
**Backend:** [`omni-irc`](https://github.com/jesse-greathouse/omni-irc) (OCaml), exposed over a local UI socket.

## Requirements

- **git** [git-scm.com](https://git-scm.com/)
- **Opam (OCaml Package Manager)** [ocaml.org](https://opam.ocaml.org/)
- **MSYS2 (Win32)** [msys2](https://www.msys2.org/)

The User must provide Opam (And on Windows 10 or 11: MSYS2 or Cygwin)

> **Cross-platform first run:** the app now guides you through installing the OCaml backend on **Windows, macOS, and Linux** using bundled bootstrap scripts. No manual `opam` steps required for typical installs.

---

## 🚀 First run (Windows / macOS / Linux -- no manual `opam` commands)

1. **Install prerequisites (once):**

   * **Windows:** \[opam 2.2+ for Windows], **MSYS2** or **Cygwin** and **git** on `PATH`.
   * **macOS/Linux:** opam 2.2+, and **git** on `PATH`.

2. **Run Omni Chat** (packaged app or `npm run start` from source).

3. On first launch you’ll see the **installer screen**. Click **“Install Ocaml Backend”**:

   * **Windows:** opens **PowerShell** and runs `bin/bootstrap.ps1`.
   * **macOS:** the app starts the install in the background and opens **Terminal** to tail the live log. It closes automatically on success/error.
   * **Linux:** the app launches a detected terminal (e.g. `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`, etc.) and runs `bin/bootstrap`.

4. When the bootstrap finishes you’ll see:

   ```text
   *******************************************************************
   *  Omni-IRC bootstrap is COMPLETE. You can now close this window. *
   *******************************************************************
   ```

5. Return to the installer and click **“Launch App.”** The Electron UI will detect the backend binary and connect.

> You can always click **“Open logs folder”** in the installer to view `bootstrap.log`. On macOS, the Terminal tail also shows the live log.

### What the bootstrap does (all platforms)

* Initializes `OPAMROOT` (Windows usually `%LOCALAPPDATA%\opam`, macOS/Linux `~/.opam`) and ensures the `default` repo is registered (repairs stale repo dirs automatically).
* Creates/uses the switch **`omni-irc-dev`** (prefers OCaml `5.3.0`, falls back sensibly).
* Clones **`omni-irc`** at a **locked tag** and pins all packages from that source.
* Installs toolchain helpers (`dune`, `ocamlfind`) and an extra dep (`yojson`).
* Best-effort system dependency step (`--depext-only`) where supported.
* Installs **`omni-irc-client`** and prints its install location.
* Exits clearly on missing prerequisites (e.g., opam/git) with actionable messages.

---

## 🧭 Normal usage

* **Start the app** (packaged or `npm run start`).
* Configure **Global Defaults** (nick/realname) and **Server Profiles**.
* Click **Connect** to open a tab and start a session.

### How the UI talks to the backend

* **Windows:** TCP loopback transport (`--ui loopback`) on a free local port.
* **macOS/Linux:** secure **Unix domain socket** transport (`--ui headless`), created under `${XDG_RUNTIME_DIR}/omni-chat` or your temp dir; it’s cleaned up automatically.

### How the app finds `omni-irc-client`

1. Local dev build: `../omni-irc/_build/install/default/bin/omni-irc-client(.exe)`
2. `opam var bin` for the **`omni-irc-dev`** switch
3. Your `PATH` (on macOS/Linux, the app seeds PATH for Homebrew/MacPorts when launched from Finder)
4. Explicit override via env var:

   ```bash
   # Windows (PowerShell)
   $env:OMNI_IRC_CLIENT = "C:\path\to\omni-irc-client.exe"

   # macOS/Linux (bash/zsh)
   export OMNI_IRC_CLIENT=/usr/local/bin/omni-irc-client
   ```

---

## 🧑‍💻 Developing / running from source

```bash
git clone https://github.com/jesse-greathouse/omni-chat.git
cd omni-chat
npm install
npm run start
```

On first run you’ll see the installer. Click **“Install Ocaml Backend.”**

### Packaging

We ship the bootstrap scripts with the app:

* `package.json` includes:
  `build.extraResources: [{ "from": "bin/", "to": "bin/" }]`

Convenience pack scripts:

```bash
# Windows
npm run pack:win

# macOS (x64 + arm64)
npm run pack:mac

# Linux (x64 + arm64)
npm run pack:linux
```

---

## 🛠️ Advanced: local backend checkout (tight dev loop)

If you’re hacking on the OCaml repo:

```
parent/
├─ omni-chat/   # this repo
└─ omni-irc/    # backend
```

Build the backend:

```bash
opam switch create omni-irc-dev ocaml-compiler.5.3.0 || true
opam switch set omni-irc-dev
opam update
cd ../omni-irc
opam install -y . --deps-only
dune build @install
```

The Electron app will auto-detect:

```
../omni-irc/_build/install/default/bin/omni-irc-client(.exe)
```

---

## 🍎🐧 macOS / Linux notes

* The bundled **`bin/bootstrap`** (Perl) handles `opam` init, repo repair, switch creation, pinning, depexts, and install; same as Windows.
* When launched from Finder, macOS apps don’t inherit your shell `PATH`; Omni Chat augments `PATH` with common Homebrew/MacPorts locations so `opam`/`git` are found.
* Unix domain sockets live under `${XDG_RUNTIME_DIR}/omni-chat` (0700) or your temp dir; the app prevents duplicate sessions and cleans up stale sockets.

---

## 🧯 Troubleshooting

**“Invalid repository name … repo/default exists”**
Handled by the bootstrap: it removes a stale dir or resets the URL. If `opam` is locked by another process, close other shells/IDEs and re-run.

**“opam not found” / “git not found”**
Install them and ensure they’re on `PATH`, then click **“Install Ocaml Backend”** again (or run the script manually from `bin/`).

**Loopback / socket connect timeout**
Open **Errors** in the UI. Verify `omni-irc-client` exists in `opam var bin` for `omni-irc-dev`, or point `OMNI_IRC_CLIENT` at a local build.

**No terminal emulator found (Linux)**
Install a terminal like `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, `xterm`, `alacritty`, or `kitty`, then try again. You can also run `bin/bootstrap` manually in a shell.

**Hard reset (wipe opam + cached sources)**

* **Windows:** `bin\uninstall.ps1`
* **macOS/Linux:** `bin/uninstall`
  These remove switches, `OPAMROOT`, and cached `omni-irc` sources (they do **not** uninstall the opam program itself).

---

## License

MIT © Jesse Greathouse
