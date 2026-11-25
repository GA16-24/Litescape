# Agent instructions

Follow [CONTRIBUTING.md](CONTRIBUTING.md). It has the PR rules, local checks and project conventions.

Changes go issue → triage → PR → babysit → merge. [.agents/skills/issue-to-merge](.agents/skills/issue-to-merge/SKILL.md) says who does each step and how.

## PR descriptions

Write the description from `.github/pull_request_template.md`. A reviewer should see the change before reading the code, so a PR that touches the web viewer (`src/client/resources/web/`) or the desktop app (`desktop/`) shows Before | After screenshots, plus a recording when motion, timing or the camera changes. `node web-dev/serve.mjs` serves the viewer on :8194 from the game test's fixtures without Minecraft: take the same view on `main` and on your branch. If your change is somewhere the fixtures don't reach, extend the game test so it records that state, or say what you couldn't show. Attach the files with `gh pr create --attach` or `gh pr edit --attach`, since local file paths don't render on GitHub.
