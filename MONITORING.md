# Availability and publication freshness

`GET /readyz` (also `HEAD`) reads the current persisted publication, the same
edition served by `/api/edition`. It does not collect, publish, or resume work.
It returns `200` through 45 minutes of snapshot age and `503` thereafter.
Missing publications, storage failures, invalid timestamps and future timestamps
also return `503`. All responses use `Cache-Control: no-store`.

The timestamp is the published edition's `generatedAt`, not the last cron tick,
pending edition timestamp, or time an old edition finally finished publishing.
This catches stale content even if cron keeps firing. `/healthz` remains a
configuration/liveness diagnostic and is not a freshness monitor.

## External monitoring setup

Create two HTTP monitors in Better Stack (or another independent provider):

| Name | URL | Success |
| --- | --- | --- |
| Hacker Times availability | https://hackertimes.ca/ | HTTP 200 |
| Hacker Times freshness | https://hackertimes.ca/readyz | HTTP 200 |

Use GET, SSL verification, a 30-second request timeout, and a 2-minute check
interval if the account supports it; otherwise use the shortest free interval.
Set a 2-minute confirmation period and 1-minute recovery period where supported.
Confirmation is elapsed time, not a guaranteed count of checks. Actual notification
latency includes the polling interval and confirmation period in addition to the
45-minute age threshold.

Enable email incident alerts for the intended responder and resolved/recovery
notifications. Verify the recipient's email and on-call routing. Do not enable
paid phone/SMS options. Monitor creation alone does not prove email delivery.

After deployment, verify `/readyz` against `/api/edition` and confirm both monitors
are up. Use the provider's test notification. To test incident and recovery delivery
without disrupting publication, create a temporary monitor for an existing URL
that returns 404, wait for its failure email, then change that temporary monitor
to `/readyz` and wait for recovery and its email. Remove the test monitor afterward.
Do not add a public failure-toggle endpoint or deliberately stop production cron.

During an incident, inspect Workers logs for `hacker_times.background_run` and
private publisher status. The public readiness endpoint never exposes private
errors or editorial state. Planned publishing pauses will eventually make it stale;
use a bounded maintenance window in the monitor when a pause is intentional.

Provider references:
- https://betterstack.com/docs/uptime/uptime-monitor/
- https://betterstack.com/docs/uptime/confirmation-and-recovery-period/

Setup status must be verified in the provider account; this file is a runbook,
not evidence that monitoring or email delivery has been activated.
