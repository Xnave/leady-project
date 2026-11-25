---
name: cherry-pick-main
description: >-
  Lands a commit on Zapidly main via PR (never direct push), waits for Diff
  against production, merges, and confirms Vercel production deploy. Use when
  the repo is leady-project and the user asks to cherry-pick to main, hotfix
  main, push a commit to main, or land a fix and deploy. Kept in personal
  skills so it stays available on feature branches that do not have the
  project copy yet.
---

# Cherry-pick to main + deploy

Direct pushes to `main` are rejected. Ruleset **Require production schema diff** requires the GitHub Actions check named exactly **Diff against production**.

## Do this

1. `git fetch origin main`
2. Confirm the commit is not already on `origin/main`.
3. Inspect the commit (`git show --stat`). Note whether it touches `prisma/schema.prisma` or `prisma/migrations/`.
4. Branch from main and cherry-pick:
   ```bash
   git checkout -B fix/<short-name> origin/main
   git cherry-pick <sha>
   git push -u origin HEAD
   ```
5. Open a PR into `main` (title/body from the commit; say cherry-pick of `<sha>`).
6. Wait for **Diff against production** → `completed` / `success`.
7. Squash-merge the PR.
8. `git fetch origin main` and confirm the merge commit. Production deploy is Vercel on `main` (`app.zapidly.com`).

Return the PR URL and the merge commit SHA when done.

## Schema gate

| Commit | Action |
|---|---|
| No Prisma schema/migrations | Proceed. Local check optional: on the cherry-pick branch, `npm run db:diff:check:production` should print `OK: no schema diff.` |
| Adds/changes migrations | Stop. Apply with `npm run db:verify:production` then `npm run db:migrate:production` (needs a TTY confirm). Only open/merge the PR after production matches `schema.prisma`. |

**Staging** (`Diff against staging`) is allowed to fail (red) via `continue-on-error` on the job. That does **not** block merge — only **Diff against production** can. `mergeStateStatus: UNSTABLE` with production green means staging failed and you can still merge (UI or `gh pr merge` / API).

`BLOCKED` with *Required status check "Diff against production" is expected* means that native job has not succeeded on the PR head SHA yet — wait or fix CI; do not push to `main`.

## Auth / tooling

- Prefer `/opt/homebrew/bin/gh` over nvm's npm `gh`.
- If `gh` is logged out, use the git credential helper token with the GitHub REST API (do not print the token).
- Create/merge PRs via `gh pr create` / `gh pr merge`, or REST `POST /pulls` and `PUT /pulls/{n}/merge` with `merge_method: squash`.

## Do not

- Push to `refs/heads/main`.
- Merge a campaigns/feature branch that still has pending production migrations.
- “Fix” a stuck Diff against production by POSTing a completed check-run from a personal token (rejected) or re-adding the old API-publish step. The required check must be the **workflow job name** `Diff against production` in `.github/workflows/schema-diff.yml`.
- Leave the user’s previous feature branch dirty; switch back when finished.

## After merge (deploy)

Vercel production tracks `main`. If the user wants deploy confirmation, check the Vercel deployment for `main` / alias `https://app.zapidly.com` (project `leady-project`). Do not redeploy unless they ask or the merge did not trigger a production deploy.
