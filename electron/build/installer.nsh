!macro customInit
  ; Havoro deliberately keeps running in the tray when its window is closed,
  ; so the installer's default graceful-close (send the window a close
  ; signal, wait for the process to exit) never actually terminates it —
  ; producing "Setup was unable to automatically close all instances".
  ; Every change is written straight to SQLite immediately, so there's no
  ; unsaved state to lose — force-close it up front instead of relying on
  ; a graceful shutdown that this app is specifically designed to ignore.
  ; /T also kills the spawned server child process (same image name, since
  ; it re-execs the same .exe under ELECTRON_RUN_AS_NODE).
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
!macroend

!macro customUnInstall
  MessageBox MB_ICONINFORMATION|MB_OK "Havoro has been uninstalled.$\r$\n$\r$\nYour data and backups have been kept at:$\r$\n$APPDATA\Havoro$\r$\n$\r$\nReinstalling will pick up right where you left off. Delete that folder yourself if you want to remove everything."
!macroend
