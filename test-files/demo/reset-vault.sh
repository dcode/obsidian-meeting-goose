#!/bin/bash

# Reset demo vault and install latest plugin
# Usage: ./reset-vault.sh [/path/to/vault]

VAULT_PATH="${1:-/Users/patty/Obsidian/Cadence}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../.."  # repository root

echo "🧹 Resetting demo vault at: $VAULT_PATH"
echo ""

# Check if vault exists
if [ ! -d "$VAULT_PATH" ]; then
  echo "❌ Vault not found at $VAULT_PATH"
  exit 1
fi

# ========================================
# Step 1: Build and install latest plugin
# ========================================
echo "📦 Building latest plugin..."
cd "$PLUGIN_DIR"

# Run build
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed!"
  exit 1
fi

echo "✅ Build successful"

# Create plugin directory if it doesn't exist
PLUGIN_INSTALL_DIR="$VAULT_PATH/.obsidian/plugins/meeting-goose"
mkdir -p "$PLUGIN_INSTALL_DIR"

# Copy plugin files
echo "📋 Installing plugin to vault..."
cp "$PLUGIN_DIR/main.js" "$PLUGIN_INSTALL_DIR/"
cp "$PLUGIN_DIR/manifest.json" "$PLUGIN_INSTALL_DIR/"
cp "$PLUGIN_DIR/styles.css" "$PLUGIN_INSTALL_DIR/"

echo "✅ Plugin installed to: $PLUGIN_INSTALL_DIR"
echo ""

# ========================================
# Step 2: Reset vault content
# ========================================
echo "🗑️  Removing generated content..."
rm -rf "$VAULT_PATH/Meetings"
rm -rf "$VAULT_PATH/People"
rm -rf "$VAULT_PATH/Issues"
rm -rf "$VAULT_PATH/Topics"

# Copy initial vault state
echo "📝 Copying initial vault state..."
cp -r "$SCRIPT_DIR/vault/"* "$VAULT_PATH/"

# Create empty People folder
mkdir -p "$VAULT_PATH/People"

echo ""
echo "✅ Demo vault reset complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Vault structure:"
echo "  $VAULT_PATH/"
echo "  ├── .obsidian/plugins/meeting-goose/  (latest build)"
echo "  ├── Platform Migration.md           (project stub)"
echo "  └── People/                         (empty)"
echo ""
echo "Demo transcripts:"
echo "  $SCRIPT_DIR/"
echo "  ├── 01-monday-standup.json"
echo "  ├── 02-architecture-review.json"
echo "  ├── 03-wednesday-standup.json"
echo "  └── 04-manager-1on1.json"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Open Obsidian and select the Cadence vault"
echo "  2. Reload Obsidian (Cmd+R) to pick up plugin changes"
echo "  3. Use 'Meeting Goose: Import transcript file(s)' to import transcripts"
echo ""
echo "Ready for demo recording! 🎬"
