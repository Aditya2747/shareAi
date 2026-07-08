# TODO - Finish MVP to ship safely

The core create -> share -> execute flow is implemented. Remaining work is mostly
production hardening and cleanup.

## P0 - Blockers

- [x] Replace static OTP (`123456`) with real OTP delivery + expiry storage
- [x] Verify execution audit logs persist in Supabase (`execution_logs`)
- [ ] Run and document end-to-end verification (creator + recipient + OAuth + execute)
- [x] Update docs so setup instructions match current code paths and env vars

## P1 - Product completeness

- [x] Enforce `workflows.expires_at` in metadata and execute routes
- [x] Remove dead/duplicate auth paths (`/api/otp/verify` legacy endpoint)
- [x] Add a supported token-seeding helper script or remove stale token-seeding docs

## P2 - Quality

- [ ] Add automated tests (`npm test`) for:
  - [ ] OTP/auth verify route
  - [ ] workflow create route
  - [ ] workflow execute route with mocked connectors/token manager
- [ ] Review/remove unused dependency `@supabase/auth-helpers-nextjs`

