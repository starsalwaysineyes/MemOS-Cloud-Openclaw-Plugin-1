#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const VERSION_FILES = ["package.json", "openclaw.plugin.json"];
const CHANGELOG_FILE = "CHANGELOG.md";

function printUsage() {
  console.log(`Usage:
  node scripts/bump-version.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-changelog]

Examples:
  node scripts/bump-version.mjs patch --dry-run
  node scripts/bump-version.mjs patch
  node scripts/bump-version.mjs minor
  node scripts/bump-version.mjs 0.2.0
  `);
}

function parseArgs(argv) {
  const args = {
    target: "",
    dryRun: false,
    noChangelog: false,
  };

  const positional = [];
  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--no-changelog") {
      args.noChangelog = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    printUsage();
    throw new Error("Exactly one target is required.");
  }

  args.target = positional[0];
  return args;
}

function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function isSemver(version) {
  return Boolean(parseSemver(version));
}

function bumpSemver(version, kind) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Current version is not plain semver (x.y.z): ${version}`);
  }

  if (kind === "patch") {
    parsed.patch += 1;
  } else if (kind === "minor") {
    parsed.minor += 1;
    parsed.patch = 0;
  } else if (kind === "major") {
    parsed.major += 1;
    parsed.minor = 0;
    parsed.patch = 0;
  } else {
    throw new Error(`Unknown bump kind: ${kind}`);
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeJson(relativePath, data) {
  const filePath = path.join(ROOT, relativePath);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(filePath, text, "utf8");
}

function defaultChangelog() {
  return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _TBD_
`;
}

function addReleaseSection(changelogText, version) {
  if (new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(changelogText)) {
    return changelogText;
  }

  const releaseSection = `## [${version}] - ${todayISO()}\n\n### Added\n- _TBD_\n`;

  if (!/^## \[Unreleased\]/m.test(changelogText)) {
    return `${changelogText.trimEnd()}\n\n## [Unreleased]\n\n### Added\n- _TBD_\n\n${releaseSection}`;
  }

  const unreleasedBlockRegex = /(## \[Unreleased\][\s\S]*?)(?=\n## \[|$)/m;
  if (!unreleasedBlockRegex.test(changelogText)) {
    return `${changelogText.trimEnd()}\n\n${releaseSection}`;
  }

  return changelogText.replace(
    unreleasedBlockRegex,
    (match) => `${match.trimEnd()}\n\n${releaseSection}`,
  );
}

async function updateChangelog(version, dryRun) {
  const filePath = path.join(ROOT, CHANGELOG_FILE);

  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    current = defaultChangelog();
  }

  const next = addReleaseSection(current, version);

  if (dryRun) {
    console.log(`[dry-run] ${CHANGELOG_FILE}: ensure release section for ${version}`);
    return;
  }

  if (next !== current) {
    await writeFile(filePath, next.trimEnd() + "\n", "utf8");
    console.log(`Updated ${CHANGELOG_FILE}`);
  } else {
    console.log(`${CHANGELOG_FILE} already contains ${version}`);
  }
}

async function main() {
  const { target, dryRun, noChangelog } = parseArgs(process.argv.slice(2));

  const manifests = {};
  for (const file of VERSION_FILES) {
    manifests[file] = await readJson(file);
    if (typeof manifests[file].version !== "string") {
      throw new Error(`${file} has no string \"version\" field.`);
    }
  }

  const currentVersions = VERSION_FILES.map((file) => manifests[file].version);
  const unique = [...new Set(currentVersions)];
  if (unique.length !== 1) {
    throw new Error(
      `Version mismatch across manifests: ${VERSION_FILES.map((f) => `${f}=${manifests[f].version`).join(", ")}`,
    );
  }

  const currentVersion = unique[0];
  let nextVersion = "";

  if (["patch", "minor", "major"].includes(target)) {
    nextVersion = bumpSemver(currentVersion, target);
  } else if (isSemver(target)) {
    nextVersion = target;
  } else {
    throw new Error(`Invalid target: ${target}. Expected patch|minor|major or x.y.z`);
  }

  if (nextVersion === currentVersion) {
    console.log(`Version unchanged: ${currentVersion}`);
    return;
  }

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version:    ${nextVersion}`);

  for (const file of VERSION_FILES) {
    manifests[file].version = nextVersion;
  }

  if (dryRun) {
    for (const file of VERSION_FILES) {
      console.log(`[dry-run] ${file}: ${currentVersion} -> ${nextVersion}`);
    }
  } else {
    for (const file of VERSION_FILES) {
      await writeJson(file, manifests[file]);
      console.log(`Updated ${file}`);
    }
  }

  if (!noChangelog) {
    await updateChangelog(nextVersion, dryRun);
  }

  if (dryRun) {
    console.log("Done (dry-run).");
  } else {
    console.log("Done.");
  }
}

main().catch((error) => {
  console.error(`[bump-version] ${error.message}`);
  process.exit(1);
});
