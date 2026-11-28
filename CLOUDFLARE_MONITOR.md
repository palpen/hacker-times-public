# Cloudflare monitoring Worker

`hacker-times-monitor` is separate from the production reader/publisher. It has
no public route or publishing credentials. A named service binding reads a narrow
publisher recovery signal. The monitor has no direct access to the Newsroom store.
Its cron (`2-57/5 * * * *`) checks the public homepage and `/readyz` every five
minutes. A separate SQLite-backed Durable Object serializes checks and stores
one bounded state record.

Two consecutive failed checks open an incident and send one failure email.
The next healthy check sends one recovery email. A healthy check means both
endpoints pass; readiness JSON must also identify a published edition with a
snapshot no older than 45 minutes. Redirects, network errors, malformed readiness
responses, and non-200 responses fail. Requests time out after 10 seconds.
A missing monitoring interval resets failure confirmation. Repeated or older
cron slots cannot produce duplicate observations.

Failed email sends remain pending and retry on subsequent checks. A crash after
the provider accepts mail but before its acknowledgement is stored can produce
a duplicate email; exactly-once mail delivery is not claimed. No reminder emails
are sent for a continuing incident. Delivery failures appear in Worker logs.
A Cloudflare-wide failure can affect both the site and monitor.

## Publisher recovery emails

When publishing is enabled and an unfinished batch becomes eligible for recovery,
the monitor sends one action-needed email for that batch. Its **Recover expired
edition** link opens a manual GitHub workflow on `main` with no inputs. The
workflow uses the current candidate and checks the pending batch, publication
base, lease and safety state again before queuing fresh collection. An active
safety hold sends its own review email.

Queueing recovery is separate from publishing. After the newsroom records the
first successful replacement, the monitor checks that the homepage and `/readyz`
serve the same fresh version before emailing that a new edition is live. It can
confirm a later fresh edition if the monitor missed the first replacement.

After review, deploy production first so the named observer exists, then deploy
the monitor with its existing verified recipient and a credential authorized for
that separate Worker. The monitor deployment verification checks the private
read alongside the independent public probes.

## Free-plan setup

The monitor makes 288 scheduled checks per day, with two public probes per check,
and uses one SQLite-backed Durable Object. These resources support Workers Free;
limits are account-wide and shared with the site. No paid plan is activated by
the deployment workflow. The verified-recipient Email Routing path is free.
General Email Sending to arbitrary recipients is a different, paid feature.

1. Add and verify the intended destination in Cloudflare Email Routing.
2. Configure the sender domain for Email Routing. Preserve existing domain email
   services: inspect MX/SPF records before activation; do not replace them without
   the owner's authorization. `ALERT_FROM` must use an activated sender domain.
3. Store the recipient as environment secret `MONITOR_ALERT_TO` in the existing
   GitHub `production` environment. It is omitted from public source.
4. Run **Deploy Cloudflare monitor** from `main`.
   The workflow validates in one runner and deploys in a fresh runner using the
   configured deployment credential. That credential must include access to
   `hacker-times-monitor`; a token scoped only to `hacker-times-production`
   cannot deploy this Worker. It creates only the monitor Worker and its own
   storage. The generated email binding is restricted to the verified recipient.
5. Enable the optional `test_email` input for setup verification. An authenticated,
   temporary Wrangler preview reads monitor state, runs a live check, and sends
   two labeled synthetic failure/recovery emails. It does not simulate an outage
   on the production site or modify the production monitor's incident state.
6. Confirm both messages arrive in the intended inbox, then observe a real cron
   tick in monitor logs. API acceptance alone is not proof of inbox delivery.

The monitor workflow must exist on the default branch for manual dispatch and
runs only from `main`. Routine updates preserve the monitor's
Durable Object namespace and state. The source config intentionally omits the
private recipient; use the deployment script rather than deploying that config
unchanged. No email destination or token should be committed to the repository.

For diagnostics, the workflow logs a bounded state snapshot including the last
check, its results, incident status, and email failure flag. The private `/status`
operation has no route in the public Worker. No public email-test or failure-toggle
endpoint exists. The temporary diagnostic Worker is never part of production.

References:
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

This runbook describes the implementation. Deployment, sender setup, cron
execution, and actual email receipt must each be verified separately.

## Verified deployment (November 14, 2026)

The monitor was deployed using Wrangler OAuth with `account:read` and
`workers_scripts:write`. The similarly named `workers:write` scope did not
authorize script deployment. Email Routing is enabled for `hackertimes.ca`,
with `alerts@hackertimes.ca` as the sender and a verified private recipient.
Both labeled test messages were confirmed received in the destination mailbox.

The existing GitHub deployment token is scoped to the production Worker only.
The monitor is running independently of GitHub Actions; future workflow deploys
require a credential that also covers the monitor. Do not broaden the token
without owner approval. Local deployments can use the authorized Wrangler login
and a temporary copy of the monitor configuration with an absolute `main`,
`vars.ALERT_TO`, and `send_email[0].destination_address` set to the verified
recipient. Keep that generated configuration outside the repository.
