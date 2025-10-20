param(
  [string]$Switch     = "omni-irc-dev",
  [string]$Repo       = "https://github.com/jesse-greathouse/omni-irc",
  [string]$Rev        = "0.1.18", # preferred tag for prebuilt assets
  [string]$OcamlHint  = "5.3.0",  # preferred OCaml if available
  [ValidateSet("auto","mingw","msvc")]
  [string]$Toolchain  = "mingw"   # default to mingw on Windows; override if you must
)

$ErrorActionPreference = "Stop"

function Test-HttpUrl([string]$Url) {
  try {
    $r = Invoke-WebRequest -Method Head -Uri $Url -MaximumRedirection 5 -UseBasicParsing -Headers @{ "User-Agent"="omni-irc-bootstrap" }
    return $r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Download-File([string]$Url, [string]$Dest) {
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -Headers @{ "User-Agent"="omni-irc-bootstrap" }
}

function Expand-ZipTo([string]$ZipPath, [string]$DestDir) {
  if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Path $DestDir | Out-Null }
  Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
}

# Robust MOTW clearing (EXEs, DLLs, any file)
function Clear-Motw {
  param(
    [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName)]
    [string[]]$Paths
  )
  begin {
    $haveStreamParam = $false
    try {
      $def = (Get-Command Get-Item).Parameters['Stream']
      if ($def) { $haveStreamParam = $true }
    } catch { $haveStreamParam = $false }

    $unblock = { param($p)
      try { Unblock-File -LiteralPath $p -ErrorAction SilentlyContinue } catch {}
      if ($haveStreamParam) {
        try { Remove-Item -LiteralPath $p -Stream Zone.Identifier -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  }
  process {
    foreach ($p in $Paths) {
      if (-not (Test-Path -LiteralPath $p)) { continue }
      $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
      if (-not $item) { continue }
      if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue |
          ForEach-Object { & $unblock $_.FullName }
      } else {
        & $unblock $item.FullName
      }
    }
  }
}

function Resolve-ReleaseRef([string]$RepoUrl, [string]$Rev) {
  $candidates = @()
  if ($Rev -match '^\d') { $candidates += "v$Rev" }  # prefer vX.Y.Z if Rev is numeric
  $candidates += $Rev

  foreach ($cand in $candidates) {
    $out = git ls-remote --tags --refs $RepoUrl "refs/tags/$cand" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return @{ kind="tag"; name=$cand } }
  }
  foreach ($cand in $candidates) {
    $out = git ls-remote --heads $RepoUrl "refs/heads/$cand" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return @{ kind="head"; name=$cand } }
  }
  throw "Could not find tag or branch for '$Rev' (tried: $($candidates -join ', '))."
}

function Clone-Or-Update-Shallow([string]$RepoUrl, [hashtable]$Ref, [string]$DestDir) {
  if (-not (Test-Path (Split-Path $DestDir -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $DestDir -Parent) | Out-Null
  }
  if (-not (Test-Path $DestDir)) {
    git clone --depth 1 --branch $Ref.name $RepoUrl $DestDir | Out-Host
  } else {
    Write-Host "Reusing $DestDir"
    git -C $DestDir fetch --depth 1 --tags origin $Ref.name | Out-Host
    if ($Ref.kind -eq 'tag') {
      git -C $DestDir checkout --force "refs/tags/$Ref.name" | Out-Host
    } else {
      git -C $DestDir checkout --force $Ref.name | Out-Host
    }
    git -C $DestDir reset --hard --quiet | Out-Host
  }
}

function Get-Arch() {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { "arm64"; break }
    default { "x64" }
  }
}

function Add-DefenderExclusionAdmin([string]$Path) {
  $cmd = @"
try {
  Add-MpPreference -ExclusionPath '$Path'
  exit 0
} catch {
  exit 1
}
"@
  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
    "-NoProfile","-ExecutionPolicy","Bypass","-Command",$cmd
  )
  if ($p.ExitCode -ne 0) {
    throw "Could not add Defender exclusion (admin approval was denied or Add-MpPreference is unavailable)."
  }
}

function Remove-DefenderExclusionAdmin([string]$Path) {
  $cmd = @"
try {
  Remove-MpPreference -ExclusionPath '$Path'
  exit 0
} catch {
  exit 0
}
"@
  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
    "-NoProfile","-ExecutionPolicy","Bypass","-Command",$cmd
  ) | Out-Null
}

