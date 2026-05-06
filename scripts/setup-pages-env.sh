#!/usr/bin/env bash
# Pages env setup for issue #140 (v0.3.1 hosting consolidation).
#
# Runs the wrangler-automatable parts of issue #140:
#   7.1 / 7.2  create KV namespaces (prod + preview)
#   7.3 / 7.4  upload the 5 encrypted secrets (prod + preview)
#   7.6        generate fresh SESSION_HMAC_KEY values
#
# Still requires manual dashboard work after this script finishes:
#   7.5  bind SESSIONS KV → namespaces (Pages Settings → Functions → KV bindings)
#        also set plain (non-encrypted) env vars: GITHUB_APP_SLUG, AUTH_METHOD
#   7.7  rotate GitHub App private key in GitHub App admin UI before running this
#   7.8 / 7.9  GitHub App callback URL allowlist
#
# Prereqs:
#   - wrangler installed globally (npm i -g wrangler) and `wrangler login` done
#   - GitHub App private key (.pem) downloaded locally
#   - GitHub OAuth Client ID + Secret on hand
#   - GITHUB_APP_ID on hand (number from the App's settings page)

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-hashly-md}"

say()  { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
warn() { printf "\033[1;33m!! %s\033[0m\n" "$*" >&2; }
die()  { printf "\033[1;31mxx %s\033[0m\n" "$*" >&2; exit 1; }

command -v wrangler >/dev/null || die "wrangler not on PATH. Run: npm i -g wrangler && wrangler login"
command -v openssl  >/dev/null || die "openssl required for HMAC key generation"

say "Confirm Pages project name"
echo "Using PROJECT_NAME=$PROJECT_NAME (override with: PROJECT_NAME=foo $0)"
read -rp "Continue? [y/N] " ok
[[ "$ok" == "y" || "$ok" == "Y" ]] || die "aborted"

# ---- 7.1 / 7.2: KV namespaces ------------------------------------------------
say "7.1 — create prod KV namespace"
wrangler kv namespace create hashly-pages-sessions-prod || warn "prod namespace may already exist"

say "7.2 — create preview KV namespace"
wrangler kv namespace create hashly-pages-sessions-preview || warn "preview namespace may already exist"

cat <<EOF

>>> Copy the namespace IDs printed above. You'll paste them in the Pages
>>> dashboard → Settings → Functions → KV namespace bindings (binding name
>>> must be exactly: SESSIONS) for Production and Preview environments.

EOF
read -rp "Press enter once you've noted the IDs..." _

# ---- 7.6: fresh HMAC keys ----------------------------------------------------
say "7.6 — generate SESSION_HMAC_KEY values"
PROD_HMAC="$(openssl rand -base64 32)"
PREVIEW_HMAC="$(openssl rand -base64 32)"
echo "Production  SESSION_HMAC_KEY: $PROD_HMAC"
echo "Preview     SESSION_HMAC_KEY: $PREVIEW_HMAC"
echo "(stash these somewhere safe — script will pipe them into wrangler below)"
read -rp "Press enter to continue..." _

# ---- 7.3 / 7.4: secrets ------------------------------------------------------
#
# wrangler pages secret put behavior re: production vs preview varies by
# version. Confirm with: wrangler pages secret put --help
#   Recent wrangler: --project-name <name>           → Production
#                    --project-name <name> --env preview → Preview
# If your version differs, edit the put_secret function below.

put_secret_prod() {
  local key="$1" value="$2"
  printf '%s' "$value" | wrangler pages secret put "$key" --project-name "$PROJECT_NAME"
}

put_secret_preview() {
  local key="$1" value="$2"
  # If --env preview is rejected by your wrangler version, try:
  #   wrangler pages secret put "$key" --project-name "$PROJECT_NAME" --environment preview
  printf '%s' "$value" | wrangler pages secret put "$key" --project-name "$PROJECT_NAME" --env preview
}

prompt_value() {
  local label="$1"
  local v
  read -rsp "$label: " v
  echo >&2
  printf '%s' "$v"
}

prompt_pem_path() {
  local p
  read -rp "Path to GitHub App private key .pem file: " p
  [[ -f "$p" ]] || die "file not found: $p"
  cat "$p"
}

say "Collecting secret values (input is hidden where appropriate)"
GITHUB_APP_ID="$(prompt_value 'GITHUB_APP_ID (numeric App ID)')"
GITHUB_APP_PRIVATE_KEY="$(prompt_pem_path)"
GITHUB_OAUTH_CLIENT_ID="$(prompt_value 'GITHUB_OAUTH_CLIENT_ID')"
GITHUB_OAUTH_CLIENT_SECRET="$(prompt_value 'GITHUB_OAUTH_CLIENT_SECRET')"

say "7.3 — upload PRODUCTION secrets"
put_secret_prod GITHUB_APP_ID              "$GITHUB_APP_ID"
put_secret_prod GITHUB_APP_PRIVATE_KEY     "$GITHUB_APP_PRIVATE_KEY"
put_secret_prod GITHUB_OAUTH_CLIENT_ID     "$GITHUB_OAUTH_CLIENT_ID"
put_secret_prod GITHUB_OAUTH_CLIENT_SECRET "$GITHUB_OAUTH_CLIENT_SECRET"
put_secret_prod SESSION_HMAC_KEY           "$PROD_HMAC"

say "7.4 — upload PREVIEW secrets"
read -rp "Reuse same App/OAuth values for preview? [Y/n] " reuse
if [[ "$reuse" == "n" || "$reuse" == "N" ]]; then
  GITHUB_APP_ID="$(prompt_value 'preview GITHUB_APP_ID')"
  GITHUB_APP_PRIVATE_KEY="$(prompt_pem_path)"
  GITHUB_OAUTH_CLIENT_ID="$(prompt_value 'preview GITHUB_OAUTH_CLIENT_ID')"
  GITHUB_OAUTH_CLIENT_SECRET="$(prompt_value 'preview GITHUB_OAUTH_CLIENT_SECRET')"
fi
put_secret_preview GITHUB_APP_ID              "$GITHUB_APP_ID"
put_secret_preview GITHUB_APP_PRIVATE_KEY     "$GITHUB_APP_PRIVATE_KEY"
put_secret_preview GITHUB_OAUTH_CLIENT_ID     "$GITHUB_OAUTH_CLIENT_ID"
put_secret_preview GITHUB_OAUTH_CLIENT_SECRET "$GITHUB_OAUTH_CLIENT_SECRET"
put_secret_preview SESSION_HMAC_KEY           "$PREVIEW_HMAC"

say "Done. Remaining manual steps:"
cat <<'EOF'
  [ ] Pages → Settings → Functions → KV namespace bindings:
        Production: SESSIONS → hashly-pages-sessions-prod
        Preview:    SESSIONS → hashly-pages-sessions-preview
  [ ] Pages → Settings → Environment variables → add PLAIN (non-encrypted) vars
      to BOTH Production and Preview:
        GITHUB_APP_SLUG = <your GitHub App's URL slug>
        AUTH_METHOD     = app
  [ ] GitHub App admin: revoke the OLD private key (you uploaded the new one above)
  [ ] GitHub App admin: confirm callback URLs include
        https://hashly-md.pages.dev/auth/callback
        and a preview-callback pattern (wildcard if accepted)
EOF
