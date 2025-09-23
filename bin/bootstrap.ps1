param(
  [string]$Switch     = "omni-irc-dev",
  [string]$Repo       = "https://github.com/jesse-greathouse/omni-irc",
  [string]$Rev        = "0.1.15", # locked tag
  [string]$OcamlHint  = "5.3.0",  # preferred OCaml if available
  [ValidateSet("auto","mingw","msvc")]
  [string]$Toolchain  = "mingw"   # default to mingw on Windows; override if you must
)

$ErrorActionPreference = "Stop"

function Test-Tool($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name not found. Please install $name and re-run."
  }
}

function Get-OpamExe { (Get-Command opam -CommandType Application -ErrorAction Stop).Source }

function Invoke-Opam {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$OpamArgs)
  $exe = Get-OpamExe
  & $exe --yes @OpamArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("opam failed (exit {0}): {1}" -f $LASTEXITCODE, ($OpamArgs -join ' '))
  }
}

function Invoke-OpamNoSwitch {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$OpamArgs)
  $exe = Get-OpamExe
  $old = $env:OPAMSWITCH
  if ($old) { Remove-Item Env:OPAMSWITCH -ErrorAction SilentlyContinue }
  & $exe --yes @OpamArgs
  $code = $LASTEXITCODE
  if ($old) { $env:OPAMSWITCH = $old }
  if ($code -ne 0) {
    throw ("opam failed (exit {0}): {1}" -f $code, ($OpamArgs -join ' '))
  }
}

# prerequisites
Test-Tool opam
Test-Tool git

# clear inherited env that might confuse opam
if (Test-Path Env:OPAMSWITCH) { Write-Host ("Ignoring inherited OPAMSWITCH={0}" -f $env:OPAMSWITCH); Remove-Item Env:OPAMSWITCH -ErrorAction SilentlyContinue }
foreach ($v in 'OCAMLLIB','OCAMLPATH','CAML_LD_LIBRARY_PATH','CAML_LD_LIBRARY_PATH__F',
              'OCAML_TOPLEVEL_PATH','FLEXLINKFLAGS','FLEXDLL_CHAIN','MAKE','MAKEFLAGS','CC') {
  if (Test-Path "Env:$v") { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
}

# opam root & repo
$Root = Join-Path $env:LOCALAPPDATA "opam"
if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root | Out-Null }
$env:OPAMROOT = $Root
$env:OPAMYES  = "1"

if (-not (Test-Path (Join-Path $Root "config"))) {
  Invoke-OpamNoSwitch init --root "$Root" --disable-sandboxing
}

# repo check/add (handles stale dir)
$repoDir = Join-Path (Join-Path $Root 'repo') 'default'
# ask opam which repos are known for this root (may be empty if no switch selected)
$reposRaw = ''
try { $reposRaw = Invoke-OpamNoSwitch repo list --root "$Root" --short 2>$null } catch { $reposRaw = '' }
$haveDefaultListed = (($reposRaw -split "`r?`n") -contains 'default')
$haveDefaultDir    = Test-Path $repoDir

if (-not $haveDefaultListed) {
  if ($haveDefaultDir) {
    Write-Host "Repo dir exists but 'default' is not registered; removing stale dir and re-adding…"
    try { Remove-Item -LiteralPath $repoDir -Recurse -Force -ErrorAction Stop } catch {
      Write-Warning "Could not remove stale repo dir at repoDir: $($_.Exception.Message)"
      Write-Warning "Proceeding to try 'repo set-url' as a fallback."
      try {
        Invoke-OpamNoSwitch repo set-url --root "$Root" default https://opam.ocaml.org --set-default
        $haveDefaultListed = $true
      } catch {
        throw "opam repo registration is inconsistent and the stale dir couldn't be removed. Please close shells/IDEs and delete '$repoDir' manually, then re-run."
      }
    }
  }
  if (-not $haveDefaultListed) {
    Invoke-OpamNoSwitch repo add --root "$Root" default https://opam.ocaml.org --set-default
  }
} else {
  Write-Host "Default repo already registered."
}

Write-Host "Updating opam package index…"
Invoke-OpamNoSwitch update --root "$Root"

# Decide toolchain ladder
function New-Switch([string]$sw,[string[]]$candidates) {
  foreach ($spec in $candidates) {
    Write-Host (" → trying package set: {0}" -f $spec)
    try {
      Invoke-OpamNoSwitch switch create --root "$Root" $sw --packages $spec
      return $true
    } catch { continue }
  }
  return $false
}

$switches = (& (Get-OpamExe) switch list --root "$Root" --short 2>$null)
$haveSwitch = ($switches -split "`r?`n") -contains $Switch

