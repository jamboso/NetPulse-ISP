# CI and deployment alert runbook

Use this runbook when a Slack or email alert reports a failed CI check or
deployment. Treat alerts on the `main` branch as urgent because they can block
releases or leave the live service behind the latest merged change.

## 1. Open and assess the failing run

1. Open the **View run** link in the Slack alert, or the **Run URL** in the
   email. Both links open the relevant GitHub Actions run.
2. If the link is unavailable, open the repository on GitHub, choose
   **Actions**, select the workflow named in the alert, and open the run that
   matches the branch, commit, and approximate alert time.
3. Open the failed job and step, then read the first actionable error in its
   log. Preserve the run URL, commit SHA, failed step name, and error summary
   in the incident thread.
4. Check whether the failure is isolated to this commit or affects other
   recent runs. Do not retry a failure repeatedly without understanding it.

## 2. Identify the failure category

| Alert or failed step | What it usually means | First response |
| --- | --- | --- |
| **Typecheck** | TypeScript types no longer agree after a change. | Ask the author or the engineer familiar with the changed area to correct the type error, then run the typecheck locally. |
| **Test** or **Test coverage** | A behavior changed, a regression was introduced, or the test environment is unhealthy. | Read the failed assertion and affected test; involve the change author and the owner of the affected feature. Fix the behavior or update the test only when the intended behavior changed. |
| **Build API server**, **Build ISP portal**, or **Build mockup sandbox** | A production build cannot compile, bundle, or resolve a required dependency/configuration value. | Involve the author of the change and the engineer who owns the affected app. Reproduce the named build command locally before merging a fix. |
| **Trigger Replit deployment** | CI passed, but GitHub could not ask Replit to deploy. This may be a deployment token, GitHub Actions, Replit API, or service availability issue. | Notify the deployment owner and the engineer who merged the change. Check the HTTP status and response in the job log; do not share secrets in Slack or tickets. |

For an unfamiliar failure, loop in the person who triggered the run, the
author of the last relevant change, and the feature or deployment owner. If
the issue affects customers, follow the team's normal incident-escalation
process as well.

## 3. Fix and verify

1. Create or update a branch with the smallest safe fix.
2. Run the failed check locally where practical:
   - Typecheck: `pnpm run typecheck`
   - Tests: `pnpm run test`
   - API build: `pnpm --filter @workspace/api-server run build`
   - Portal build: `pnpm --filter @workspace/isp-portal run build`
3. Open a pull request and make sure its CI run is green.
4. Merge the fix into `main`. The CI workflow runs automatically on `main`;
   a successful CI run automatically starts the deployment workflow.

## 4. Re-trigger after a fix

Normally, merging the fix is the re-trigger: CI runs on the new `main`
commit, and a successful CI run triggers deployment.

If GitHub Actions failed because of a temporary service or runner issue and no
code change is needed:

1. Open the failed GitHub Actions run.
2. Select **Re-run jobs** and choose **Re-run failed jobs** (or **Re-run all
   jobs** when appropriate).
3. Watch the new run to completion. If CI succeeds, confirm that the
   **Deploy to Replit** workflow starts and succeeds.

If CI succeeded but the deployment step failed:

1. Open the failed **Deploy to Replit** run.
2. Confirm the underlying deployment issue is resolved with the deployment
   owner.
3. Use **Re-run jobs** to re-run the failed deployment job, or merge a small
   verified follow-up commit to start CI and deployment again.
4. Confirm the production deployment status before closing the alert.

## 5. Close the alert

Reply in the alert thread or incident channel with the failing run URL, root
cause, fix commit or re-run URL, and confirmation that CI and deployment are
green. If the same category recurs, capture it as a follow-up reliability task.