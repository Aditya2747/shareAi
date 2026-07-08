# Path A (OTP/Magic Link) - Implementation TODO

## Goal
Enable multi-user execution without relying on `NEXT_PUBLIC_EXECUTE_USER_ID` by introducing recipient identity via OTP/magic link.

## Steps
1) UI: `/execute/[id]`
   - Add an identity step before calling `/api/workflows/[id]/execute`.
   - Collect email.
   - Trigger OTP/magic link request.
   - Verify OTP.
   - On success, obtain `userId` to send `Authorization: Bearer <userId>`.

2) Backend: identity endpoints
   - `POST /api/identity/otp/request`
     - Create OTP (or send magic link) tied to a `userId`.
   - `POST /api/identity/otp/verify`
     - Verify OTP and return `userId` (and optionally a short-lived session token).

3) User identity mapping
   - Store OTP attempts and expiry in DB (recommended) or in a KV layer.
   - Define deterministic or generated `userId` approach.

4) Execution request update
   - Remove all usage of `NEXT_PUBLIC_EXECUTE_USER_ID`.
   - Always use the verified recipient `userId`.

5) Token readiness
   - Ensure `oauth_tokens.user_id` is keyed by the same recipient `userId`.
   - Update docs / seed instructions accordingly.

6) Testing
   - End-to-end test:
     - User A creates workflow.
     - User B executes via OTP.
     - Execution finds token rows for that `userId`.

## Notes
- Current OAuth endpoints are scaffolding and store dummy tokens.
- OTP/magic link is only needed to identify the recipient so `oauth_tokens.user_id` lookup works.

