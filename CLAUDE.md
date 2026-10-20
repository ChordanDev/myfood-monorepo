# MyFood monorepo

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`ChordanDev/myfood-monorepo`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `docs/GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## Git workflow

- `main` is the integration branch.
- Each feature gets its own branch, created from `main`. Each issue of that feature gets its own branch with a pull request into the feature branch. Only when the feature is complete is the feature branch merged into `main` through a pull request.
- An issue that is not part of a larger feature uses a short branch with a pull request straight to `main`.
- CI runs on every non-draft pull request, whatever its base, and on pushes to `main`.
