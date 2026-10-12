# OmniDrive personal deployment

## Current environment (12 October 2026)

- Panel/API/S3 origin: https://omnidrive-family.golamirreza19954312.workers.dev
- Worker: `omnidrive-family`; dedicated D1: `omnidrive-family-20261012`; dedicated KV: `OMNIDRIVE_FAMILY_20261012`.
- Existing older resources were not migrated or modified.
- Vite static assets are deployed with the Worker. `VITE_API_URL` is blank for same-origin calls; API/S3 paths always run the Worker.
- Encrypted-token upload, OAuth session binding/PKCE, Lax cookies, owner bootstrap guard, independent rate budgets and workspace destination checks have automated coverage.
- Deployment accepted by Cloudflare; external requests from both test environments are blocked by Cloudflare error 1010. Online health is NOT verified.
- Real Google OAuth, two-account upload/download/206, token refresh, rclone, Android and GPlus tests are still pending.

## Owner configuration

1. Enable Google Drive API in your own Google Cloud project.
2. Configure Google Auth Platform branding and an External audience. For Testing, add every Google account used for testing. Full Drive scope is restricted; review Google's personal-use/verification rules. Testing refresh tokens for Drive normally expire after seven days.
3. Create a Web application OAuth client. Authorized JavaScript origin is the panel origin above. Exact authorized redirect URI: `https://omnidrive-family.golamirreza19954312.workers.dev/api/auth/callback`.
4. In Cloudflare Worker Settings > Variables and Secrets, add **Secret** values named `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Do not commit them or paste them into chat.
5. Replace the temporary `SETUP_TOKEN` with your own random secret setup key. On the panel, Register using that key to create the first owner. Later registrations require invitations. Remove SETUP_TOKEN after owner creation. Never reuse a provider API token or provider password as the setup key.
6. Connect each Google Drive through Settings > Add Google Drive; consent belongs to the owner. This is separate from ChatGPT's Drive connection.

## Maintenance

Run `npm ci`, `npm test`, `npm run typecheck -w packages/worker`, `npm run build`. Deploy with `npm run deploy` after configuring `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` securely. Run checks as separate gates; never deploy after a failed command. Existing databases require a D1 export/Time Travel backup before changes. The supplied schema is for new empty databases; do not use reset on personal data. Set equivalent GitHub Actions secrets before enabling CI deployment. This repo's CI checks do not deploy automatically.

## Limits and pending validation

Workers Free quotas are shared with the account's other projects. Published limits include 100,000 dynamic requests/day, 10 ms CPU/HTTP request, 50 D1 queries/invocation; KV has 1,000 writes/day. Static-asset requests normally do not invoke the Worker. Session TTL is fixed at seven days; KV consistency means immediate cross-location logout revocation is not guaranteed. Cron currently runs every six hours.

Large Drive synchronization, bcrypt CPU usage on Workers Free, atomic concurrent workspace quota accounting, and large S3 multipart uploads still require validation/improvement. Full worker test TypeScript diagnostics are separate from the runtime-only typecheck; upstream test typings have unresolved warnings/errors. Never claim production readiness from unit tests alone.

For sustained video/music playback use Open in Drive. HTTP Range support does not establish that unrestricted Cloudflare media proxying is permitted. Windows can use rclone's S3 backend at `/s3`, configured with path-style addressing and a workspace-scoped credential. Browser/mobile/TV codec and seek compatibility and real rclone mount are unverified.

## Sources

- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/kv/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.google.com/identity/protocols/oauth2
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/
