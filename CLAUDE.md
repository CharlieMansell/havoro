# Havoro — project notes

## Platform scope

Supported targets are **Windows and Linux desktop** (Electron), **self-hosted
server** (Docker), the **PWA**, and **iOS** (Capacitor, `ios/`).

**Android is deliberately out of scope.** Capacitor makes `npx cap add android`
almost free, which is exactly why this needs writing down — it is a decision,
not an oversight. Do not add an Android target, an Android build workflow, or
Android-specific code unless the decision is revisited.
