---
name: lanes-release
description: Release Lanes from main through GitHub Actions, including version preparation, release PR validation and merge, publication, and the duplicate-tag workaround. Use when asked to publish or prepare a Lanes version.
---

# Release Lanes through GitHub Actions

Use the authenticated GitHub CLI for `FilipeJesus/lanes`. Read the repository's
`AGENTS.md` and current workflow definitions before acting; the workflows may
have changed since this procedure was recorded.

Carry out the release stages the user requested. An end-to-end release includes
preparation, review, normal approval and merge, publishing, and verification.
Do not ask again for actions already authorized by that request. Creating or
inspecting this skill does not authorize a release.

Never run `scripts/release.sh`, including `npm run release` or its aliases.
Use remote workflows and keep unrelated local changes out of the release.

## Establish the target and current state

Set `REPO=FilipeJesus/lanes`; derive `TARGET_VERSION` from the user's request.
Check remote `main`'s commit and package version, existing release PRs, tags,
releases, and recent CI/release runs. Use `--repo "$REPO"` on CLI commands and
repository-qualified API endpoints.

Read these files from GitHub at `main`, rather than assuming a local checkout
matches the remote:

- `.github/workflows/prepare-release.yml`
- `.github/workflows/auto-tag-release.yml`
- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `package.json` and, when reviewing preparation, `package-lock.json`

For example:

```bash
gh api "repos/$REPO/branches/main" --jq '.commit.sha'
gh api "repos/$REPO/contents/package.json?ref=main" --jq '.content | @base64d | fromjson | .version'
gh release list --repo "$REPO" --limit 6
gh pr list --repo "$REPO" --state open
gh run list --repo "$REPO" --branch main --limit 10
gh api "repos/$REPO/git/matching-refs/tags/v$TARGET_VERSION" --jq '.[].ref'
```

Match tag names exactly: the matching-refs API can also return longer names
sharing the prefix. A shallow checkout's `git rev-parse` is not proof that a
remote tag is absent.

The current preparation workflow accepts a single `patch`, `minor`, or `major`
bump. Confirm its result will equal the requested version before dispatching.
If `main` already has that version, reuse existing preparation and skip another
bump. Reuse an existing matching PR or in-progress run rather than duplicating it.
If the requested version cannot be produced by the workflow, resolve that
mismatch before changing anything.

An existing tag or GitHub release alone does not establish that all publishing
destinations succeeded. Inspect earlier run steps and logs before deciding
whether the target is complete or partially published.
If the target tag exists, the current Release workflow will fail when it tries
to create that tag again; do not dispatch it unchanged. For an existing tag or
any partial publication, follow [partial-release recovery](references/partial-release.md).

## Prepare and validate the release PR

For a required version bump:

```bash
gh workflow run prepare-release.yml --repo "$REPO" --ref main -f version_type="$VERSION_TYPE"
```

Identify the resulting run by workflow, dispatch time, and source commit; record
its ID and URL and wait for completion. Find the generated
`release/v$TARGET_VERSION` PR targeting `main`.

Review the actual diff. Normally only `package.json`, the root version fields
in `package-lock.json`, and `CHANGELOG.md` change. Confirm the exact target
version, appropriate changelog entries, and inclusion of the intended main
commit. Investigate unexpected changes before approval.

PRs opened using `GITHUB_TOKEN` may not start CI. If this bot-created PR has no
CI run, briefly close and reopen it using the authenticated user, with no
comment or branch deletion, to trigger `pull_request: reopened`. Do this only
for the release PR, and ensure it ends open. Do not repeat it if CI already
exists.

Wait for compilation, lint, and `npm test` to pass on the release PR. Approve
the reviewed PR using the authenticated account only when GitHub permits it.
Respect required reviews and checks; do not bypass branch protections. Record
the reviewed head SHA for a merge using `--match-head-commit`.

## Avoid duplicate tag creation

As observed during the 1.4.1 release, Auto Tag Release creates a tag when a
`release/` PR merges, while Release also creates that tag after publishing.
This caused the previous release to publish to both registries and then fail
with `Reference already exists (HTTP 422)` before creating a GitHub release.

Check whether both current workflows still create the same tag. If they do,
and no target tag already exists, use this temporary workaround:

1. Record Auto Tag Release's initial enabled state.
2. Immediately before merging the validated release PR, disable
   `auto-tag-release.yml` if it was active.
3. Keep it disabled through publication so Release creates the tag itself.
4. Restore the initial state on success, failure, or interruption. If the task
   stops early, restore it before handing control back.

```bash
gh api "repos/$REPO/actions/workflows/auto-tag-release.yml" --jq '.state'
gh workflow disable auto-tag-release.yml --repo "$REPO"
# Merge and publish, then restore only if this task disabled it:
gh workflow enable auto-tag-release.yml --repo "$REPO"
```

Do not disable the workflow if the collision has been fixed, and do not enable
a workflow that was already disabled before the task. This workaround changes
workflow activation temporarily; it does not fix the underlying definitions.

## Merge and publish

Merge with a repository-supported method and the reviewed head SHA, for example:

```bash
gh pr merge "$PR_NUMBER" --repo "$REPO" --squash --match-head-commit "$HEAD_SHA"
```

Confirm the PR merged, record its merge commit, and verify remote `main`
contains the requested version and intended changes. If main moved to unexpected
changes, resolve the release scope before dispatching.

```bash
gh workflow run release.yml --repo "$REPO" --ref main
```

Record the new run's ID, source SHA, and URL. Confirm it targets the intended
main commit; cancel an unintended run before it publishes and reassess.
Watch until completion, communicating meaningful progress. The Release workflow
runs its own compile, lint, tests, packaging, and publishing steps.

Do not automatically rerun a failed publishing workflow. First determine whether
either registry or the tag/release was already created. Retrying the whole run
after partial publication can fail on an existing version. Retry a transient
failure only when no publishing side effects occurred; otherwise report the
exact completed and failed stages and pursue only a clearly scoped recovery
authorized by the release request. Do not delete or move existing tags or bump
another version merely to get a green run. Stop if recovery needs credentials,
workflow changes, or authorization that is unavailable.

## Verify and report

Verify all of these before declaring a complete release:

- The tag points to the intended main commit.
- A published GitHub release exists with `lanes-$TARGET_VERSION.vsix`.
- VS Code Marketplace logs explicitly confirm publication of the target version.
- Open VSX logs explicitly confirm publication of the target version.
- Compile, lint, and tests passed; report the test count when available.
- Any temporarily paused workflow is restored to its original state.

Open VSX currently uses `continue-on-error: true`, so an overall green run
does not prove that registry published. Inspect its step and publication logs.

Provide the version, successful destinations, GitHub release link, and validation
result. If incomplete, link the run and state exactly what remains. Mention
temporary workflow restoration when that workaround was used.
