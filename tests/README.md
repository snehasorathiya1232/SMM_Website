# BHAVISHYAA Automated Backend Test Suite

Permanent automated backend verification suite for **BHAVISHYAA** Social Media Marketing Panel.

## Running Tests

To run the full suite:

```bash
npm test
```

## Coverage (17 Test Suites)

1. **Test 1: Invalid & Missing Input** — Validates payload rejection with HTTP 400 when missing links or services.
2. **Test 2: Cross-User Access Isolation** — Confirms RLS and HTTP 403 blocks cross-user order access.
3. **Test 3: Duplicate Order Idempotency** — Deduplicates repeat submissions using cryptographic hashes.
4. **Test 4: Insufficient Balance Check** — Authoritative server-side pricing and ledger checks.
5. **Test 5: Future Orders Scheduling** — Confirms future scheduled runs remain pending.
6. **Test 6: Expired Orders (Rule 4)** — Ensures orders exceeding execution window are skipped, never started late.
7. **Test 7: Concurrency Clamp (Rules 1 & 2)** — Strictly limits execution to one active run per queue.
8. **Test 8: Atomic Queue Lock Isolation** — Validates multi-worker lock acquisition prevention.
9. **Test 9: Failure Isolation (Rule 7)** — Graceful recovery on provider timeouts without daemon crashes.
10. **Test 10: Server Restart Recovery** — Reconciles in-flight jobs after server or daemon restarts.
11. **Test 11: Exactly-Once Reminder Delivery** — Deduplicated notification delivery 2 hours prior to completion.
12. **Test 12: Reminder Suppression for Inactive Orders** — No reminders sent for cancelled or completed orders.
13. **Test 13: Extension Pricing & Stale Invalidation** — End-time extension calculation and reminder invalidation.
14. **Test 14: Provider Cancellation Policy Enforcement** — Order status verification and safe local cancellation.
15. **Test 15: Webhook HMAC Verification & Anti-Replay** — SHA-256 HMAC verification on provider callbacks.
16. **Test 16: SSRF & Cloud Metadata Protection** — Blocks access to cloud metadata (169.254.169.254) and private subnets.
17. **Test 17: Timezone Formatting & Boundaries** — Validates user timezone localization and DST formatting.
