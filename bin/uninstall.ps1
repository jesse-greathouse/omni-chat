# Hard-reset OPAM on Windows (user scope)
# - Kills opam/ocaml/dune processes
# - Removes all opam switches (if opam is present)
# - Clears OPAM/OCaml-related environment variables (Process/User/Machine)
# - Deletes OPAM root and its Cygwin/cache folders
# - (Optional) deletes cached omni-irc sources

$ErrorActionPreference = "Stop"

# 0) Paths we’ll wipe
$Root    = Join-Path $env:LOCALAPPDATA "opam"
$OmniSrc = Join-Path $env:LOCALAPPDATA "omni-irc\src"
$Legacy  = @("$env:APPDATA\opam", "$env:USERPROFILE\.opam")  # in case of old installs

# 1) Kill likely locking processes (ignore errors if not running)
$procs = 'opam','dune','ocamlc','ocamlopt','ocamldep','ocamldoc','ocamlrun',
         'ocamllsp','flexlink','dash','mintty','sh','bash'
Get-Process -Name $procs -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2) If OPAM root exists, try to remove switches first (quieter failures OK)
if (Test-Path $Root) {
  try {
    $env:OPAMROOT = $Root
    $env:OPAMYES  = "1"
    (opam switch list --root "$Root" --short 2>$null) | ForEach-Object {
      Write-Host "Removing switch: $_"
      opam switch remove --root "$Root" --yes $_
    }
  } catch {
    Write-Warning "Skipping switch removal (opam not available or already wiped)."
  }
}

# 3) Clear environment variables that could interfere (all scopes if possible)
$vars = 'OPAMROOT','OPAMSWITCH','OPAMYES',
        'OCAMLLIB','OCAMLPATH','CAML_LD_LIBRARY_PATH','CAML_LD_LIBRARY_PATH__F',
        'OCAML_TOPLEVEL_PATH','FLEXLINKFLAGS','FLEXDLL_CHAIN','MAKE','MAKEFLAGS','CC','CL'
foreach ($scope in 'Process','User','Machine') {
  foreach ($v in $vars) {
    try { [Environment]::SetEnvironmentVariable($v, $null, $scope) } catch {}
  }
}

# 4) Delete OPAM root (this also removes opam’s embedded Cygwin + caches)
if (Test-Path $Root) {
  Write-Host "Removing OPAM root: $Root"
  Remove-Item -LiteralPath $Root -Recurse -Force
}

# 5) (Optional) remove cached omni-irc sources to force a clean reclone
if (Test-Path $OmniSrc) {
  Write-Host "Removing cached omni-irc sources: $OmniSrc"
  Remove-Item -LiteralPath $OmniSrc -Recurse -Force
}

# 6) (Optional) delete legacy opam dirs if they exist
foreach ($d in $Legacy) {
  if (Test-Path $d) {
    Write-Host "Removing legacy OPAM dir: $d"
    Remove-Item -LiteralPath $d -Recurse -Force
  }
}

# 7) Final check
if (Test-Path $Root) {
  Write-Warning "Root still present → close all shells/IDEs and retry deleting '$Root'."
} else {
  Write-Host "Hard reset complete. OPAM (and caches) are gone for this user."
  Write-Host "Open a NEW PowerShell to ensure a clean environment."
}

# --- OPTIONAL: uninstall the opam program itself (if installed via winget) ---
# winget uninstall --id OCamlPro.opam-for-Windows -e
