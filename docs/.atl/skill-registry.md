# Skill Registry

Generated for `meal-app-docs` on 2026-06-09.

This registry is an index for SDD agents. Agents MUST read the referenced `SKILL.md` file before applying a skill.

## Project conventions

- `meal-app-docs/CONTEXT.md` — canonical product language and relationships.
- `meal-app-docs/README.md` — shared docs are the source of truth for frontend and backend sessions.
- `my_food_back/AGENTS.md` — Phoenix, Elixir, Ecto, LiveView, and testing conventions for backend implementation.
- `my-expo-app/GEMINI.md` — present but empty.

## Skills

| Name | Scope | Trigger / Description | Path |
| --- | --- | --- | --- |
| branch-pr | user | Create Gentle AI pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. | `/Users/luccagiordana/.config/opencode/skills/branch-pr/SKILL.md` |
| building-native-ui | user | Complete guide for building beautiful apps with Expo Router. Covers fundamentals, styling, components, navigation, animations, patterns, and native tabs. | `/Users/luccagiordana/.agents/skills/building-native-ui/SKILL.md` |
| caveman | user | Ultra-compressed communication mode. Cuts token usage by dropping filler while keeping technical accuracy. | `/Users/luccagiordana/.agents/skills/caveman/SKILL.md` |
| chained-pr | user | Trigger: PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. | `/Users/luccagiordana/.config/opencode/skills/chained-pr/SKILL.md` |
| cognitive-doc-design | user | Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | `/Users/luccagiordana/.config/opencode/skills/cognitive-doc-design/SKILL.md` |
| comment-writer | user | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments. | `/Users/luccagiordana/.config/opencode/skills/comment-writer/SKILL.md` |
| creating-reanimated-animations | user | Generate React Native Reanimated animation code and guidance. | `/Users/luccagiordana/.agents/skills/creating-reanimated-animations/SKILL.md` |
| diagnose | user | Disciplined diagnosis loop for hard bugs and performance regressions. | `/Users/luccagiordana/.agents/skills/diagnose/SKILL.md` |
| eas-update-insights | user | Check the health of published EAS Updates. | `/Users/luccagiordana/.agents/skills/eas-update-insights/SKILL.md` |
| elixir | user | Expert in Elixir and Phoenix development with functional programming patterns. | `/Users/luccagiordana/.agents/skills/elixir/SKILL.md` |
| elixir-ecto-patterns | user | Use when Elixir Ecto patterns including schemas, changesets, queries, and transactions. | `/Users/luccagiordana/.agents/skills/elixir-ecto-patterns/SKILL.md` |
| Expo UI Jetpack Compose | user | Use `@expo/ui/jetpack-compose` views and modifiers. | `/Users/luccagiordana/.agents/skills/expo-ui-jetpack-compose/SKILL.md` |
| Expo UI SwiftUI | user | Use `@expo/ui/swift-ui` views and modifiers. | `/Users/luccagiordana/.agents/skills/expo-ui-swiftui/SKILL.md` |
| expo-api-routes | user | Guidelines for Expo Router API routes with EAS Hosting. | `/Users/luccagiordana/.agents/skills/expo-api-routes/SKILL.md` |
| expo-cicd-workflows | user | Understand and write EAS workflow YAML files for Expo projects. | `/Users/luccagiordana/.agents/skills/expo-cicd-workflows/SKILL.md` |
| expo-deployment | user | Deploying Expo apps to app stores, web hosting, and API routes. | `/Users/luccagiordana/.agents/skills/expo-deployment/SKILL.md` |
| expo-dev-client | user | Build and distribute Expo development clients. | `/Users/luccagiordana/.agents/skills/expo-dev-client/SKILL.md` |
| expo-module | user | Create and write Expo native modules and views. | `/Users/luccagiordana/.agents/skills/expo-module/SKILL.md` |
| expo-tailwind-setup | user | Set up Tailwind CSS in Expo with react-native-css and NativeWind. | `/Users/luccagiordana/.agents/skills/expo-tailwind-setup/SKILL.md` |
| find-skills | user | Discover and install agent skills. | `/Users/luccagiordana/.agents/skills/find-skills/SKILL.md` |
| go-testing | user | Trigger: Go tests, coverage, Bubbletea teatest, golden files. | `/Users/luccagiordana/.config/opencode/skills/go-testing/SKILL.md` |
| grill-me | user | Stress-test a plan or design through questioning. | `/Users/luccagiordana/.agents/skills/grill-me/SKILL.md` |
| grill-with-docs | user | Stress-test a plan against project language and docs. | `/Users/luccagiordana/.agents/skills/grill-with-docs/SKILL.md` |
| handoff | user | Compact the current conversation into a handoff document. | `/Users/luccagiordana/.agents/skills/handoff/SKILL.md` |
| improve-codebase-architecture | user | Find refactoring and architecture improvement opportunities. | `/Users/luccagiordana/.agents/skills/improve-codebase-architecture/SKILL.md` |
| issue-creation | user | Create Gentle AI issues with issue-first checks. | `/Users/luccagiordana/.config/opencode/skills/issue-creation/SKILL.md` |
| judgment-day | user | Blind dual review and adversarial review. | `/Users/luccagiordana/.config/opencode/skills/judgment-day/SKILL.md` |
| native-data-fetching | user | Implement or debug network requests, APIs, and data fetching. | `/Users/luccagiordana/.agents/skills/native-data-fetching/SKILL.md` |
| phoenix | user | Phoenix framework development guidelines. | `/Users/luccagiordana/.agents/skills/phoenix/SKILL.md` |
| prototype | user | Build a throwaway prototype to flesh out a design. | `/Users/luccagiordana/.agents/skills/prototype/SKILL.md` |
| reanimated-skia-performance | user | High-performance React Native animations and Skia graphics. | `/Users/luccagiordana/.agents/skills/reanimated-skia-performance/SKILL.md` |
| setup-matt-pocock-skills | user | Set up agent skills context in project docs. | `/Users/luccagiordana/.agents/skills/setup-matt-pocock-skills/SKILL.md` |
| skill-creator | user | Create LLM-first skills with valid frontmatter. | `/Users/luccagiordana/.config/opencode/skills/skill-creator/SKILL.md` |
| skill-improver | user | Audit and upgrade existing LLM-first skills. | `/Users/luccagiordana/.config/opencode/skills/skill-improver/SKILL.md` |
| tdd | user | Test-driven development with red-green-refactor loop. | `/Users/luccagiordana/.agents/skills/tdd/SKILL.md` |
| to-issues | user | Break a plan/spec/PRD into independently-grabbable issues. | `/Users/luccagiordana/.agents/skills/to-issues/SKILL.md` |
| to-prd | user | Turn conversation context into a PRD and publish it. | `/Users/luccagiordana/.agents/skills/to-prd/SKILL.md` |
| triage | user | Triage issues through a state machine. | `/Users/luccagiordana/.agents/skills/triage/SKILL.md` |
| upgrading-expo | user | Upgrade Expo SDK versions and fix dependency issues. | `/Users/luccagiordana/.agents/skills/upgrading-expo/SKILL.md` |
| work-unit-commits | user | Plan commits as reviewable work units. | `/Users/luccagiordana/.config/opencode/skills/work-unit-commits/SKILL.md` |
| write-a-skill | user | Create new agent skills with proper structure. | `/Users/luccagiordana/.agents/skills/write-a-skill/SKILL.md` |
| zoom-out | user | Provide broader context and architectural perspective. | `/Users/luccagiordana/.agents/skills/zoom-out/SKILL.md` |

## Excluded skills

- SDD phase skills (`sdd-*`) are intentionally excluded from this runtime registry.
- `_shared` and `skill-registry` are intentionally excluded.
