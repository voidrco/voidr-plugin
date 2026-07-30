---
name: voidr-deploy-run
description: Deploys a locally validated Voidr Playwright suite from an already-merged pull request as an immutable release, verifies latest, and creates a platform execution through separate confirmation gates. Use only after selected tests and the Voidr build pass.
---

# Deploy and run Voidr tests

Never call a tool that starts a Hive process. Platform execution is created
only with `executions_create_execution`.

Never ask the user for the Test Plan ID, the repository URL, or the pull
request number. When a test repository is selected or attached, call
`voidr_release_inspect` with its path (and `workspaceRoot`): it reads
`project.json`, the Git origin, the default branch, HEAD/worktree state, and
locates the merged PR for the current HEAD. Show the returned summary for
confirmation and use exactly those values. When it reports `ready: false`,
follow its `next` guidance instead of guessing.

## Preconditions

Require:

- an explicitly selected Test Plan and test repository;
- a matching `project.json`;
- no unimplemented selected cases;
- a successful `voidr_smoke_build` result
  with `buildCompleted: true` and zero failed or skipped selected tests;
- a GitHub repository with a pull request for the selected test changes;
- Service Account scope `write`.

## Source merge gate

Show:

- the selected repository and its GitHub remote;
- the pull request number and URL;
- the repository default branch;
- the pull request state, base branch, and merge commit;
- whether the local repository is clean and `HEAD` is exactly that merge
  commit;
- whether that commit is present on `origin/<default-branch>`.

Determine cleanliness from
`git status --porcelain=v1 --untracked-files=all`. The repository is clean
only when this command returns no output. Untracked files are local changes:
never describe a repository with untracked files as clean, synchronized, or
ready to deploy.

Require all of the following:

- the PR state is `MERGED`;
- the PR base is the GitHub default branch;
- the merge commit is reachable from `origin/<default-branch>`;
- the selected repository is clean;
- local `HEAD` equals the PR merge commit.

When the local checkout is merely behind the merged PR commit (clean worktree,
merge commit already on origin), call `voidr_release_deploy_merged_pr`
directly: it fetches with the user credentials and fast-forwards the default
branch to the exact merge commit. Never run `git pull`, `git fetch`, or
`git checkout` in the sandboxed terminal — it has no credentials.

If the PR is open, closed without merge, targets another branch, or the local
checkout diverged, stop before any platform upload or promotion. Ask the user
to merge/update the PR or explicitly select the correct merged PR. Never
create, merge, or change a PR without separate explicit authorization.

If there is no pull request yet, show the exact tracked and untracked paths,
mark the source merge gate as blocked, and stop. Do not reuse an older merged
PR whose merge commit does not contain the selected test changes.

## Immutable deploy gate

Show:

- organization, application, Test Plan, and environment;
- selected case slugs;
- local validation result;
- PR URL, default branch, and full merge commit SHA;
- that the release will first be uploaded under a content-addressed
  `codebaseVersion`, then promoted to `latest`.

Ask:

> Posso publicar a release imutável deste commit e promovê-la para latest na Voidr?

Only after an affirmative answer, call `voidr_release_deploy_merged_pr` with
the selected repository path, exact server-returned linked repository URL, PR
number, and Test Plan ID.

The tool rechecks the merged PR, clean worktree, exact `HEAD`, and
`origin/<default-branch>` before building. It then:

1. rebuilds from the exact merged commit;
2. uploads with `voidr deploy-candidate` into
   `versions/<codebaseVersion>`;
3. promotes that exact immutable version;
4. reads the latest deploy back from the platform;
5. returns `completed: true` only when `latest.codebaseVersion` equals the
   promoted `codebaseVersion`.

Never run `npm run voidr:deploy` or `voidr deploy-latest`. Those legacy paths
write mutable `latest` directly and bypass the merged-PR proof. If the
installed framework lacks `deploy-candidate`, or the Service lacks the
version promotion/read-back endpoints, stop closed and report the missing
capability. Do not fall back to the legacy command.

An immutable candidate upload that fails before promotion is not a completed
deploy. A successful promotion without latest read-back is also not a
completed deploy.

## Independent sync verification

Only after immutable release and latest verification:

1. Call `test_plans_get_test_plan`.
2. Call `test_plans_get_test_counts`.
3. Verify every selected case is marked automated and is available for
   platform execution.
4. If verification fails or is ambiguous, stop. Report that artifacts may
   exist but synchronization is unverified.

Never create an execution while sync is unverified. If
`executions_create_execution` reports "Only automated test cases can be
executed", the selected cases exist but were never deployed: complete the
immutable deploy of the merged PR and re-verify sync. Never respond to that
error by creating or re-creating modules, suites, or cases — the bridge
blocks it.

## Execution gate

Show the exact environment, provider/source, selected cases, and idempotency
key. Ask:

> Posso iniciar esta execução na plataforma?

Only after confirmation, call `executions_create_execution` once with a
stable idempotency key. Save the returned execution ID.

Use `executions_get_execution` to observe status. Do not cancel, retry,
repair, or dispatch self-healing unless a future skill explicitly defines a
separate user-approved workflow.

Report:

- PR URL, default branch, and merged commit;
- immutable `codebaseVersion`;
- confirmation that `latest` points to that same version;
- deployment and automation-sync verification;
- execution ID and status;
- link to the platform when available;
- failures without attempting automatic repair.
