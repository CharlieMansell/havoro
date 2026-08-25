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

#### Set-up, once

**1. Enrol in the Apple Developer Program** — [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)

Choose **Individual** unless you have a registered company; Organization
enrolment needs a D-U-N-S number and takes considerably longer. Your Apple ID
needs two-factor authentication on. Identity verification is usually done
through the Apple Developer app on an iPhone, so have the phone handy.
US$99/year, auto-renewing. Approval is often same-day for individuals but can
take a couple of days.

**2. Register the bundle identifier** — Developer portal → **Certificates,
Identifiers & Profiles → Identifiers → +** → App IDs → App → Explicit, and
enter `com.havoro.app`. It must match `capacitor.config.json`.

**3. Create the app record** — App Store Connect → **Apps → +** → New App.
Pick iOS, select the bundle id from step 2, and give it an SKU (any internal
string). The **name has to be unique across the entire App Store**, so
"Havoro" may already be taken — the name here is only what appears in the
store listing, not on the phone, so pick anything free.

**4. Create an API key** — App Store Connect → **Users and Access →
Integrations → App Store Connect API → Team Keys → +**. Give it the
**App Manager** role and generate it.

Download the `.p8` immediately — **Apple lets you download it exactly once**.
Note the **Key ID** shown beside it and the **Issuer ID** at the top of the
page.

**5. Find your Team ID** — Developer portal → **Membership details**. Ten
characters, something like `A1B2C3D4E5`.

**6. Add four repository secrets** — GitHub → **Settings → Secrets and
variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `APPSTORE_KEY_ID` | The Key ID from step 4 |
| `APPSTORE_ISSUER_ID` | The Issuer ID from step 4 |
| `APPSTORE_PRIVATE_KEY` | The entire contents of the `.p8`, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |
| `APPLE_TEAM_ID` | The Team ID from step 5 |

Paste the `.p8` exactly as it is — line breaks and all. GitHub stores it
encrypted and masks it in logs.

**7. Run it** — Actions → **iOS TestFlight → Run workflow**.

#### After the upload

The build does not appear in TestFlight immediately: App Store Connect
processes it first, usually 5 to 30 minutes, and emails you if it rejects it.

**Internal testers** — up to 100 people on your own team, which includes you —
need no review and can install as soon as processing finishes. Add yourself
under TestFlight → Internal Testing and the invite arrives in the TestFlight
app.

**External testers** need Beta App Review, which is a real review against the
App Store guidelines and takes a day or so. Not worth bothering with until the
placeholder icons are replaced.

`ITSAppUsesNonExemptEncryption` is already set in `Info.plist`, which is what
stops App Store Connect asking the export-compliance question by hand on every
upload and holding the build until answered. It declares that the app uses no
encryption beyond the HTTPS iOS itself provides — true of Havoro, which calls
GitHub for updates and a price API and ships no cryptography of its own.

The build number comes from the workflow run number, which only ever goes up —
TestFlight rejects a build number it has already seen. The marketing version
comes from `package.json`, so a TestFlight build traces back to a release.

Signing assets are created by `xcodebuild` itself using the API key, which is
why there's no certificate `.p12` to export from a Mac you don't have.

**You must register at least one device before the first archive**, even though
nothing is ever installed on it directly and TestFlight itself does not need it.

This is unintuitive enough to be worth spelling out. With automatic signing,
`xcodebuild archive` signs with a **development** identity; distribution signing
happens afterwards, when `-exportArchive` re-signs the app using the
`app-store-connect` method in `ios/ExportOptions.plist`. Apple will not issue a
development profile to a team with no registered devices, so a brand-new account
fails the archive with:

```
Communication with Apple failed: Your team has no devices from which to
generate a provisioning profile.
No profiles for 'com.havoro.app' were found: Xcode couldn't find any
iOS App Development provisioning profiles matching 'com.havoro.app'.
```

Forcing `CODE_SIGN_IDENTITY="Apple Distribution"` to get around it does not work
— automatic signing owns the identity and rejects one being specified by hand:
*"App is automatically signed for development, but a conflicting code signing
identity Apple Distribution has been manually specified."* Register a device
instead.

**Registering a device from Windows:** install Apple Devices (or iTunes) from
the Microsoft Store, connect the iPhone by cable and trust the computer, select
the device, then click the serial number — it cycles through to the UDID, which
can be right-clicked and copied. Then Developer portal → **Certificates,
Identifiers & Profiles → Devices → +**, platform iOS, any name, and paste the
UDID.

Expect the first run to fail on something. iOS signing nearly always needs a
round or two, and this workflow has never been executed — it's written from
Apple's and GitHub's documented behaviour, not from a green build. The `.ipa`
is kept as an artifact even on failure so a broken upload doesn't cost a whole
rebuild.

### Testing without paying Apple anything

Three routes, in increasing order of how much they prove:

