param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ComposeArguments = @("up", "-d")
)

$environmentFile = Join-Path $PSScriptRoot "..\.env"

if (-not (Test-Path -LiteralPath $environmentFile)) {
  throw ".env is required. Copy .env.example and replace its placeholders."
}

Get-Content -LiteralPath $environmentFile | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable(
      $matches[1].Trim(),
      $matches[2].Trim(),
      "Process"
    )
  }
}

if (-not $env:DOCKER_DATABASE_URL) {
  if (-not $env:DATABASE_URL) {
    throw "DATABASE_URL or DOCKER_DATABASE_URL is required in .env"
  }

  $env:DOCKER_DATABASE_URL = $env:DATABASE_URL -replace `
    '@(?:localhost|127\.0\.0\.1):5433/', `
    '@fts-postgres:5432/'
}

if (-not $env:BOOTSTRAP_TOKEN) {
  throw "BOOTSTRAP_TOKEN is required in .env"
}

& docker compose @ComposeArguments
exit $LASTEXITCODE
