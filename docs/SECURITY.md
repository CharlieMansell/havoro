# Havoro — Security

This document covers Havoro's security model, what data it stores, its design constraints, and recommendations for hardening your installation.

---

## Security model overview

Havoro is a **private, self-hosted application** designed to run on a machine you control (typically a Raspberry Pi on your home network). The security model is built on three principles:

1. **No bank credentials stored.** Havoro never asks for, stores, or transmits your banking username or password. Data entry is CSV-only.
2. **No external data transmission.** No data leaves your machine except for optional share price API calls (see below). There is no telemetry, no analytics, no external service dependency.
3. **Access control without complexity.** A standard web application model: bcrypt password hashing, JWT auth via httpOnly cookies, role-based admin/member access.

---

## What data is stored

| Data | Stored? | Notes |
|---|---|---|
| Bank usernames / passwords | **No** | Never requested or stored |
| Bank session tokens | **No** | No bank integrations |
| Transaction data | Yes | Imported from your own CSV exports |
| Account names and balances | Yes | Entered manually or derived from transactions |
| User passwords | Yes | bcrypt hash at cost 12, never plaintext |
| Auth tokens | Yes | JWT stored in httpOnly cookie, 7-day expiry |
| Property addresses | Yes | Optional; entered manually |
| Share portfolio holdings | Yes | Tickers and unit counts entered manually |
| IP addresses / access logs | No | No access logging by default |
| Browser fingerprints / analytics | No | No third-party scripts |

All data is stored in a single SQLite file (`havoro.db`) on the machine running the container.

---

## Authentication

- **Passwords** are hashed with bcrypt at cost factor 12 before storage. The plaintext password is never written anywhere.
- **Session tokens** are JWTs signed with your `JWT_SECRET`. They're stored in an httpOnly, SameSite=Lax cookie — JavaScript on the page cannot read them, which prevents XSS-based token theft.
- **Cookie lifetime** is 7 days. Logging out clears the cookie.
- **HTTPS:** Set `COOKIE_SECURE=true` in your `.env` if you're running behind a reverse proxy with TLS. Leave it `false` for plain HTTP on a local network — `Secure` cookies won't be sent over HTTP, which would break the app.

---

## Network exposure

By default, the app listens on the port you configure (`HOST_PORT`, default 3000) on all interfaces. On a home network this means:

- **Accessible to other devices on your Wi-Fi/LAN** — appropriate for a household app
- **Not accessible from the internet** — unless you explicitly port-forward through your router (not recommended)

### Recommended network configurations

| Setup | Use case |
|---|---|
| **Local only (default)** | Access only within your home Wi-Fi. No additional setup needed. |
| **Tailscale VPN** | Access from anywhere (phone, work laptop) without exposing ports to the internet. Free for personal use. |
| **Reverse proxy + TLS** | If you must expose to the internet — put Nginx or Caddy in front, add a TLS certificate, set `COOKIE_SECURE=true`. Not recommended unless you have a specific need. |

**Do not forward port 3000 directly to the internet** without a TLS layer. Basic HTTP over the public internet exposes session cookies to interception.

---

## External API calls

By default, Havoro makes no external network calls.

If you add share portfolio holdings, the server looks up prices with your stock tickers only (e.g. `BHP.AX`) — no account or personal data is sent:

- **Stooq** — queried first for each holding's price.
- **Yahoo Finance** (via `yahoo-finance2`) — used as a fallback if Stooq doesn't have a price for that ticker.

These are one-way lookups: ticker → price. Your financial data (balances, transaction history) is never sent to any external service.

---

## Self-hosted runner security

If you use a GitHub Actions self-hosted runner for auto-deployment, be aware:

**Risk: code execution on your machine triggered by anyone who can open a pull request.**

For a **private repository**, this risk is low — only collaborators you've approved can open PRs, and only people with write access can push to `main`. The deploy workflow only runs on `push` to `main`, not on PRs.

For a **public repository with a self-hosted runner**, the risk is significant:
- Anyone can fork the repo and submit a PR
- If any workflow runs on fork PRs, it runs on your machine with your network access
- The current workflow only runs on `push` to `main`, which mitigates the fork PR risk
- However, a compromised maintainer account could push malicious code to `main`

**Mitigations for public repositories:**
- Do not run a self-hosted runner on a public repository unless you have branch protection with required reviews
- Use the public repository as a template/reference, and keep your personal production deployment in a private fork
- If you need CI on PRs, use GitHub-hosted runners (free and isolated) rather than your self-hosted Pi runner for those workflows

---

## Data backup security

Backup files (`~/budget/backups/*.db`) contain the complete database including password hashes and all financial data. Protect them accordingly:

- Store backups on an encrypted drive if copying off the Pi
- Do not commit backups to any git repository (the `.gitignore` excludes `backups/` by default)
- If emailing or uploading backups anywhere, encrypt them first

---

## Responsible disclosure

This is a personal/hobby project. If you find a security issue, please open a private GitHub security advisory rather than a public issue.

---

## Hardening checklist

This checklist is for **self-hosted/Docker deployments**. The desktop app generates its own random secret and has no password at all — there's a first-run wizard that just asks for your first name, and every later launch signs you back in silently, since it's a single local account with no network exposure to defend against. That's a deliberate tradeoff: it only works because the server binds to `127.0.0.1` only in desktop mode, so there's genuinely nothing else on the network able to reach it in the first place.

- [ ] `JWT_SECRET` is a long random string (48+ bytes of hex), not the example placeholder — the server refuses to start otherwise
- [ ] Used a strong password when creating the admin account on first launch (there is no default account or password to leave unchanged)
- [ ] `COOKIE_SECURE=true` if running behind HTTPS
- [ ] App is not directly exposed to the internet (use Tailscale or reverse proxy + TLS if remote access is needed)
- [ ] Backups are working (check Settings → Database backups)
- [ ] Backup files are stored somewhere safe (not just on the Pi — if the Pi fails, you lose your data)
- [ ] If using a self-hosted runner: repository is private, or branch protection requires reviews before merging to `main`
