#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ─── Checks previos ───────────────────────────────────────────────────────────
if [[ ! -f "manifest.json" ]]; then
  echo -e "${RED}Error: ejecutá este script desde la raíz del proyecto.${NC}"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo -e "${RED}Error: hay cambios sin commitear. Commiteá antes de hacer release.${NC}"
  git status --short
  exit 1
fi

# ─── Versión actual ───────────────────────────────────────────────────────────
CURRENT=$(node -p "require('./manifest.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

echo -e "Versión actual: ${YELLOW}v$CURRENT${NC}"
echo ""
echo -e "  [1] patch  →  v$MAJOR.$MINOR.$((PATCH + 1))   (bug fix)"
echo -e "  [2] minor  →  v$MAJOR.$((MINOR + 1)).0         (feature nueva)"
echo -e "  [3] major  →  v$((MAJOR + 1)).0.0              (cambio grande)"
echo ""

# ─── Tipo de bump ─────────────────────────────────────────────────────────────
TYPE=${1:-""}

if [[ -z "$TYPE" ]]; then
  read -p "Tipo de bump [1/2/3]: " CHOICE
  case $CHOICE in
    1|patch) TYPE="patch" ;;
    2|minor) TYPE="minor" ;;
    3|major) TYPE="major" ;;
    *) echo -e "${RED}Opción inválida.${NC}"; exit 1 ;;
  esac
fi

case $TYPE in
  patch) NEW="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW="$((MAJOR + 1)).0.0" ;;
  *) echo -e "${RED}Uso: $0 [patch|minor|major]${NC}"; exit 1 ;;
esac

echo ""
echo -e "Bump: ${YELLOW}v$CURRENT${NC} → ${GREEN}v$NEW${NC}"
echo ""
read -p "¿Continuar? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[yY]$ ]] || { echo "Cancelado."; exit 0; }

# ─── Actualizar manifest.json ─────────────────────────────────────────────────
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  m.version = '$NEW';
  fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
"
echo "✓ manifest.json → v$NEW"

# ─── Commit + tag + push ──────────────────────────────────────────────────────
git add manifest.json
git commit -m "chore: bump version to v$NEW"
git tag "v$NEW"
git push && git push --tags
echo "✓ commit + tag v$NEW pusheados"

# ─── Crear zip ────────────────────────────────────────────────────────────────
ZIP="faceit-utilities-v$NEW.zip"
rm -f faceit-utilities-v*.zip
zip -r "$ZIP" manifest.json src/ popup/ icons/*.png --exclude "*.DS_Store" -q
echo "✓ $ZIP generado ($(du -sh "$ZIP" | cut -f1))"

echo ""
echo -e "${GREEN}✓ Release v$NEW lista.${NC}"
echo -e "Subí ${YELLOW}$ZIP${NC} en: https://chrome.google.com/webstore/devconsole"
