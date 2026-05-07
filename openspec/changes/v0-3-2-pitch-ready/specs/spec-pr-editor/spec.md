## ADDED Requirements

### Requirement: Visible feedback on JIT-auth navigation

The editor SHALL surface visible loading or redirect feedback when the JIT-auth flow navigates the user away to GitHub for sign-in, so that the user does not perceive a silent click. The view-only lock screen (shown when an authenticated user lacks push access) SHALL include a recovery affordance that lets the user return to the read-only viewer without reloading the page.

#### Scenario: Anonymous user clicks Edit and is redirected to sign-in

- **WHEN** an unauthenticated user clicks `Edit` on a loaded spec
- **THEN** the UI shows a visible "redirecting to GitHub…" indicator before the navigation, so the user is not staring at an unchanged surface during the redirect round-trip

#### Scenario: View-only lock provides a recovery affordance

- **WHEN** an authenticated user without push access reaches the view-only lock screen
- **THEN** the lock screen offers a visible "back to read-only view" affordance that returns the user to the viewer without a page reload, in addition to surfacing the sign-out and "request access" copy

### Requirement: Visible feedback on Save outcomes

The Save flow SHALL render a visible, dismissible banner for every terminal outcome — success (with the PR URL), conflict (stale source SHA), permission-denied, network or backend error — using consistent ARIA semantics (`role="status"` for success/info, `role="alert"` for errors). The banner SHALL manage focus on appearance so keyboard and screen-reader users are notified, and the banner's dismiss control SHALL return focus to a sensible target (the Save button or the editor surface). Save error banners SHALL include a "copy details" affordance with feedback when copy succeeds.

#### Scenario: Successful save renders a success banner with the PR URL

- **WHEN** a save completes successfully and the backend returns a PR URL
- **THEN** a success banner appears with the PR URL, a copy-to-clipboard affordance with visible feedback when the copy succeeds, and a dismiss control

#### Scenario: Save fails with a permission-denied error

- **WHEN** a save fails because the user no longer has push access on the target repo
- **THEN** an error banner appears with copy that names the failure mode, a sign-in affordance for re-authenticating, and a link to the GitHub App install/grant page

#### Scenario: Save fails with a network or backend error

- **WHEN** a save fails because of a network error or a non-2xx response from the backend
- **THEN** an error banner appears with copy that distinguishes "transient" from "permission" errors and offers a "copy details" affordance

#### Scenario: Banner ARIA semantics

- **WHEN** any save banner appears
- **THEN** the banner uses `role="status"` for success/info or `role="alert"` for errors, and screen readers announce its content without the user having to hunt for it

### Requirement: Save flow guards against duplicate concurrent submissions

The Save flow SHALL prevent multiple in-flight save submissions for the same edit. While a save is in flight, the Save button and `Cmd+S` keyboard handler SHALL be disarmed; subsequent submissions SHALL coalesce or be dropped without firing additional backend requests.

#### Scenario: Rapid Cmd+S during a pending save

- **WHEN** a user presses `Cmd+S` repeatedly while a save is already in flight
- **THEN** only one `POST /api/save` request is dispatched; subsequent presses do not fire additional requests

#### Scenario: Save button click during a pending save

- **WHEN** a user clicks the Save button while a save is already in flight
- **THEN** the click is ignored and no additional `POST /api/save` request is dispatched
