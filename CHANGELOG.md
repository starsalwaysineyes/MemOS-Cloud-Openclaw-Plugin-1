# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Capability matrix and versioning/upgrade guidance in `README.md` and `README_ZH.md`.
- `scripts/bump-version.mjs` to bump versions in both manifest files in one step.
- NPM scripts for patch/minor/major bump workflows.
- This `CHANGELOG.md` baseline file.

## [0.1.0] - 2026-02-24

### Added
- Initial lifecycle plugin release.
- Memory recall on `before_agent_start` via `/search/memory` and `prependContext` injection.
- Memory writeback on `agent_end` via `/add/message`.
- Config schema for recall/add behavior, conversation id strategy, and reliability knobs (`timeoutMs`, `retries`, `throttleMs`).
- Env-file priority loading (`~/.openclaw/.env` → `~/.moltbot/.env` → `~/.clawdbot/.env`).
