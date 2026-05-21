# 大六壬 — 开机自启动安装脚本（以管理员身份运行此文件）
# 右键 → 使用 PowerShell 运行，或管理员终端执行: .\install-auto-start.ps1

$taskName = "DaLiuRen-Server"
$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "start-server.bat"

$action = New-ScheduledTaskAction -Execute $scriptPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 5) -RestartCount 999

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

Write-Host "已安装开机自启动任务: $taskName" -ForegroundColor Green
Write-Host "服务器将在每次开机时自动启动" -ForegroundColor Green
Start-ScheduledTask -TaskName $taskName
Write-Host "已立即启动服务器" -ForegroundColor Green
