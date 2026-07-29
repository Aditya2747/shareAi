# Scheduled runs (M4)

shareAi can run a saved **automation plan** on a cron schedule. Scheduling is intentionally strict so unattended runs cannot bypass human approval without an explicit, time-bounded standing approval.

## Safety rules

1. **Dry-run / preview required** before enabling a schedule  
   - API requires `dryRunAcknowledged: true`.  
   - Execute UI requires a checkbox: *I have dry-run / previewed this plan…*  
   - Until a real dry-run executor exists, treat the on-page **execution plan preview** as the mandatory review step. Do **not** enable schedules for plans you have not reviewed end-to-end (manual once-off run recommended).

2. **Approval-gated plans cannot be scheduled** unless the creator sets an **explicit standing approval with expiry**  
   - If any plan step has `requiresApproval: true`, `POST /api/plans/[id]/schedule` must include `standingApprovalExpiresAt` (future ISO timestamp).  
   - Standing approvals are stored in `standing_approvals` and checked on every scheduled tick.  
   - If standing approval is missing or expired at run time, the schedule is **disabled** and an error is recorded.

3. **Only the plan creator** can create/delete schedules.

4. **Worker is secret-protected** — `POST /api/internal/run-schedules` requires `INTERNAL_CRON_SECRET`.

## Schema

Migration: `supabase/migrations/010_schedules.sql`

| Table | Key columns |
| --- | --- |
| `schedules` | `plan_id`, `cron_expression`, `next_run_at`, `enabled`, `created_by`, `timezone`, `dry_run_acknowledged_at` |
| `standing_approvals` | `plan_id`, `created_by`, `expires_at` |

One schedule per plan (`UNIQUE(plan_id)`).

## API

### `POST /api/plans/[id]/schedule`

```json
{
  "cronExpression": "0 9 * * *",
  "timezone": "Asia/Kolkata",
  "dryRunAcknowledged": true,
  "standingApprovalExpiresAt": "2026-08-01T00:00:00.000Z"
}
```

`standingApprovalExpiresAt` is required only when the plan has approval steps.

### `DELETE /api/plans/[id]/schedule`

Removes the schedule for that plan.

### `GET /api/plans/[id]/schedule`

Returns current schedule, presets, and whether standing approval is required.

### `POST /api/internal/run-schedules`

Processes due schedules (`next_run_at <= now`, `enabled = true`).

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/internal/run-schedules" \
  -H "Authorization: Bearer $INTERNAL_CRON_SECRET"
```

Optional: `?limit=20`

Wire this to an external cron (GitHub Actions, Vercel Cron, system crontab) every 1–5 minutes.

## Execute page

Plan owners see **Run on a schedule** after login (and after required OAuth apps are connected):

- Toggle + presets (daily 9am, weekdays 9am, hourly)
- Dry-run acknowledgement checkbox
- Standing approval duration when the plan needs approval
- Save schedule / turn off removes schedule

Timezone defaults to the browser’s IANA zone.

## Env

```bash
# Min 16 characters. Required for the internal worker.
INTERNAL_CRON_SECRET=generate_a_long_random_string
```

## Recommended enable flow

1. Open execute link → review plan steps (preview).  
2. Run once manually (Authorize & Execute) and confirm result.  
3. Enable **Run on a schedule**, check dry-run acknowledgement, set standing approval if prompted, Save.  
4. Ensure `INTERNAL_CRON_SECRET` is set and an external cron hits `/api/internal/run-schedules`.
