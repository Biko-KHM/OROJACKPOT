<#
.SYNOPSIS
  Database backup script for Windows environments.
.DESCRIPTION
  Dumps PostgreSQL database to a custom-compressed archive and generates SHA-256 checksum.
#>
[CmdletBinding()]
param(
  [string]$BackupDir = ".\backups",
  [string]$Database = $env:PGDATABASE,
  [string]$PgHost = $env:PGHOST,
  [string]$Port = $env:PGPORT,
  [string]$User = $env:PGUSER
)

if (-not $Database) { $Database = "telegram_lottery" }
if (-not $PgHost) { $PgHost = "localhost" }
if (-not $Port) { $Port = "5432" }
if (-not $User) { $User = "postgres" }

if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ")
$BackupFile = Join-Path $BackupDir "db_${Database}_${Timestamp}.dump"
$ChecksumFile = "${BackupFile}.sha256"

Write-Host "==> Starting database backup for $Database at $Timestamp..." -ForegroundColor Cyan

& pg_dump -h $PgHost -p $Port -U $User -F c -b -f $BackupFile $Database

if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

$Hash = (Get-FileHash -Path $BackupFile -Algorithm SHA256).Hash
Set-Content -Path $ChecksumFile -Value "$Hash  $([System.IO.Path]::GetFileName($BackupFile))"

Write-Host "==> Database dump completed: $BackupFile" -ForegroundColor Green
Write-Host "==> SHA-256 Hash: $Hash" -ForegroundColor Green
