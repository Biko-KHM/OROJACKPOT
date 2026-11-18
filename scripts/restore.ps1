<#
.SYNOPSIS
  Database restore script for Windows environments.
.DESCRIPTION
  Verifies SHA-256 hash and restores custom-format dump into PostgreSQL database.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [string]$DumpFile,
  [string]$Database = $env:PGDATABASE,
  [string]$PgHost = $env:PGHOST,
  [string]$Port = $env:PGPORT,
  [string]$User = $env:PGUSER
)

if (-not $Database) { $Database = "telegram_lottery" }
if (-not $PgHost) { $PgHost = "localhost" }
if (-not $Port) { $Port = "5432" }
if (-not $User) { $User = "postgres" }

if (-not (Test-Path $DumpFile)) {
  Write-Error "Dump file not found: $DumpFile"
  exit 1
}

$ChecksumFile = "${DumpFile}.sha256"
if (Test-Path $ChecksumFile) {
  Write-Host "==> Verifying SHA-256 checksum..." -ForegroundColor Cyan
  $ExpectedHash = ((Get-Content $ChecksumFile) -split "\s+")[0].Trim().ToUpper()
  $ActualHash = (Get-FileHash -Path $DumpFile -Algorithm SHA256).Hash.ToUpper()

  if ($ExpectedHash -ne $ActualHash) {
    Write-Error "CHECKSUM MISMATCH! Expected: $ExpectedHash, Computed: $ActualHash"
    exit 1
  }
  Write-Host "==> Integrity verified." -ForegroundColor Green
}

Write-Host "==> Restoring database from $DumpFile into $Database..." -ForegroundColor Cyan
& pg_restore -h $PgHost -p $Port -U $User -d $Database --clean --if-exists --no-owner --no-privileges -v $DumpFile

Write-Host "==> Database restore completed." -ForegroundColor Green
