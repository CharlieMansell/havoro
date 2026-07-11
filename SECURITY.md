# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability
reporting: go to the repository's **Security** tab → **Report a vulnerability**.
Please do not open a public issue for anything security-sensitive.

You can expect an acknowledgement within a few days. This is a maintainer-run
open-source project, not a company with a security team — but reports are taken
seriously and fixes for confirmed issues are prioritised over feature work.

## Supported versions

Only the [latest release](../../releases/latest) is supported. Havoro has
an in-app update check (Settings → About) — staying current is one download.

## Scope notes

- Havoro runs entirely on the user's own hardware and handles their
  financial records; vulnerabilities that expose data to the network or to
  other local users are the highest priority.
- The threat model, hardening guidance for self-hosted installs, and the list
  of outbound connections are documented in
  [docs/SECURITY.md](docs/SECURITY.md).
- Release binaries are built from public source by CI — see
  [docs/CODE-SIGNING.md](docs/CODE-SIGNING.md). A signed binary that doesn't
  correspond to a tagged release is itself a security incident; please report
  it.
