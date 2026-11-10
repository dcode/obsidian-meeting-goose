import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Get version from package.json
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const newVersion = packageJson.version;

console.log(`Bumping version to ${newVersion}...`);

// Update manifest.json
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = newVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ Updated manifest.json to version ${newVersion}`);

// Update versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!versions[newVersion]) {
  versions[newVersion] = manifest.minAppVersion;
  writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
  console.log(`✓ Added version ${newVersion} to versions.json (minAppVersion: ${manifest.minAppVersion})`);
} else {
  console.log(`✓ Version ${newVersion} already exists in versions.json`);
}

console.log(`\nVersion bump complete!`);
console.log(`Next steps:`);
console.log(`1. Push the commit and tag: git push origin main --follow-tags`);
console.log(`   (the tag is ${newVersion}, with no "v" prefix, as Obsidian expects)`);
console.log(`2. The "Build plugin" workflow attaches main.js, manifest.json and styles.css to a draft release`);
console.log(`3. Review and publish the draft release on GitHub`);
