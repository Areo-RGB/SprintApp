Param(
  [ValidateSet("all", "success", "tcp-conflict")]
  [string]$Scenario = "all",
  [string]$ExePath = "$PSScriptRoot/../../src-tauri/target/release/sprint-sync-windows-desktop-tauri.exe",
  [int]$HealthTimeoutSeconds = 20,
  [int]$HttpPort = 8787,
  [int]$TcpPort = 9000
)

$ErrorActionPreference = "Stop"

function Wait-ForHealth {
  Param(
    [int]$Port,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }

  return $false
}

function Wait-ForProcessExit {
  Param(
    [System.Diagnostics.Process]$Process,
    [int]$TimeoutMs = 15000
  )

  return $Process.WaitForExit($TimeoutMs)
}

function Stop-IfRunning {
  Param([System.Diagnostics.Process]$Process)

  if (-not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    [void](Wait-ForProcessExit -Process $Process -TimeoutMs 5000)
  }
}

function Assert-BackendStopped {
  Param([int]$Port)

  Start-Sleep -Milliseconds 700
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 1
    throw "Backend still responds on /api/health after desktop process shutdown."
  } catch {
    # Expected: endpoint no longer available.
  }
}

function Run-SuccessScenario {
  Param(
    [string]$ResolvedExe,
    [int]$Port,
    [int]$TimeoutSeconds
  )

  Write-Host "[smoke:success] Launching exe"
  $process = Start-Process -FilePath $ResolvedExe -PassThru
  try {
    if (-not (Wait-ForHealth -Port $Port -TimeoutSeconds $TimeoutSeconds)) {
      throw "[smoke:success] Healthcheck did not return 200 within $TimeoutSeconds seconds."
    }

    Write-Host "[smoke:success] Healthcheck succeeded"

    Stop-IfRunning -Process $process
    Assert-BackendStopped -Port $Port
    Write-Host "[smoke:success] Backend cleanup verified"
  } finally {
    Stop-IfRunning -Process $process
  }
}

function Run-TcpConflictScenario {
  Param(
    [string]$ResolvedExe,
    [int]$ConflictPort
  )

  Write-Host "[smoke:tcp-conflict] Reserving TCP port $ConflictPort"
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $ConflictPort)
  $listener.Start()

  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $ResolvedExe
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment["WINDOWS_TCP_PORT"] = "$ConflictPort"

    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
      if (-not (Wait-ForProcessExit -Process $process -TimeoutMs 15000)) {
        throw "[smoke:tcp-conflict] Desktop process did not exit within timeout."
      }

      if ($process.ExitCode -eq 0) {
        throw "[smoke:tcp-conflict] Expected non-zero exit code when TCP port is in use."
      }

      Write-Host "[smoke:tcp-conflict] Non-zero exit code verified: $($process.ExitCode)"
    } finally {
      Stop-IfRunning -Process $process
    }
  } finally {
    $listener.Stop()
  }
}

$resolvedExe = (Resolve-Path $ExePath -ErrorAction Stop).Path

switch ($Scenario) {
  "success" {
    Run-SuccessScenario -ResolvedExe $resolvedExe -Port $HttpPort -TimeoutSeconds $HealthTimeoutSeconds
    break
  }
  "tcp-conflict" {
    Run-TcpConflictScenario -ResolvedExe $resolvedExe -ConflictPort $TcpPort
    break
  }
  "all" {
    Run-SuccessScenario -ResolvedExe $resolvedExe -Port $HttpPort -TimeoutSeconds $HealthTimeoutSeconds
    Run-TcpConflictScenario -ResolvedExe $resolvedExe -ConflictPort $TcpPort
    break
  }
}

Write-Host "[smoke] Completed scenario '$Scenario'"
