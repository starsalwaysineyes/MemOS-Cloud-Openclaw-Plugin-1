# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _TBD_

## [0.2.0] - 2026-02-25

### Added
- `CHANGELOG.md` baseline and release tracking.
- `scripts/bump-version.mjs` to bump `package.json` and `openclaw.plugin.json` versions together.
- NPM helper scripts in `package.json` for patch/minor/major bump.

### Changed
- Simplified `README.md` and `README_ZH.md` by removing capability matrix and versioning guide sections.
- Kept only GitHub-source upgrade commands for end users (latest and pinned tag examples).

## [0.1.0] - 2026-02-24

### Added
- Initial lifecycle plugin release.
- Memory recall on `before_agent_start` via `/search/memory` and `prependContext` injection.
- Memory writeback on `agent_end` via `/add/message`.
- Config schema for recall/add behavior, conversation id strategy, and reliability knobs (`timeoutMs`, `retries`, `throttleMs`).
- Env-file priority loading (`~/.openclaw/.env` → `~/.moltbot/.env` → `~/.clawdbot/.env`).
