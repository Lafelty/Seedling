# Phase 4: demo feedback and iteration

Status: live navigation verification complete; tester materials ready; tester
sessions, feedback collection and feedback-driven changes pending.

This phase follows the current reliability, patient experience and release
readiness work. The older `PHASE_5_SUMMARY.md` describes a separate July session
player implementation sequence.

## Verified starting point

- Demo: https://neugrow.vercel.app/
- On 2026-09-06, fresh signed-out Chromium visits to Garden, Progress, Exercises,
  Profile and Admin all reached Login. Login to Signup and back also passed.
- These were live, unmocked public-page checks with no account submissions or
  exercise sessions. The previously observed signed-out navigation bug is closed.
- Evidence: ignored `test-results/phase-four-live-report.json`. The behavior was
  checked after merge `b5842d5`; the deployed commit was not independently identified.
- Automated and live database contract results remain recorded in
  [Phase 3](phase-three-release-readiness.md). Physical-device/accessibility and
  real-camera save/retry checks remain skipped by the user; therapist review is
  pending. Demo feedback does not satisfy those release requirements.

## First feedback round

The project owner can run a first round with three demo testers, one at a time.
Use separate non-admin demo accounts with fictitious profile details. Provide
credentials privately, outside the tracked guide or feedback file. No invitations
have been sent and no new accounts have been created for this round.

Give each tester the [tester guide](demo-tester-guide.md). Allow about ten minutes
and let them try each task before offering help. This round covers navigation,
clarity and exercise preparation only. Stop before enabling the camera; it does
not reinstate the manual checks previously skipped.

For each task, record one of: completed without help, completed with help, blocked,
or not attempted. Record their words and where they hesitated, rather than assuming
what they meant. An empty journal or chart is a valid outcome for a new account.

## Capture and prioritize feedback

Use [demo-feedback.csv](demo-feedback.csv), one row per distinct observation.
It currently contains headers only: no tester feedback has been collected.
Use tester aliases such as T01, not emails. Keep credentials, patient details
and identifiable screenshots out of the repository. Quote CSV fields containing
commas, quotes or line breaks using ordinary CSV escaping.

| Priority | Assign when | Next action |
| --- | --- | --- |
| P0 | Another account's data is visible or a destructive failure occurs | Pause demo use and investigate first |
| P1 | A tester cannot sign in or finish a core navigation task | Reproduce and fix before the next round |
| P2 | The task is possible but confusing or requires help | Group repeated observations and select the most common obstacle |
| P3 | A cosmetic preference has no task impact | Keep for later unless several testers report the same problem |

Keep initial reports in `new` status. Reproduce each actionable finding and record
the trigger, expected behavior and actual behavior before marking it `confirmed`.
Then assign an owner and move it through `in_progress`, `ready_for_retest` and
`verified`. Use `deferred` for deliberately postponed work, with a reason in
`next_action`. Record the revision or deployment URL used for retesting.

For each selected fix, change only what addresses the observation, run the
relevant checks, and repeat the original task. Merge and deployment remain
separate actions. No new feature or redesign has been selected without feedback.

## What happens next

1. Project owner selects the testers and privately provides demo account access.
2. Testers complete the guide; project owner records or shares their responses.
3. Populate the tracker, reproduce findings and select the first improvement.
4. Implement and verify the selected fix, then repeat the affected task with a tester.

Phase 4 is complete when the first feedback round is recorded, every finding has
a priority and disposition, and selected fixes have retest evidence. If no
actionable issues are found, record that result rather than inventing changes.