if (-not $haveSwitch) {
  Write-Host "No '$Switch' switch found. Creating it…"

  $want = $Toolchain
  if ($want -eq "auto") {
    if ($IsWindows) {
      $want = "mingw"
    } else {
      $want = "auto"
    }
  }

  $candidates = New-Object System.Collections.Generic.List[string]

  if ($want -eq "msvc") {
    if ($OcamlHint) { $candidates.Add("ocaml-compiler.$OcamlHint,system-msvc,ocaml-env-msvc64") }
    $candidates.Add("ocaml-compiler.5.2.1,system-msvc,ocaml-env-msvc64")
    $candidates.Add("ocaml-base-compiler,system-msvc,ocaml-env-msvc64")
    Write-Warning "MSVC selected. Note: TLS/zarith often fails without a MSVC-built GMP/MPIR."
  } else {
    # mingw (default on Windows)
    if ($OcamlHint) { $candidates.Add("ocaml-compiler.$OcamlHint,system-mingw,ocaml-env-mingw64,mingw-w64-shims") }
    $candidates.Add("ocaml-compiler.5.2.1,system-mingw,ocaml-env-mingw64,mingw-w64-shims")
    $candidates.Add("ocaml-base-compiler,system-mingw,ocaml-env-mingw64,mingw-w64-shims")
  }

  if (-not (New-Switch $Switch $candidates)) {
    throw "Could not create switch '$Switch' (tried: $($candidates -join ' | '))."
  }
}

# Activate env for this process
$envLines = & (Get-OpamExe) env --root "$Root" --switch $Switch --set-switch
$envLines -split '\r?\n' | ForEach-Object { Invoke-Expression $_ }

# Sanity and toolchain print
$oc = Get-Command ocamlc -ErrorAction Stop
$ver = & $oc.Source -version
$where = & $oc.Source -where
Write-Host ("Using ocamlc {0} at {1} ({2})" -f $ver, $where, $oc.Source)

try {
  $cfg = & ocamlopt -config 2>$null
  if ($LASTEXITCODE -eq 0) {
    ($cfg -split "`r?`n") | Where-Object { $_ -match '^\s*system:\s*(.+)\s*$' } | ForEach-Object {
      Write-Host ("Toolchain system: {0}" -f ($Matches[1]))
    }
  }
} catch {}

# fetch omni-irc sources at locked tag
$SrcRoot = Join-Path $env:LOCALAPPDATA "omni-irc\src"
$SrcDir  = Join-Path $SrcRoot ("omni-irc-" + $Rev)
if (-not (Test-Path $SrcRoot)) { New-Item -ItemType Directory -Path $SrcRoot | Out-Null }

if (-not (Test-Path $SrcDir)) {
  Write-Host "Cloning $Repo @ $Rev → $SrcDir"
  git clone --depth 1 --branch $Rev $Repo $SrcDir | Out-Host
} else {
  Write-Host "Reusing $SrcDir"
  git -C $SrcDir fetch --tags --depth 1 origin $Rev | Out-Host
  git -C $SrcDir checkout --force $Rev | Out-Host
  git -C $SrcDir reset --hard --quiet | Out-Host
}

# toolchain helpers (common)
Invoke-Opam install --root "$Root" --switch $Switch dune ocamlfind

# Pin ALL packages in the monorepo so opam can resolve cross-deps like omni-irc-conn
$opamFiles = Get-ChildItem -LiteralPath $SrcDir -Filter '*.opam' -File -ErrorAction SilentlyContinue
if (-not $opamFiles) {
  Write-Warning "No .opam files found in $SrcDir. Ensure they are present (or generated)."
} else {
  # Order is irrelevant when using --no-action
  $pkgNames = $opamFiles | ForEach-Object { $_.BaseName } | Sort-Object -Unique
  Write-Host "Pinning packages (register only; no build yet) from: $SrcDir"
  foreach ($pkg in $pkgNames) {
    Write-Host (" → pinning {0}" -f $pkg)
    Invoke-Opam pin add --root "$Root" --switch $Switch -k path --no-action $pkg $SrcDir
  }

  # show what’s pinned
  Invoke-Opam pin list --root "$Root" --switch $Switch
}

# WORKAROUND: omni-irc-ui.loopback needs yojson but the opam for omni-irc-ui may not declare it.
# Install yojson up-front so the build doesn't fail on missing library.
Invoke-Opam install --root "$Root" --switch $Switch yojson

# Finally, install the client (this pulls TLS + friends on non-win32-only packages)
Invoke-Opam install --root "$Root" --switch $Switch omni-irc-client

# report
$bin = (& (Get-OpamExe) var --root "$Root" bin).Trim()
Write-Host "omni-irc-client installed to: $bin"
$exe = Join-Path $bin "omni-irc-client.exe"
if (Test-Path $exe) { & $exe --help }

Write-Host "`nDone. This terminal now has:"
Write-Host "  OPAMROOT   = $Root"
Write-Host "  OPAMSWITCH = $Switch"
Write-Host ""
Write-Host "*******************************************************************" -ForegroundColor Green
Write-Host "*  Omni-IRC bootstrap is COMPLETE. You can now close this window. *" -ForegroundColor Green
Write-Host "*******************************************************************" -ForegroundColor Green
