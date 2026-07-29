$ErrorActionPreference = "Stop"
$url = "http://localhost:3000/api/internal/run-schedules"
$secret = "w8CWnT5w2M6HXUPsulxIlwNEkkeUTK24W9atCRIs7j4="

try {
  $response = Invoke-RestMethod -Method Post -Uri $url -Headers @{
    Authorization = "Bearer $secret"
  }
  $line = "$(Get-Date -Format o) OK processed=$($response.processed)"
} catch {
  $line = "$(Get-Date -Format o) ERROR $($_.Exception.Message)"
}

Add-Content -Path "C:\Users\adity\documents\projects\shareAi\shareAi\scripts\shareai-cron.log" -Value $line