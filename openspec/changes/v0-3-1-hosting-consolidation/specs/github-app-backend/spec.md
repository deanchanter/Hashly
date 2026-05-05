## ADDED Requirements

### Requirement: Backend served on the same origin as the frontend

The backend SHALL serve `/auth/*` and `/api/*` endpoints on the same origin as the static frontend. The frontend SHALL NOT need cross-origin credential handshakes (CORS preflight with `Access-Control-Allow-Credentials`) to authenticate or call backend endpoints.

This requirement makes explicit a constraint that the v0.2/v0.3 frontend code already imposed via `fetch(..., { credentials: 'same-origin' })` but that the v0.3 deploy violated by hosting the backend on a separate `*.workers.dev` URL. Same-origin operation is required for the existing `SameSite=Lax` session cookie to attach to backend requests without the cross-origin auth dance.

#### Scenario: Frontend calls backend endpoint

- **WHEN** the frontend executes `fetch('/api/save', { credentials: 'same-origin', method: 'POST', body: ... })` from a page loaded at `https://<host>/...`
- **THEN** the request reaches the backend handler at `https://<host>/api/save` without a cross-origin preflight, the session cookie is attached automatically, and the backend can read it server-side

#### Scenario: OAuth callback redirect

- **WHEN** the GitHub OAuth flow redirects the user to the backend's callback endpoint
- **THEN** the callback URL is on the same origin as the frontend (e.g., `https://hashly-md.pages.dev/auth/callback`), the session cookie set by the callback response is scoped to that origin, and the post-callback redirect lands the user back on the same-origin spec URL with the cookie already attached

#### Scenario: Auth start handoff to GitHub

- **WHEN** the user triggers sign-in and the browser navigates to `/auth/start`
- **THEN** the navigation is same-origin (no cross-origin redirect from the frontend host to a separate backend host); the response is a 302 to GitHub's authorization endpoint
