## MODIFIED Requirements

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

## ADDED Requirements

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
