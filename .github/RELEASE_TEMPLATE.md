# Release Notes Template

Use this template when creating a new GitHub release.

## Title Format
```
X.Y.Z - Brief description
```

Example: `1.1.4 - Bug fixes and performance improvements`

## Release Notes Template

```markdown
## 🎉 What's New in X.Y.Z

### Major Features (if MINOR/MAJOR release)
✨ **Feature Name**
- Description of feature
- Benefits for users

### Improvements (if PATCH/MINOR release)
📚 **Documentation Updates**
- What was updated

🔧 **Bug Fixes**
- Fixed issue with X
- Resolved Y problem

⚡ **Performance**
- Improved performance in Z

### Technical Details
- Internal improvements
- Dependency updates
- Code quality improvements

---

## 📦 Installation

**For Obsidian Community Plugins:**
1. Open Obsidian Settings → Community Plugins
2. Search for "Obsidian Meeting Goose"
3. Click Install, then Enable

**For Manual Installation:**
1. Download `main.js`, `manifest.json`, and `styles.css` from this release
2. Create a folder: `YourVault/.obsidian/plugins/meeting-goose/`
3. Copy the files into that folder
4. Reload Obsidian and enable the plugin

---

## 🆙 Upgrading from Previous Versions

If you're upgrading from vX.Y.Z:
- Any migration steps needed
- Breaking changes (if any)
- Recommended actions

---

## 📖 Full Documentation

- [README](https://github.com/dcode/obsidian-meeting-goose#readme)

---

**Full Changelog**: https://github.com/dcode/obsidian-meeting-goose/compare/PREVIOUS_VERSION...CURRENT_VERSION
```

## Quick Reference

### Semantic Versioning Guidelines

- **PATCH** (1.1.3 → 1.1.4): Bug fixes, small improvements, linting fixes
- **MINOR** (1.1.3 → 1.2.0): New features, backward compatible changes
- **MAJOR** (1.1.3 → 2.0.0): Breaking changes, major refactoring

### Release Checklist

- [ ] Update version in `manifest.json`
- [ ] Update version in `package.json`
- [ ] Add entry to `versions.json`
- [ ] Run `npm run build` to create `main.js`
- [ ] Run `npm run lint:bot` to check for critical errors
- [ ] Write release notes using template above
- [ ] Create tag without `v` prefix: `1.1.4` (not `v1.1.4`)
- [ ] Create GitHub release with tag
- [ ] Attach `main.js`, `manifest.json`, and `styles.css` to release

### Tag Naming Convention

✅ **Correct**: `1.1.4`, `1.2.0`, `2.0.0`  
❌ **Incorrect**: `v1.1.4`, `v1.2.0`, `v2.0.0`

Obsidian plugin directory expects tags without `v` prefix.

### Release Title Examples

✅ Good:
- `1.1.4 - Bug fixes and ESLint improvements`
- `1.2.0 - New auto-archive feature`
- `2.0.0 - Major refactor with breaking changes`

❌ Avoid:
- `1.1.4` (too generic)
- `v1.1.4` (includes v prefix)
- `Release 1.1.4` (unnecessary word)

