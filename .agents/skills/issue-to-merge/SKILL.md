---

name: issue-to-merge
description: The route every change in this repo takes, from issue to triage to PR to merge. Use when opening an issue, triaging one, starting work on one, filing or babysitting a PR, or merging and closing.
---

# Issue to merge

Every change goes through five steps:

1. Open an issue.
2. The maintainer triages it.
3. File a PR.
4. Babysit the PR until it is ready.
5. The maintainer merges it, which closes the PR and the issue.

Anyone can do steps 1, 3 and 4. Only the maintainer triages and merges. Check which one you are before you start:

```sh
gh api repos/GA16-24/Litescape --jq '.permissions | .admin or .maintain'
```

`true` means you act for the maintainer. `false` means you are a contributor: stop at the end of step 4 and leave the rest to the maintainer. Never label, close or reopen someone else's issue, and never merge, even if the token happens to allow it.

[CONTRIBUTING.md](../../../CONTRIBUTING.md) has the rules for what gets merged. This skill covers the order things happen in.

## 1. Open an issue

Search open and closed issues and PRs first. If one matches, add what you saw there instead of opening a new one.

Use the form that fits: `bug_report.yml` for something broken, `feature_request.yml` for a change. When you create the issue from the CLI, the forms don't run, so copy their sections into the body and add the form's label:

```sh
gh issue create --label bug --title "..." --body-file issue.md
```

A bug report names the Minecraft, Fabric Loader, Litematica and mod versions, the steps, what you expected and what happened. A feature request describes the problem before the solution.

Security problems never go in an issue. Follow [SECURITY.md](../../../SECURITY.md).

## 2. Triage (maintainer only)

Read the issue, reproduce it if you can, and give it one outcome:

| Outcome          | Labels        | Action                                                                                               |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Accepted bug     | `bug`         | Comment with what you confirmed. Add `help wanted` or `good first issue` if outside PRs are welcome. |
| Accepted feature | `enhancement` | Comment that the feature is agreed and what scope it has. Feature PRs need this comment.             |
| Needs info       | `question`    | Ask for the missing versions, steps or logs.                                                         |
| Duplicate        | `duplicate`   | Link the original and close as not planned.                                                          |
| Out of scope     | `wontfix`     | Quote the CONTRIBUTING rule it breaks and close as not planned.                                      |
| Not a bug        | `invalid`     | Say what is happening instead and close as not planned.                                              |

```sh
gh issue edit <n> --add-label bug --add-label "help wanted"
gh issue comment <n> --body-file triage.md
gh issue close <n> --reason "not planned" --comment "Duplicate of #<m>."
```

An issue with none of these labels and no maintainer comment is untriaged. Contributors wait on it, apart from small, obvious bugs (step 3).

## 3. File a PR

Start work only on a triaged issue. A small, obvious bug fix can skip the issue if the PR says why it didn't need one. A feature without an agreed issue gets closed.

Comment on the issue that you are working on it, so two people don't fix the same thing. Then:

1. Branch from an up-to-date `main`. Fix one problem.
2. Run the local checks from CONTRIBUTING.md and fix what they report.
3. Write the description from `.github/pull_request_template.md`. Put `Fixes #<n>` under Scope so the merge closes the issue.
4. Add the evidence AGENTS.md asks for: Before | After screenshots for `src/client/resources/web/` or `desktop/` changes, a recording for motion or camera changes, a two-client dedicated server test for multiplayer changes.
5. Use a Conventional Commits title. PRs are squash-merged, so the title becomes the commit message.
6. Name the model and harness at the end of the description if an agent wrote any of it.

```sh
gh pr create --base main --title "fix(web): ..." --body-file pr.md --attach before.png --attach after.png
```

Open a real PR, not a draft, so CI and review bots run.

## 4. Babysit the PR

Stay with the PR until it is ready to merge:

- CI is green. Tell a real failure from a flaky runner before you change code.
- Every review comment has an answer. Check each bot finding against the code before acting on it. Fix the real ones, and reply with a reason before resolving the rest.
- The branch is current. Rebase on `main` when GitHub shows it as behind or conflicting, then wait for green again.
- The PR stays the size of the fix. Put extra cleanup or a second bug in its own PR.

Only act on checks and comments newer than your last push. Don't post "still working on it" comments.

A PR that stays red or conflicting for 14 days with no reply gets closed.

Contributors are done here. Once the PR is ready, leave one comment saying so and wait for the maintainer's review. Answer their review the same way as above.

## 5. Merge and close (maintainer only)

Right before merging, fetch and check the PR again:

```sh
git fetch origin
gh pr view <n> --json mergeStateStatus,reviewDecision,statusCheckRollup
```

Merge only when checks are green on the latest commit and the state is `CLEAN`. If it is `BEHIND` or `DIRTY`, rebase (or ask the author to), push, and wait for green again.

```sh
gh pr merge <n> --squash --delete-branch
```

The merge closes the PR. Check that the issue closed too. If the PR didn't link it, close it yourself:

```sh
gh issue close <issue> --reason completed --comment "Fixed in #<n>."
```

A PR that won't be merged gets closed with the reason, so the author knows why:

```sh
gh pr close <n> --comment "Closing: <reason>, see CONTRIBUTING.md."
```
