# Contributing

1. Create a focused branch.
2. Keep all evidence adapters read-only.
3. Add synthetic fixtures only; never commit real session or request telemetry.
4. Run:

   ```bash
   npm ci
   npm run ci
   ```

5. Open a pull request or issue in the
   [public GitHub repository](https://github.com/ASSERIS-ASI/claude-usage-dashboard)
   describing user-visible changes and data assumptions.

Contributions must keep all source adapters read-only, local-first and covered
by synthetic fixtures and tests.

## Maintainer release flow

A verified push to `main` derives the next semantic version from conventional
commit subjects, creates the tag and opens a **draft** in Gitea. The workflow
never publishes that draft. A maintainer reviews, edits and publishes it in the
maintainer release UI; only that publication updates the scrubbed GitHub mirror,
creates the public GitHub release and publishes stable GHCR image tags. Draft
creation alone performs none of those public actions.

After the first successful container publication, an ASSERIS organization
owner must set the `claude-usage-dashboard` GHCR package visibility to
[**Public**](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
once. Later versions inherit the package setting.

Release text is generated from Git history. Do not add per-release Markdown
files to the repository.
