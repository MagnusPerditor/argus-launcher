; Replace electron-builder's "app is running" check (which matches ANY process
; running from inside the install folder) with a check for Argus itself, by name.
!macro customCheckAppRunning
  argus_check_running:
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (Get-Process -Name ArgusLauncher -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"'
    Pop $R0
    Pop $R1
    StrCmp $R0 "0" 0 argus_check_done
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Argus Launcher is still running.$\r$\nClose it (or end ArgusLauncher.exe in Task Manager) and click Retry." /SD IDCANCEL IDRETRY argus_check_running
      Quit
  argus_check_done:
!macroend
