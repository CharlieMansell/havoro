!macro customInstallMode
  ; Install for the current user only, always — no "who should this be
  ; installed for?" page. Picking "all users" put the app under
  ; %ProgramFiles%, which the app then runs from unelevated, and anything
  ; the server touched next to its own files failed with EPERM and took the
  ; process down on launch. There's nothing to share between accounts
  ; anyway: the database, backups and JWT secret all live in the per-user
  ; %APPDATA%\Havoro, so a machine-wide install bought nothing.
  ; Forcing it here (rather than perMachine: false, which only sets the
  ; page's default) makes electron-builder's install-mode page skip itself
  ; and pick $LocalAppData\Programs\Havoro — see multiUserUi.nsh's
  ; PAGE_INSTALL_MODE pre-function, which checks this flag first.
  ; Installer only: the uninstaller shares this page, and forcing the mode
  ; there would point an existing all-users uninstall at the wrong folder.
  !ifndef BUILD_UNINSTALLER
    StrCpy $isForceCurrentInstall "1"
  !endif
!macroend

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