function Try-InstallPrebuilt([string]$Ver) {
  $Owner = "jesse-greathouse"
  $Repo  = "omni-irc"
  $Base  = "https://github.com/$Owner/$Repo/releases"

  $PlatCandidates = @("win64")
  $Arch          = Get-Arch

  $Root = Join-Path $env:LOCALAPPDATA "omni-irc\pkg"
  # ensure the root exists right now
  if (-not (Test-Path -LiteralPath $Root)) {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
  }

  $Tmp  = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid()) -Force

  foreach ($plat in $PlatCandidates) {
    $candidates = @(
      @{ Label="latest"; Url="$Base/latest/download/omni-irc-client-$plat-$Arch.zip" },
      @{ Label="v$Ver" ; Url="$Base/download/v$Ver/omni-irc-client-$Ver-$plat-$Arch.zip" }
    )

    foreach ($c in $candidates) {
      $code = Test-HttpUrl $c.Url
      Write-Host "[bootstrap] probe $($c.Url) -> $code"
      if ($code -ne 200 -and $code -ne 302) { continue }

      # --- NEW: pre-create the final install dir before UAC/exclusion ---
      $Inst = Join-Path $Root $c.Label
      if (-not (Test-Path -LiteralPath $Inst)) {
        New-Item -ItemType Directory -Path $Inst -Force | Out-Null
      }

      Write-Host ""
      Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Yellow
      Write-Host "Admin permission required:" -ForegroundColor Yellow
      Write-Host "This installer will download an UNSIGNED package from the internet." -ForegroundColor Yellow
      Write-Host "To allow this, we will add a Microsoft Defender exclusion" -ForegroundColor Yellow
      Write-Host "for the download *and* install folders (you can remove it later)." -ForegroundColor Yellow
      Write-Host "You'll see a UAC prompt now." -ForegroundColor Yellow
      Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Yellow
      Write-Host ""

      # Add temporary exclusions (elevated) — for BOTH paths that now exist
      try {
        Add-DefenderExclusionAdmin -Path $Tmp.FullName
        Add-DefenderExclusionAdmin -Path $Inst
      } catch {
        Write-Warning $_.Exception.Message
        Write-Warning "Proceeding without a Defender exclusion (download may be slower)."
        # continue; do not return
      }

      Write-Host "[bootstrap] fetching prebuilt client: $($c.Url)"
      $Zip = Join-Path $Tmp.FullName "pkg.zip"
      $downloadOk = $false
      try {
        Download-File $c.Url $Zip
        $downloadOk = $true
      } catch {
        Write-Warning ("[bootstrap] Download failed: {0}" -f $_.Exception.Message)
      } finally {
        # Optional: remove only the TEMP exclusion immediately; keep $Inst until we’ve finished extraction/MOTW
        # try { Remove-DefenderExclusionAdmin -Path $Tmp.FullName } catch {}
      }

      if (-not $downloadOk -or -not (Test-Path $Zip)) {
        Write-Warning "[bootstrap] Prebuilt download unavailable or blocked; falling back to source build."
        Remove-Item -LiteralPath $Tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue
        return $false
      }

      # Clear MOTW on the ZIP first
      Clear-Motw $Zip

      # Expand into the pre-created $Inst
      Expand-ZipTo $Zip $Inst

      # Clear MOTW on extracted files
      Clear-Motw $Inst

      # normalize -> <inst>\bin\omni-irc-client.exe
      $BinDir = Join-Path $Inst "bin"
      if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

      $found = @(
        (Join-Path $Inst "omni-irc-client.exe"),
        (Join-Path $Inst "bin\omni-irc-client.exe")
      ) | Where-Object { Test-Path $_ } | Select-Object -First 1

      if (-not $found) {
        $found = Get-ChildItem -Path $Inst -Filter "omni-irc-client.exe" -Recurse -ErrorAction SilentlyContinue |
                 Select-Object -First 1 | ForEach-Object { $_.FullName }
      }
      if (-not $found) { throw "omni-irc-client.exe not found in extracted package." }

      $destExe = Join-Path $BinDir "omni-irc-client.exe"
      Copy-Item -Force $found $destExe

      # Clear MOTW on normalized copy and adjacent DLLs
      Clear-Motw $destExe
      Get-ChildItem -LiteralPath $BinDir -Filter *.dll -ErrorAction SilentlyContinue | ForEach-Object {
        Clear-Motw $_.FullName
      }

      $env:OMNI_IRC_CLIENT = $destExe
      Write-Host "[bootstrap] using prebuilt binary at $env:OMNI_IRC_CLIENT"

      # Optional: now remove BOTH exclusions
      # try { Remove-DefenderExclusionAdmin -Path $Tmp.FullName } catch {}
      # try { Remove-DefenderExclusionAdmin -Path $Inst } catch {}

      Remove-Item -LiteralPath $Tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue
      return $true
    }
  }

  Write-Host "[bootstrap] no matching prebuilt asset found; falling back to opam build."
  return $false
}

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
if (Test-Path Env:OPAMSWITCH) {
  if ($env:OPAMSWITCH) {
    Write-Host ("Ignoring inherited OPAMSWITCH={0}" -f $env:OPAMSWITCH)
  } else {
    Write-Host "Ignoring inherited OPAMSWITCH (empty)"
  }
  Remove-Item Env:OPAMSWITCH -ErrorAction SilentlyContinue
}

