/**
 * Prints the version string for a development (untagged) build:
 *
 *   <base>-dev.<commits since last release tag>+<short sha>
 *
 * e.g. 0.1.1-dev.4+abcd01f. This is valid SemVer: "-dev.4" is a pre-release
 * and "+abcd01f" is build metadata.
 *
 * <base> is the version the build is heading towards. If manifest.json is
 * already ahead of the last release tag, that is the manifest version. If it
 * still equals the last tag, the patch number is bumped, because SemVer sorts
 * 0.1.0-dev.4 *before* 0.1.0 and a build made after a release must not look
 * older than it.
 *
 * Usage: node scripts/dev-version.mjs [--write] [--sha <commit>]
 *   --write   also stamp the version into manifest.json (CI only; do not commit)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const RELEASE_TAG = /^\d+\.\d+\.\d+$/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function devVersion({ manifestVersion, lastTag, commitsSinceTag, sha }) {
  let base = manifestVersion;
  if (lastTag === manifestVersion) {
    const [major, minor, patch] = manifestVersion.split('.').map(Number);
    base = `${major}.${minor}.${patch + 1}`;
  }
  return `${base}-dev.${commitsSinceTag}+${sha.slice(0, 7)}`;
}

function lastReleaseTag() {
  const merged = git('tag', '--merged', 'HEAD', '--sort=-version:refname').split('\n');
  return merged.find((tag) => RELEASE_TAG.test(tag)) ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const shaIndex = args.indexOf('--sha');
  const sha = shaIndex >= 0 ? args[shaIndex + 1] : git('rev-parse', 'HEAD');

  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  if (!RELEASE_TAG.test(manifest.version)) {
    throw new Error(`manifest.json version "${manifest.version}" is not a plain x.y.z version`);
  }

  const lastTag = lastReleaseTag();
  const commitsSinceTag = Number(
    git('rev-list', '--count', lastTag ? `${lastTag}..HEAD` : 'HEAD')
  );
  const version = devVersion({ manifestVersion: manifest.version, lastTag, commitsSinceTag, sha });

  if (args.includes('--write')) {
    manifest.version = version;
    writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(version);
}
