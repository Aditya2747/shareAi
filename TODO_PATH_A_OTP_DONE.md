# shareAi - Execution reliability & OTP MVP completion tracker

## Plan items
1. Align action strings end-to-end (intent.action -> APIExecutor switch cases)
2. Enforce workflow status transitions in /api/workflows/[id]/execute
3. Replace static OTP with persisted OTP + expiry (DB-backed)
4. Confirm Supabase schema/columns match code (add migration if needed)
5. Add requiredScopes check before executing API call
6. Verify end-to-end flow with local steps

## Progress
- [x] (1) Align action strings end-to-end
- [x] (2) Enforce workflow status transitions
- [ ] (3) Implement persisted OTP + expiry
- [x] (4) Confirm/adjust Supabase schema + migrations
- [x] (5) Add requiredScopes check
- [ ] (6) Run tests/dev verification


