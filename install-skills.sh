#!/usr/bin/env bash
# Installs user-level Claude Code skills to ~/.claude/skills/
# Run once after cloning this repo.

SKILLS_SRC="$(dirname "$0")/user-skills"
SKILLS_DEST="$HOME/.claude/skills"

mkdir -p "$SKILLS_DEST"

echo "Installing promo-translation-html..."
cp -r "$SKILLS_SRC/promo-translation-html" "$SKILLS_DEST/"

echo "Installing promo-troubleshoot..."
cp -r "$SKILLS_SRC/promo-troubleshoot" "$SKILLS_DEST/"

echo "Installing update-tracker..."
cp -r "$SKILLS_SRC/update-tracker" "$SKILLS_DEST/"

echo ""
echo "Done! Skills installed to $SKILLS_DEST"
echo "Restart Claude Code to load the new skills."
