# Code Signing Policy

> **Status:** application to [SignPath Foundation](https://signpath.org) pending.
> Until it is approved, Windows releases are unsigned and show a SmartScreen
> warning ("More info → Run anyway"). This page describes the policy that
> governs signing once active, and how releases are built and verified today.

## What gets signed

Windows installers (`Havoro Setup x.x.x.exe`) attached to
[GitHub Releases](https://github.com/charliemansell/havoro/releases).
Free code signing is provided by [SignPath.io](https://signpath.io);
the certificate is issued by the [SignPath Foundation](https://signpath.org).

## How releases are built

Every release binary is built **from the public source code in this repository**
by GitHub Actions — never on a developer's machine:

1. A version tag (`v1.x.x`) is pushed to this repository.
2. The [release workflow](../.github/workflows/release.yml) checks out the
   tagged source, builds the client, server, and Electron installer on
   GitHub-hosted runners.
3. The unsigned installer is submitted to SignPath, which signs it in a
   controlled environment after verifying it originated from this repository's
   CI pipeline.
4. The signed installer is attached to the GitHub Release.

The build is fully reproducible from the tag: anyone can inspect the workflow,
the source at that tag, and the produced artifact.

## Who can sign

Release signing requests can be approved only by the project maintainer:

- [Charlie Mansell](https://github.com/charliemansell) — creator and maintainer

Maintainer accounts use multi-factor authentication on both GitHub and SignPath.

## Verifying a signed release

After signing is active, verify a downloaded installer on Windows:

1. Right-click the `.exe` → **Properties** → **Digital Signatures** tab
2. The signature should be present and valid, with the publisher shown as
   **SignPath Foundation** (the certificate holder for open-source projects
   it sponsors)

Or from a terminal:

```powershell
Get-AuthenticodeSignature ".\Havoro Setup 1.1.0.exe" | Format-List
```

## Privacy commitment

This program does not transmit any user data to anyone — see the full
[privacy policy](https://charliemansell.github.io/havoro/privacy.html).
Code signing changes nothing about that: it only proves the installer you
downloaded is the one CI built from this repository's public source.

## Reporting

If a signed Havoro binary ever appears to misbehave, or you find a signed
binary that does not correspond to a tagged release in this repository, please
report it immediately via
[private vulnerability reporting](https://github.com/charliemansell/havoro/security).
