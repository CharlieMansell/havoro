# Havoro on iOS

The iOS app is the same React client as the web and desktop builds, wrapped in
[Capacitor](https://capacitorjs.com/) and running with **no server**. There is
no backend to reach and no network call to make: the app answers its own
`/api/*` requests from a SQLite database on the device.

That is not a cut-down version — it is the whole app, including import,
categorisation, budgets and the transfer planner.

---

## How it works

```
┌─────────────────────────────────────────────┐
│  iOS app (Capacitor WKWebView)              │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  React client (client/dist)           │  │
│  │  identical to web and desktop          │  │
│  └──────────────────┬────────────────────┘  │
│                     │ fetch('/api/...')     │
│  ┌──────────────────▼────────────────────┐  │
│  │  localBackend.js                      │  │
│  │  wraps window.fetch, answers /api/*   │  │
│  │  sql.js (SQLite compiled to WASM)     │  │
│  └──────────────────┬────────────────────┘  │
│                     │                       │
│  ┌──────────────────▼────────────────────┐  │
│  │  storage.js → Capacitor Filesystem    │  │
│  │  havoro.db in the app data directory  │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

The switch is `VITE_LOCAL_BACKEND=1` at build time — see `client/src/main.jsx`.
Without it the same code builds the ordinary client that talks to the Express
server.

**Keeping the two in sync.** `client/src/local/localBackend.js` reimplements
the routes in `server/routes/` against the same schema. Change a route on the
server and the on-device copy needs the same change, or the app behaves
differently depending on which build you are running. The files say so at the
top; treat them as a pair.

---

## Building

Everything up to opening Xcode works on any OS. Compiling, signing and running
on a device need macOS.

```bash
npm install            # capacitor deps live in the root package.json
npm run build:ios      # builds the client with the on-device backend, then syncs
npm run ios:open       # opens ios/App in Xcode  (macOS only)
```

`build:ios` is the one to re-run after any change to the client — Capacitor
copies `client/dist` into the native project, so an un-synced change simply
will not appear in the app.

### Without a Mac at all

You don't need to own one — you need a macOS *runner*, and GitHub gives those
away free on public repositories (the 10x minute multiplier only applies to
private repos). `.github/workflows/ios-testflight.yml` builds on `macos-latest`
and uploads straight to TestFlight, so the phone in your pocket is the only
Apple hardware involved.

**The one unavoidable cost is Apple's Developer Program, US$99/year.**
TestFlight cannot be reached with a free Apple ID, and no CI arrangement gets
around that.

Set-up, once:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
2. In App Store Connect, create an app record with bundle id `com.havoro.app`
3. **Users and Access → Integrations → App Store Connect API**, create a key
   with the **App Manager** role, and download the `.p8`. You only get to
   download it once.
4. Add three repository secrets under **Settings → Secrets and variables →
   Actions**:

   | Secret | Where it comes from |
   |---|---|
   | `APPSTORE_KEY_ID` | Shown next to the key you created |
   | `APPSTORE_ISSUER_ID` | At the top of the same API keys page |
   | `APPSTORE_PRIVATE_KEY` | The whole `.p8` file contents, `BEGIN`/`END` lines included |
   | `APPLE_TEAM_ID` | Apple Developer → Membership details |

5. **Actions → iOS TestFlight → Run workflow**

The build number comes from the workflow run number, which only ever goes up —
TestFlight rejects a build number it has already seen. The marketing version
comes from `package.json`, so a TestFlight build traces back to a release.

Signing assets are created by `xcodebuild` itself using the API key, which is
why there's no certificate `.p12` to export from a Mac you don't have.

Expect the first run to fail on something. iOS signing nearly always needs a
round or two, and this workflow has never been executed — it's written from
Apple's and GitHub's documented behaviour, not from a green build. The `.ipa`
is kept as an artifact even on failure so a broken upload doesn't cost a whole
rebuild.

### On macOS, the first time

1. Xcode 15 or newer, from the App Store
2. `npm run ios:open`
3. Pick a development team under **Signing & Capabilities** — a free Apple ID
   works for running on your own device
4. Choose a simulator or your connected iPhone, and press Run

Capacitor 8 uses Swift Package Manager, so there is no CocoaPods step and no
`Podfile` to install.

---

## What is scaffolded, and what is not

**Working:**

- Native project at `ios/`, app id `com.havoro.app`, name Havoro
- The full client running against the on-device database
- Database persisted to a real file via Capacitor Filesystem, so it survives
  restarts and is covered by device backup
- Writes coalesced and flushed when the app is backgrounded

**Not done yet:**

- **App icons and launch screen** are Capacitor's placeholders. The artwork in
  `client/public/` and `electron/build/` is the source to generate from.
- **CSV import** relies on a file picker that has not been wired to iOS. The
  browser `<input type="file">` works in a WKWebView for the Files app, but has
  not been tested on a device.
- **Share prices** call out to the network from the client rather than a
  server; App Transport Security may need configuring.
- **Backups** write to the app's private directory with no way to get a file
  out. Exporting to the Files app or iCloud is unbuilt.
- **No release build has ever been produced.** Nothing here has been compiled
  by Xcode — it is scaffolding, and the first `Run` on a Mac is where real
  problems will surface.
- **Nothing is submitted to the App Store**, and the sideloading path with a
  free Apple ID expires every 7 days.

---

## Data on the device

The database is a single SQLite file in the app's data directory. It is not
shared with the desktop or server builds — an iPhone running this is a separate
household ledger unless you move a file across by hand, which there is
currently no UI for.

Deleting the app deletes the database.
