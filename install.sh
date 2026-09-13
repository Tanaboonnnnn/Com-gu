#!/bin/sh
set -eu

REPO="Tanaboonnnnn/Com-gu"
ROOT="${COMGU_INSTALL_ROOT:-$HOME/.local/share/comgu-cli}"
BIN_DIR="${COMGU_BIN_DIR:-$HOME/.local/bin}"
VERSION_INPUT="${COMGU_VERSION:-}"
TEST_BASE="${COMGU_INSTALLER_TEST_BASE_URL:-}"

fail() { printf 'ComGu installer: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }

need curl
need node
need tar
need sha256sum

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22 or newer is required"

case "$(uname -s)" in
  Linux) ;;
  *) fail "only Linux is supported by install.sh" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

if [ -n "$VERSION_INPUT" ]; then
  TAG="${VERSION_INPUT#v}"
  case "$TAG" in *[!0-9.]*|'') fail "COMGU_VERSION must be an exact version such as 3.2.0" ;; esac
  TAG="v$TAG"
else
  [ -z "$TEST_BASE" ] || fail "COMGU_VERSION is required with the test release source"
  EFFECTIVE="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
  TAG="${EFFECTIVE##*/}"
fi

VERSION="${TAG#v}"
case "$VERSION" in
  *[!0-9.]*|'') fail "could not resolve a valid ComGu release version" ;;
esac

ASSET="ComGu-CLI-linux-$ARCH.tar.gz"
if [ -n "$TEST_BASE" ]; then
  BASE="${TEST_BASE%/}/$TAG"
else
  BASE="https://github.com/$REPO/releases/download/$TAG"
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

printf 'Installing ComGu CLI %s for linux-%s...\n' "$VERSION" "$ARCH"
curl -fL --retry 3 --retry-delay 1 "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"
curl -fL --retry 3 --retry-delay 1 "$BASE/$ASSET" -o "$TMP/$ASSET"

EXPECTED="$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print tolower($1) }' "$TMP/SHA256SUMS.txt")"
[ "${#EXPECTED}" -eq 64 ] || fail "SHA256SUMS.txt has no valid entry for $ASSET"
ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{ print tolower($1) }')"
[ "$ACTUAL" = "$EXPECTED" ] || fail "SHA-256 mismatch for $ASSET"

mkdir -p "$ROOT/versions" "$BIN_DIR"
FINAL="$ROOT/versions/$VERSION"
if [ ! -x "$FINAL/ComGu-CLI/comgu" ]; then
  STAGE="$TMP/payload"
  mkdir -p "$STAGE"
  tar -xzf "$TMP/$ASSET" -C "$STAGE"
  [ -x "$STAGE/ComGu-CLI/comgu" ] || fail "archive does not contain ComGu-CLI/comgu"
  if [ ! -e "$FINAL" ]; then
    mv "$STAGE" "$FINAL"
  fi
fi

CURRENT_TMP="$ROOT/current.tmp.$$"
printf '%s\n' "$VERSION" > "$CURRENT_TMP"
mv "$CURRENT_TMP" "$ROOT/current"

STATE_TMP="$ROOT/install.json.tmp.$$"
cat > "$STATE_TMP" <<EOF
{"version":"$VERSION","tag":"$TAG","artifact":"$ASSET","sha256":"$ACTUAL","channel":"shell","platform":"linux","arch":"$ARCH"}
EOF
mv "$STATE_TMP" "$ROOT/install.json"

cat > "$BIN_DIR/comgu" <<'EOF'
#!/bin/sh
set -eu
ROOT="${COMGU_INSTALL_ROOT:-$HOME/.local/share/comgu-cli}"
SELF="${COMGU_BIN_DIR:-$HOME/.local/bin}/comgu"
case "${1:-}" in
  update)
    curl -fsSL https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.sh | sh
    exit $?
    ;;
  uninstall)
    rm -rf "$ROOT"
    rm -f "$SELF"
    printf '%s\n' 'ComGu CLI program files removed. Profiles, credentials, approved roots, logs, and machine identity were preserved.'
    exit 0
    ;;
esac
VERSION="$(cat "$ROOT/current")"
exec "$ROOT/versions/$VERSION/ComGu-CLI/comgu" "$@"
EOF
chmod 755 "$BIN_DIR/comgu"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH to use comgu from any shell.\n' "$BIN_DIR" ;;
esac
printf 'ComGu CLI %s installed. Run: comgu setup\n' "$VERSION"