# Try prebuilt first; if available, skip opam
if (Try-InstallPrebuilt $Rev) {
  & $env:OMNI_IRC_CLIENT --help
  Write-Host ""
  Write-Host "Done. OMNI_IRC_CLIENT=$env:OMNI_IRC_CLIENT"
  Write-Host "*******************************************************************" -ForegroundColor Green
  Write-Host "*  Omni-IRC bootstrap is COMPLETE (prebuilt). You can close now.  *" -ForegroundColor Green
  Write-Host "*******************************************************************" -ForegroundColor Green
  return
}

# ----------------------------- opam path (fallback) ---------------------------
$Root = Join-Path $env:LOCALAPPDATA "opam"
if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root | Out-Null }
$env:OPAMROOT = $Root
$env:OPAMYES  = "1"

if (-not (Test-Path (Join-Path $Root "config"))) {
  Invoke-OpamNoSwitch init --root "$Root" --disable-sandboxing
}

# repo check/add (handles stale dir)
$repoDir = Join-Path (Join-Path $Root 'repo') 'default'
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
    if ($IsWindows) { $want = "mingw" } else { $want = "auto" }
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($want -eq "msvc") {
    if ($OcamlHint) { $candidates.Add("ocaml-compiler.$OcamlHint,system-msvc,ocaml-env-msvc64") }
    $candidates.Add("ocaml-compiler.5.2.1,system-msvc,ocaml-env-msvc64")
    $candidates.Add("ocaml-base-compiler,system-msvc,ocaml-env-msvc64")
    Write-Warning "MSVC selected. Note: TLS/zarith often fails without a MSVC-built GMP/MPIR."
  } else {
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

# fetch omni-irc sources at locked tag/branch (shallow, tag-aware)
$SrcRoot = Join-Path $env:LOCALAPPDATA "omni-irc\src"
$SrcDir  = Join-Path $SrcRoot ("omni-irc-" + $Rev)
if (-not (Test-Path $SrcRoot)) { New-Item -ItemType Directory -Path $SrcRoot | Out-Null }

try {
  $ref = Resolve-ReleaseRef -RepoUrl $Repo -Rev $Rev
  $pretty = ($ref.kind -eq 'tag') ? "tag $($ref.name)" : "branch $($ref.name)"
  Write-Host "Cloning $Repo @ $pretty → $SrcDir"
  Clone-Or-Update-Shallow -RepoUrl $Repo -Ref $ref -DestDir $SrcDir
} catch {
  throw $_
}

# toolchain helpers (common)
Invoke-Opam install --root "$Root" --switch $Switch dune ocamlfind

# Pin ALL packages in the monorepo
$opamFiles = Get-ChildItem -LiteralPath $SrcDir -Filter '*.opam' -File -ErrorAction SilentlyContinue
if (-not $opamFiles) {
  Write-Warning "No .opam files found in $SrcDir. Ensure they are present (or generated)."
} else {
  $allNames   = $opamFiles | ForEach-Object { $_.BaseName } | Sort-Object -Unique
  $skipByName = @('omni-irc-ui-notty','omni-irc-io-unixsock')  # not for Win32

  if ($IsWindows) {
    $pkgNames =
      $opamFiles | Where-Object {
        $name = $_.BaseName
        $body = Get-Content -LiteralPath $_.FullName -Raw
        -not (
          $skipByName -contains $name -or
          $body -match 'available:\s*\[\s*os\s*!=\s*"win32"\s*\]'
        )
      } | ForEach-Object { $_.BaseName } | Sort-Object -Unique

    $skipped = $allNames | Where-Object { $pkgNames -notcontains $_ }
    if ($skipped) {
      Write-Host ("Skipping (Windows): {0}" -f ($skipped -join ', '))
    }
  } else {
    $pkgNames = $allNames
  }

  Write-Host "Pinning packages (register only; no build yet) from: $SrcDir"
  foreach ($pkg in $pkgNames) {
    Write-Host (" → pinning {0}" -f $pkg)
    Invoke-Opam pin add --root "$Root" --switch $Switch -k path --no-action $pkg $SrcDir
  }
  Invoke-Opam pin list --root "$Root" --switch $Switch
}

# Extra dep
Invoke-Opam install --root "$Root" --switch $Switch yojson

# Install the client
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