**1. The PWA, right now, zero setup.** The client is already a progressive web
app. Run the server (Docker, or the desktop app on your network), open it in
Safari on the phone and *Share → Add to Home Screen*. That tests the whole
interface on a real phone today. What it does not test is the native shell or
the on-device database — it's still talking to your server.

**2. Simulator screenshot in CI.** `.github/workflows/ios-unsigned.yml` builds
for the simulator, boots it, launches the app and uploads a screenshot as an
artifact. A simulator build needs no signing at all, so this works with no
Apple account of any kind. It's the cheapest proof that the thing compiles,
launches and renders — which nothing has confirmed yet.

**3. Unsigned .ipa, sideloaded to your own phone.** The same workflow archives
with signing disabled and packages an `.ipa` (which is only a zip with the
`.app` inside a `Payload/` directory). Download the artifact, then use
[Sideloadly](https://sideloadly.io/) or AltStore on Windows to re-sign it with
your **free** Apple ID and install it over USB.

The catch is Apple's, not ours: a free Apple ID signs for **7 days**, after
which the app stops opening and has to be reinstalled. You're also limited to
three sideloaded apps at once. AltStore can refresh automatically over Wi-Fi if
you leave AltServer running on the PC, which takes the sting out of it.

That third route runs the real native build, with the real on-device database,
on real hardware — everything TestFlight would give you except distribution to
other people and builds that last longer than a week.

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
- Importing a database file from a desktop or self-hosted install, and
  exporting one back out to the Files app — see below
- On-device restore points, the last 10 kept

**Not done yet:**

- **App icons and launch screen** are Capacitor's placeholders. The artwork in
  `client/public/` and `electron/build/` is the source to generate from.
- **CSV import** relies on a file picker that has not been wired to iOS. The
  browser `<input type="file">` works in a WKWebView for the Files app, but has
  not been tested on a device.
- **Excel (.xlsx) import — Amex's format — needs iOS 16.4 or newer.** The reader
  inflates the zip with `DecompressionStream`, which older WebKit lacks. The
  deployment target is 15.0, so on a 15.0–16.3 device the import refuses with a
  message naming the reason; CSV profiles work on any version.
- **Share prices** call out to the network from the client rather than a
  server; App Transport Security may need configuring.
- **No release build has ever been produced.** Nothing here has been compiled
  by Xcode — it is scaffolding, and the first `Run` on a Mac is where real
  problems will surface.
- **Nothing is submitted to the App Store**, and the sideloading path with a
  free Apple ID expires every 7 days.

---

## Data on the device

The database is a single SQLite file in the app's data directory. It is not
*shared* with the desktop or server builds — nothing syncs, and an iPhone
running this is a separate household ledger. It can be **moved**, though, in
either direction: the file format is identical across every build, so a
database is a database whether it came off a laptop, a Docker volume or a
phone.

Deleting the app deletes the database. Take a copy out first if it matters.

### Moving a database between the desktop app and the phone

Both directions go through **Settings → Database backups**.

**Desktop → phone**

1. On the desktop app, **Back up now**. Use this rather than copying
   `havoro.db` yourself: the running app keeps recent writes in a
   write-ahead log beside the database, and a hand-copied file can be missing
   them. The backup is a checkpointed, self-contained copy.
2. Take the newest `havoro-YYYY-MM-DD-HHMMSS.db` from the backup folder:

   | Build | Folder |
   |---|---|
   | Desktop app (Windows) | `%APPDATA%\Havoro\backups\` |
   | Desktop app (Linux) | `~/.config/Havoro/backups/` |
   | Docker / self-hosted | `data/backups/` in the mounted volume |

3. Get it onto the phone however you like — iCloud Drive, AirDrop, email to
   yourself. It needs to be somewhere the Files app can see it.
4. On the phone, **Import a backup file**, pick it, confirm. The app takes a
   restore point of what's already there first, then reloads into the imported
   database.

**Phone → desktop**

1. On the phone, **Export a copy**. This writes the database to the app's
   Documents folder, which appears in **Files → On My iPhone → Havoro**.
2. Move it off the phone from there, then use **Import a backup file** on the
   desktop app.

The importer refuses anything that isn't a Havoro database — it checks the
SQLite header, runs an integrity check, and looks for the tables it expects,
so a CSV or a half-copied file is rejected rather than replacing your data
with rubble. A database from an older release is migrated up to the current
schema on the way in, the same way the server migrates its own on startup
(`client/src/local/migrate.js`, mirroring `server/db/db.js`).

Going *backwards* — a database from a newer release into an older build — is
not handled and not checked for. Update the app first.

### Restore points on the device

**Back up now** on the phone keeps a copy in the app's private storage, and
the last 10 are retained. These are a safety net for a bad import or a
mistaken bulk delete, not a backup strategy: they live inside the app, so
deleting it takes them too, and the only copy that survives a lost phone is
one you exported and moved off.

There is no scheduled backup on iOS. A schedule needs something running at the
appointed time and an app that isn't open isn't running — the desktop build
has the same problem and works around it by backing up once per launch.
