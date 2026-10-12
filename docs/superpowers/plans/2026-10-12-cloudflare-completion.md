# OmniDrive Cloudflare Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The owner explicitly requested autonomous execution in this session.

**Goal:** Deliver the existing personal/family service on the owner's Cloudflare account with verified Google Drive connectivity.

**Architecture:** One Worker serves static Vite assets and Hono API/S3. D1 stores metadata; KV stores sessions and encrypted OAuth tokens. Google remains the file storage and direct browser-upload destination.

**Tech Stack:** TypeScript, Hono, React/Vite, Vitest, Wrangler, D1, KV.

**Spec:** ../specs/2026-10-12-cloudflare-completion-design.md

## Global Constraints
- No paid upgrades, destructive real-data changes, public secrets, or unrelated project changes.
- Preserve existing PR branch; merge only after real smoke tests succeed.
- Use only disposable test files; back up existing databases before migration.

## Review Focus
- OAuth begun in one session and completed in a different local user session must fail before exchanging credentials.
- Browser upload must work with encrypted and expired stored credentials.
- First registration must not allow an arbitrary visitor to become owner.
- Nested login/API rate limiters must not count the same requests in each other's budget.
- Browser navigations under /api and /s3 must never receive index.html.

### Task 1: Reproduce and fix authentication defects
Files: routes/auth.ts, routes/drives.ts, middleware/rate-limiter.ts, lib/oauth.ts, tests/auth-security.test.ts, tests/rate-limiter.test.ts.
- [ ] Add behavioral tests for session-bound state, Lax cookies, owner bootstrap restriction, and independent rate limiter budgets.
- [ ] Run tests and inspect expected failures.
- [ ] Implement shared OAuth start, bound state validation, safe cookies, and independently scoped rate counters.
- [ ] Run the worker suite; record results.

### Task 2: Repair upload credentials and provision same-origin assets
Files: routes/files.ts, types/env.ts, wrangler.toml, package.json, tests/upload-init.test.ts, tests/deployment-config.test.ts.
- [ ] Reproduce encrypted-token upload failure and caller-specified unauthorized drive selection.
- [ ] Use GoogleDriveService.createResumableUpload with authorized selected drive and workspace access.
- [ ] Configure assets with SPA fallback and Worker-first API/S3 paths; same frontend/backend origin.
- [ ] Run suite, frontend build, Worker dry run, local HTTP smoke test.

### Task 3: External setup and real verification
- [ ] Complete owner sign-in; inventory Cloudflare and Google project resources.
- [ ] Create dedicated D1/KV or back up existing resources; configure OAuth client and secrets securely.
- [ ] Deploy the tested revision. Test login, two Drive connections, direct upload, listing, download/206, logout, session refresh, IDOR and S3 client.
- [ ] Record measured quotas and real-device evidence separately from emulation.
- [ ] Update English/Persian guides and execution report; review PR; merge only after delivery gates.
