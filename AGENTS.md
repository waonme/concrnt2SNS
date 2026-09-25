# Public relay development

- This repository is public. Never commit credentials, real account bindings,
  server configuration, local paths, runtime logs, or outbox contents. Use fictional
  fixtures and scan staged files and new history for secrets before pushing.
- Keep the upstream history and license. Use `codex/` branches and small PRs;
  preserve protocol identifiers used by existing clients unless their migration is
  explicitly part of the task. Describe this fork's differences in README.md.
- GitHub Actions and Docker publishing are disabled. Run relevant local checks.
  The inherited `npm test` starts a configured client; do not use it as an isolated
  test suite or post to real accounts during tests.
- Public source changes do not automatically authorize deployment or real posts.
  Keep private deployment procedures and environment values outside this repository.
