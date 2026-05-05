# GitHub App backend

## Purpose

A backend service (Cloudflare Worker, including Pages Functions) that holds GitHub App credentials, handles the OAuth callback, issues HttpOnly session cookies, and proxies authenticated GitHub API calls so the access token never reaches the frontend.

## Requirements

### Requirement: Backend handles OAuth callback

The system SHALL host a backend endpoint (Cloudflare Worker or equivalent serverless function) that handles the GitHub authentication callback. The GitHub App private key, OAuth client secret, and any signing keys SHALL live only on the backend; they SHALL NOT be present in the frontend bundle, in any client-side configuration, or in the GitHub repo.

#### Scenario: Successful auth callback

- **WHEN** GitHub redirects the user to the backend's callback URL after a successful sign-in
- **THEN** the backend exchanges the authorization code for an access token, issues a session cookie, and redirects the user back to the original spec URL

#### Scenario: Frontend bundle inspection

- **WHEN** an attacker downloads and reads the frontend's JavaScript bundle
- **THEN** no GitHub App private key, OAuth client secret, or other authentication-grade secret is present in the bundle

### Requirement: HttpOnly session cookie

The system SHALL issue session cookies with the `HttpOnly`, `Secure`, and `SameSite=Lax` attributes. JavaScript on the frontend SHALL NOT have access to the GitHub access token at any point.

#### Scenario: Successful session cookie issuance

- **WHEN** the backend successfully authenticates a user and issues a session
- **THEN** the response sets a cookie with `HttpOnly`, `Secure`, and `SameSite=Lax` attributes; the cookie value is opaque (not the GitHub token itself)

#### Scenario: Frontend attempts to read the session cookie

- **WHEN** frontend JavaScript attempts to read `document.cookie`
- **THEN** the session cookie is not present in the returned string (it is `HttpOnly`)

#### Scenario: Frontend makes an authenticated GitHub API call

- **WHEN** the frontend needs to perform an authenticated GitHub action (edit, save, PR)
- **THEN** the frontend calls a backend endpoint, which attaches the GitHub access token server-side and proxies the call to the GitHub API; the access token does not transit through frontend code

### Requirement: GitHub App as default auth method

The system SHALL default to authentication via a registered GitHub App. Tokens obtained via the App SHALL be installation-scoped (limited to the specific repo where the App is installed) and short-lived (using GitHub's standard installation token expiry, ~1 hour, with refresh).

#### Scenario: User installs the GitHub App on a repo

- **WHEN** a user without an existing App installation attempts their first edit on a repo
- **THEN** the system directs them to install the Hashly GitHub App on that repo before completing the auth flow

#### Scenario: Token blast radius

- **WHEN** a session cookie is somehow leaked or replayed
- **THEN** the resulting access can only touch the specific repos the App is installed on, with content read/write scope only — not the user's entire GitHub account

### Requirement: OAuth App fallback path

The system SHALL include a configurable fallback auth path using a registered OAuth App, behind a backend config flag. The fallback SHALL be activatable without a frontend redeploy if GitHub App install friction proves to block early adoption.

#### Scenario: Config flag defaults to GitHub App

- **WHEN** the backend is deployed with default configuration
- **THEN** the auth flow uses the GitHub App; the OAuth App fallback is registered but inactive

#### Scenario: Operator flips the fallback flag

- **WHEN** the backend operator changes the auth config flag from `app` to `oauth-app`
- **THEN** subsequent auth flows use the OAuth App registration; existing sessions remain valid until expiry

#### Scenario: OAuth App fallback is active

- **WHEN** the auth flow is using the OAuth App fallback
- **THEN** the system requests the minimum scope sufficient for single-file edit + PR creation (`public_repo` for public-only, or `repo` if private-repo support is needed); broader scopes are NOT requested
