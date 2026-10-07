<#
.SYNOPSIS
    Installs Gravity Fusion into the Antigravity global plugins directory.

.DESCRIPTION
    Safely copies the gravity-fusion plugin bundle from this repository into
    the user's Antigravity plugins directory (C:\Users\<user>\.gemini\config\plugins\gravity-fusion).

    SAFE DEFAULT:
    By default, this script operates in -DryRun mode ($true). It previews
    all files and directories that would be copied without making any changes.
    Actual copying requires explicit -Execute or -Confirm:$false.
    If the target directory exists, explicit -Force is required to overwrite.

.PARAMETER Execute
    Explicit switch to perform the actual file copy.

.PARAMETER DryRun
    Preview changes without copying. Defaults to $true if -Execute or -Confirm:$false is omitted.

.PARAMETER Force
    Overwrite the target directory if it already exists.

.PARAMETER TargetPluginsDir
    Optional override for the destination plugins directory.
    Defaults to ~/.gemini/config/plugins.

.EXAMPLE
    # Safe dry-run preview (default)
    .\scripts\install.ps1

.EXAMPLE
    # Perform installation
    .\scripts\install.ps1 -Execute

.EXAMPLE
    # Perform installation with -Confirm:$false
    .\scripts\install.ps1 -Confirm:$false

.EXAMPLE
    # Overwrite existing installation
    .\scripts\install.ps1 -Execute -Force
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [switch]$Execute,
    [switch]$DryRun,
    [switch]$Force,
    [string]$TargetPluginsDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve repository and source paths
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SourcePluginDir = Join-Path $RepoRoot "plugin"

if (-not (Test-Path $SourcePluginDir)) {
    Write-Error "Source plugin directory does not exist: $SourcePluginDir"
    exit 1
}

# Resolve destination directory
if (-not $TargetPluginsDir) {
    if ($env:GEMINI_PLUGINS_DIR) {
        $TargetPluginsDir = $env:GEMINI_PLUGINS_DIR
    } else {
        $TargetPluginsDir = Join-Path $env:USERPROFILE ".gemini\config\plugins"
    }
}

$TargetInstallDir = Join-Path $TargetPluginsDir "gravity-fusion"
$targetExists = Test-Path $TargetInstallDir

# Evaluate dry-run vs execution mode
# Safe default: DryRun = $true unless explicitly commanded to execute
$shouldExecute = $false
if ($Execute.IsPresent) {
    $shouldExecute = $true
} elseif ($PSBoundParameters.ContainsKey('Confirm') -and (-not $Confirm)) {
    $shouldExecute = $true
}

if ($DryRun.IsPresent) {
    $shouldExecute = $false
}

# Enumerate items in source plugin directory
$sourceItems = Get-ChildItem -Path $SourcePluginDir -ErrorAction SilentlyContinue

# DRY-RUN MODE (Default)
if (-not $shouldExecute) {
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host " Gravity Fusion Installation Preview (DRY RUN - No changes made)" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "Source:       $SourcePluginDir"
    Write-Host "Destination:  $TargetInstallDir"
    if ($targetExists) {
        Write-Host "Target state: ALREADY EXISTS (requires -Force to overwrite)" -ForegroundColor Yellow
    } else {
        Write-Host "Target state: Does not exist (ready for installation)" -ForegroundColor Green
    }
    Write-Host "`nItems that would be copied:" -ForegroundColor Gray
    foreach ($item in $sourceItems) {
        $typeTag = if ($item.PSIsContainer) { "[DIR] " } else { "[FILE]" }
        Write-Host "  $typeTag $($item.Name)" -ForegroundColor Gray
    }

    Write-Host "`n------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "[NOTE] This was a safe dry-run preview. No files were written." -ForegroundColor Yellow
    Write-Host "`nTo actually perform the installation, run:"
    $forceHint = if ($targetExists) { " -Force" } else { "" }
    Write-Host "  .\scripts\install.ps1 -Execute$forceHint" -ForegroundColor White
    Write-Host "or:"
    Write-Host "  .\scripts\install.ps1 -Confirm:`$false$forceHint" -ForegroundColor White
    Write-Host "`nAfter installation:"
    Write-Host "  1. Restart Antigravity IDE to load plugins, agents, and hooks."
    Write-Host "  2. Run 'node scripts/verify-live.mjs' to verify live health."
    Write-Host "============================================================`n" -ForegroundColor Cyan
    exit 0
}

# EXECUTION MODE
Write-Host "`n=== Executing Gravity Fusion Installation ===" -ForegroundColor Cyan
Write-Host "Source:      $SourcePluginDir"
Write-Host "Destination: $TargetInstallDir"

if ($targetExists) {
    if (-not $Force.IsPresent) {
        Write-Error "Target directory already exists at '$TargetInstallDir'. Specify -Force to overwrite."
        exit 1
    }
    Write-Host "Overwriting existing target: Removing '$TargetInstallDir'..." -ForegroundColor Yellow
    Remove-Item -Path $TargetInstallDir -Recurse -Force
}

# Ensure destination parent directory exists
$destParent = Split-Path -Parent $TargetInstallDir
if (-not (Test-Path $destParent)) {
    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
}

# Copy plugin bundle
Write-Host "Copying plugin directory contents..." -ForegroundColor Cyan
Copy-Item -Path $SourcePluginDir -Destination $TargetInstallDir -Recurse -Force

if (-not (Test-Path $TargetInstallDir)) {
    Write-Error "Installation failed: target directory does not exist after copy."
    exit 1
}

Write-Host "`n[SUCCESS] Gravity Fusion installed successfully to:" -ForegroundColor Green
Write-Host "  $TargetInstallDir`n" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Restart Antigravity IDE to load plugins, agents, and hooks."
Write-Host "  2. Run 'node scripts/verify-live.mjs' to verify live health.`n"
