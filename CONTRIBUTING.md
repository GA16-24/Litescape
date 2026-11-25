# Contributing

Litematica Web Viewer is a small project with one maintainer. Reviewing a PR takes more time than writing one, so this guide exists to make your PR quick to review and likely to merge.

The short version: fix one real bug, show that the fix works, and use the PR template.

## Before you open a PR

- **Search first.** Check open issues and PRs. If one already covers your problem, test it and comment with what you saw. That helps more than a second PR.
- **Bugs go in issues.** Include the Minecraft, Fabric Loader, Litematica and mod versions, what you did, what you expected and what happened. Logs help.
- **Features start as an issue.** Describe the problem you want solved before writing code. A feature PR without an issue the maintainer agreed to will be closed.
- **Security problems are private.** Follow [SECURITY.md](SECURITY.md). Do not open a public issue or PR.

## What gets merged

Welcome:

- Fixes for crashes, regressions, wrong rendering, wrong build progress and performance problems.
- Fixes for shader packs that the README lists as tested, or that fail in a way the Shaders tab doesn't report.
- Small doc fixes.
- Features the maintainer agreed to in an issue.

Closed without review:

- Features, redesigns and new settings with no agreed issue.
- Refactors, renames and formatting changes that don't fix anything.
- Support for other mod loaders or Minecraft versions.
- Changes that let the web server listen beyond `127.0.0.1`, or that loosen the `Host`/`Origin` checks or the server's access rules.

## Rules for a PR

### One problem per PR

Fix one problem. Include every change the fix needs: the mod, the web app, the game test and the README if behavior changes. Cleanup and a second fix go in their own PRs.

### Show that it works

Say how you found the bug, how you checked the fix, and what you saw. "Tests pass" is not evidence.

- Web viewer changes need before and after screenshots. Add a short video when the change is about motion, timing or the camera.
- Multiplayer changes need a test on a dedicated server with at least two clients, or a note saying you couldn't run one.
- Shader changes name the packs you tried.

Upload screenshots and videos to the PR. Do not commit them.

### Keep it passing and mergeable

CI must be green. Run the same checks locally before you push (see [Local checks](#local-checks)). Rebase on `main` when your PR conflicts. A PR that stays red or conflicting for 14 days with no reply gets closed.

### Title and commits

Use a [Conventional Commits](https://www.conventionalcommits.org/) title in plain language. PRs are squash-merged, so the title becomes the commit message.

```text
fix(web): ghost blocks no longer flicker when slicing layers
fix(server): shared schematics keep their access list after a restart
docs: explain the region-read setting
```

Common types are `fix`, `feat`, `perf`, `docs`, `test`, `ci` and `chore`. Scopes are `client`, `server`, `web`, `shaders` and `gametest`.

### AI-assisted PRs

AI tools are fine. You are still the author: read every line, run the checks and answer review questions yourself. Name the model and harness at the end of the PR description. PRs that look like unreviewed agent output (made-up evidence, unrelated edits, no replies to review) get closed.

## Local checks

You need JDK 25 and Node 24. CI runs these on every PR:

```sh
# Build with all javac lints as errors, like CI
./gradlew build compileGametestJava --init-script .github/ci.init.gradle --warning-mode=fail

# Boot the real Minecraft client and run the end-to-end test
./gradlew runClientGameTest --init-script .github/ci.init.gradle --warning-mode=fail

# Web app: lint, format, import order (warnings fail), then unit tests
npx @biomejs/biome@2.6.6 ci --error-on-warnings .
node --test 'web-dev/*.test.mjs'
```

`npx @biomejs/biome@2.6.6 check --write .` fixes most Biome findings for you.

For the web dev server, shader dev server and fixtures, see the Development section of the [README](README.md#development). You can work on the web viewer without starting Minecraft.

## Project conventions

- The mod is one jar for client and server. Code in `src/main` runs on both sides, so it can't touch client classes. Client-only code goes in `src/client`.
- The web app is plain ES modules with no build step. Don't add a bundler, framework or npm dependency. `vendor/` holds third-party code and is excluded from Biome. Don't edit it.
- New Gradle dependencies need a reason in the PR. Dependency review fails on any known vulnerability.
- Server reads must only touch chunks that are already loaded. Never load or generate terrain on behalf of a request.

## License

By contributing, you agree that your work is released under the [MIT License](LICENSE).
