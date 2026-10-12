# OmniDrive personal Cloudflare completion

The owner's execution brief is the authority: complete the existing fork for personal and family use, deploy exclusively to the owner's Cloudflare Free account, and verify two real Google OAuth connections. No paid upgrade, destructive operation on real files, secret disclosure, or changes to other projects are authorized.

## Architecture

Serve Vite assets and Hono API/S3 routes from a single Worker origin. Use dedicated D1 and KV bindings. API and S3 requests must reach the Worker rather than SPA fallback. Session and OAuth cookies use HttpOnly, Secure on HTTPS, SameSite=Lax. OAuth uses PKCE S256, short-lived state tied to the initiating user and session; a switched session must fail before token exchange.

Keep Google credentials encrypted, retain existing refresh credentials when reconnecting, and avoid per-request KV writes. Route browser uploads directly to Google resumable sessions using the service's refreshed/decrypted token. First administrator provisioning must be restricted by a private SETUP_TOKEN secret and protect against concurrent first registrations.

## Delivery gates

Automated route tests are distinct from real Google/Cloudflare/device evidence. Do not merge until real smoke tests succeed. D1 must be backed up before modifying an existing database. All test files have a dedicated OmniDrive test prefix. Cloudflare and Google limits and policies must be checked against official documentation. Prefer Google Drive's player for sustained media use; the Worker path is not a promise of unlimited free streaming.

## Current access

GitHub plugin works; PR #1 is a draft on 57057add. RoboT is online, Linux, with git/node/npm. Cloudflare requires sign-in. Google Cloud shows Site Unavailable in Work browser even after one reload. Account setup and real tests remain blocked until access is available.
