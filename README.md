# Omni Chat

A minimal, multi-platform IRC client.
**Frontend:** Electron (this repo)
**Backend:** [`omni-irc`](https://github.com/jesse-greathouse/omni-irc) (OCaml), exposed over a local “loopback” UI socket.

> **Windows-first**: the app now guides you through installing the OCaml backend by opening a real PowerShell terminal and running a bundled bootstrap script. macOS/Linux notes are below.

---

## 🚀 First run (Windows — no manual `opam` commands)

1. **Install prerequisites (once):**

   * **opam 2.2+** for Windows (and **git** on PATH).

2. **Run Omni Chat** (packaged app or from source with `npm run start`).

3. On first launch you’ll see the **installer screen**
   * Click **“Run in PowerShell”** or manually run from `bin/bootstrap.ps1`
     * A PowerShell window opens and runs `bootstrap.ps1`.
   * In PowerShell it will install OCaml, install the `omni-irc-dev` switch (clone, opam switch, pins, builds).
   * On success it prints a big green banner:

     ```sh
     *******************************************************************
     *  Omni-IRC bootstrap is COMPLETE. You can now close this window. *
     *******************************************************************
     ```

4. Close the PowerShell window, then click **“Launch App”** in the installer.

That’s it. The Electron UI will detect the backend binary and connect.

### What the bootstrap does

* Creates/uses `OPAMROOT` under `%LOCALAPPDATA%\opam`
* Ensures the `default` opam repo is registered (repairs stale repo dirs)
* Creates/uses switch **`omni-irc-dev`** (prefers **mingw** toolchain on Windows)
* Pins the `omni-irc` packages from GitHub at a **locked tag**
* Installs `yojson` (workaround for a UI dep)
* Installs **`omni-irc-client`** and prints its location
* Shows the big **complete** banner when done

If opam or git are missing, the script stops early with a clear message.

> You can always click **“Open logs folder”** in the installer to see `bootstrap.log`.

---

## 🧭 Normal usage

* **Start the app** (packaged or `npm run start`).
* Configure **Global Defaults** (nick/realname) and **Server Profiles**.
* Click **Connect** to open a tab and start a session.
* The app spawns `omni-irc-client` with `--ui loopback` and connects to it.

The app searches for the backend in this order:

1. Local build at `../omni-irc/_build/install/default/bin/omni-irc-client(.exe)`
2. `opam var bin` for the **`omni-irc-dev`** switch
3. The system `PATH`
4. Or you can override explicitly with env var:

   ```sh
   set OMNI_IRC_CLIENT=C:\path\to\omni-irc-client.exe
   ```

---

## 🧑‍💻 Developing / running from source

```powershell
git clone https://github.com/jesse-greathouse/omni-chat.git
cd omni-chat
npm install
npm run start
```

First run shows the installer. Click **“Run in PowerShell”** and follow the steps above.

### Packaging (Windows)

We ship the bootstrap with the app:

* `package.json` includes `build.extraResources: [{ from: "bin/", to: "bin/" }]`
* `npm run pack:win` passes `--extra-resource=bin`

So the packaged app has `resources\bin\bootstrap.ps1`.

---

## 🛠️ Advanced: local backend checkout (dev loop)

If you’re hacking on the OCaml repo:

```sh
parent/
├─ omni-chat/   # this repo
└─ omni-irc/    # backend
```

Build the backend:

```powershell
# Ensure a switch
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update

cd ..\omni-irc
opam install -y . --deps-only
dune build @install
```

The Electron app will auto-detect:

```sh
../omni-irc/_build/install/default/bin/omni-irc-client(.exe)
```

---

## 🍎🐧 macOS / Linux

The Windows bootstrap is PowerShell-based and launched by the app. On macOS/Linux, install the backend with `opam` manually (or adapt a shell bootstrap):

```bash
opam init -y
opam switch create omni-irc-dev ocaml-base-compiler.5.3.0
opam switch set omni-irc-dev
opam update
opam install -y opam-depext
opam depext -y omni-irc-client
opam pin add omni-irc https://github.com/jesse-greathouse/omni-irc.git#main -y
opam install -y omni-irc-client
```

Then run Omni Chat; it will find the client via `opam var bin`.

---

## 🧯 Troubleshooting

**“Invalid repository name … repo\default exists”**
The bootstrap handles this: it removes the stale repo dir or uses `opam repo set-url` as a fallback. If opam is holding a file lock, close other shells/IDEs and re-run.

**“opam not found” / “git not found”**
Install them and ensure they’re on PATH, then re-run the bootstrap from the installer.

**Loopback connect timeout**
Open **Errors** in the UI; verify the backend binary exists in `opam var bin` for the `omni-irc-dev` switch, or try the local build route.

**Hard reset (Windows)**
There’s a helper at `bin\uninstall.ps1` to wipe OPAM root and cached sources for a clean slate.

---
