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

The system SHALL default to authentication via a registered GitHub App. Tokens obtained via the App SHALL be installation-scoped (limited to the specific repo where the App is installed) and short-lived (using GitHub's standard installation token expiry, ~1 hour, with refresh). The sign-in entry point under `AUTH_METHOD=app` SHALL use GitHub's user-to-server OAuth authorize endpoint (`https://github.com/login/oauth/authorize`) with the App's client ID, so the OAuth round-trip completes regardless of whether the user (or their org) already has the App installed.

#### Scenario: User installs the GitHub App on a repo

- **WHEN** a user without an existing App installation attempts their first edit on a repo
- **THEN** the system directs them through the App install flow and then through the OAuth round-trip, landing them on the backend callback with both an authorization code and an `installation_id`

#### Scenario: Already-installed user signs in

- **WHEN** a user (or org) that already has the Hashly GitHub App installed clicks `Edit` on a spec
- **THEN** the system redirects to GitHub's user-to-server OAuth authorize endpoint and GitHub redirects back to the backend callback with `code` and `installation_id` populated, without requiring the user to uninstall and reinstall the App

#### Scenario: Token blast radius

- **WHEN** a session cookie is somehow leaked or replayed
- **THEN** the resulting access can only touch the specific repos the App is installed on, with content read/write scope only — not the user's entire GitHub account

### Requirement: Origin allow-list on state-changing endpoints

The backend SHALL validate the request `Origin` header against an allow-list on every state-changing endpoint (`POST /api/save`, `POST /api/github/*`, `POST /auth/logout`, and any future POST handler under `/auth/*` or `/api/*`). The allow-list SHALL include the production Pages origin, the preview-deploy origin pattern, and the local-dev origin. Requests whose `Origin` is missing or not in the allow-list SHALL be rejected with HTTP 403 and SHALL NOT execute side effects.

#### Scenario: State-changing request with allowed Origin

- **WHEN** the frontend on `https://hashly-md.pages.dev` submits `POST /api/save` with `Origin: https://hashly-md.pages.dev`
- **THEN** the backend processes the request normally

#### Scenario: State-changing request with foreign Origin

- **WHEN** an attacker page on `https://evil.example` triggers `POST /api/save` against the Hashly backend
- **THEN** the backend rejects the request with HTTP 403, sets `Cache-Control: no-store`, and does not create a branch, commit, or pull request

#### Scenario: State-changing request with missing Origin

- **WHEN** a request to `POST /api/save` arrives with no `Origin` header
- **THEN** the backend rejects the request with HTTP 403 and does not execute side effects

#### Scenario: Preview-deploy origin

- **WHEN** the frontend on a Cloudflare Pages preview URL (e.g., `https://abc123.hashly-md.pages.dev`) submits `POST /api/save` with that preview URL as `Origin`
- **THEN** the backend processes the request normally because the preview-deploy pattern is in the allow-list

### Requirement: Method allow-list on backend routes

The backend SHALL respond with HTTP 405 (`Method Not Allowed`) for requests whose method is not supported by the matched route, with `Cache-Control: no-store`. Wrong-method requests on known route paths SHALL NOT fall through to the static-asset handler and SHALL NOT return SPA HTML.

#### Scenario: GET on a POST-only route

- **WHEN** an unauthenticated client issues `GET /api/save`
- **THEN** the backend returns HTTP 405 with no body and `Cache-Control: no-store` — not the SPA `index.html` and not 404

#### Scenario: POST on a GET-only route

- **WHEN** a client issues `POST /auth/start`
- **THEN** the backend returns HTTP 405 with no body and `Cache-Control: no-store`

#### Scenario: Supported method on a known route

- **WHEN** a client issues a method the route declares as supported
- **THEN** the backend processes the request normally (the method gate is transparent on the happy path)

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

### Requirement: Backend served same-origin with the frontend

The backend SHALL be reachable on the same origin (scheme + host + port) as the static frontend. The frontend issues `fetch(..., { credentials: 'same-origin' })` against `/auth/*` and `/api/*` paths and relies on the browser to attach the session cookie unconditionally; cross-origin deployment would require either CORS preflight + `credentials: 'include'` (not used) or a custom-domain workaround.

#### Scenario: `/auth/start` is reachable as a same-origin path

- **WHEN** the browser issues a same-origin `GET /auth/start` against the deployed origin
- **THEN** the backend responds with a redirect to GitHub (302) and sets the state cookie on the same-origin response — no separate API host, no CORS preflight required

#### Scenario: `/api/session-status` honors the cookie without CORS

- **WHEN** the browser issues a same-origin `GET /api/session-status` with the session cookie attached
- **THEN** the backend returns a JSON response WITHOUT any `Access-Control-*` headers — the request is same-origin, so the browser sends the cookie unconditionally and no CORS dance is needed

#### Scenario: OAuth callback redirects to a same-origin URL

- **WHEN** the user completes the OAuth round-trip with a same-origin `return` URL embedded in the state cookie
- **THEN** the backend's callback response sets a `Location` header pointing at a URL with the same scheme + host as the original request — never a cross-origin URL — falling back to `/` if the encoded `return` is missing or fails the same-origin check
