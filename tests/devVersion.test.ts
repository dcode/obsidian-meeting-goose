/**
 * Tests for the development-build version string (scripts/dev-version.mjs)
 */

import { execFileSync } from 'child_process';
import path from 'path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'dev-version.mjs');

// The script is an ES module, so call its exported function in a real node process.
function devVersion(input: Record<string, unknown>): string {
  const code = `import(${JSON.stringify('file://' + SCRIPT)}).then(m => console.log(m.devVersion(${JSON.stringify(input)})))`;
  return execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();
}

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

describe('devVersion', () => {
  const sha = 'abcd01f2345678901234567890123456789abcde';

  it('uses the manifest version before the first release', () => {
    expect(devVersion({ manifestVersion: '0.1.0', lastTag: null, commitsSinceTag: 12, sha }))
      .toBe('0.1.0-dev.12+abcd01f');
  });

  it('bumps the patch once that version has been released', () => {
    expect(devVersion({ manifestVersion: '0.1.0', lastTag: '0.1.0', commitsSinceTag: 3, sha }))
      .toBe('0.1.1-dev.3+abcd01f');
  });

  it('keeps a manifest version that is already ahead of the last release', () => {
    expect(devVersion({ manifestVersion: '0.2.0', lastTag: '0.1.0', commitsSinceTag: 7, sha }))
      .toBe('0.2.0-dev.7+abcd01f');
  });

  it('produces valid SemVer, including for an all-digit short sha', () => {
    for (const version of [
      devVersion({ manifestVersion: '0.1.0', lastTag: null, commitsSinceTag: 0, sha }),
      devVersion({ manifestVersion: '1.9.9', lastTag: '1.9.9', commitsSinceTag: 40, sha: '0123456789' }),
    ]) {
      expect(version).toMatch(SEMVER);
    }
  });
});
