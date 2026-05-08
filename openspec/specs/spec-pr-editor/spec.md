# Spec PR editor

## Purpose

An authenticated edit-and-save flow that creates a pull request on the source repo. JIT OAuth (only on first edit). Conflict detection on stale source-ref SHA. Hard-fail with a copy-friendly message when the user lacks write permission on the repo.

## Requirements

### Requirement: Just-in-time GitHub authentication

The system SHALL NOT request GitHub authentication until the user attempts their first edit action on a loaded spec. Reading is anonymous; editing requires sign-in.

#### Scenario: Anonymous user reads a spec without authenticating

- **WHEN** an unauthenticated user loads and reads a public-repo spec without attempting to edit
- **THEN** the system never displays an OAuth prompt or sign-in dialog

#### Scenario: Anonymous user attempts a first edit

- **WHEN** an unauthenticated user attempts their first content-modifying action (typing into the editor, applying formatting)
- **THEN** the system pauses the action, prompts the user to sign in with GitHub, and on successful sign-in resumes the edit on the same content

### Requirement: WYSIWYG editing using Milkdown

The system SHALL allow authenticated users to edit the loaded spec using Milkdown (carried over from v0.1–v0.2 desktop), with the same edit surface the desktop app shipped.

#### Scenario: Authenticated user makes small textual edits

- **WHEN** an authenticated user with write access types into the editor to fix typos or rephrase a sentence
- **THEN** the system records the edits in-memory and updates the rendered preview live

#### Scenario: Authenticated user makes a structural change

- **WHEN** an authenticated user inserts a new heading, list item, or table row using the WYSIWYG affordances
- **THEN** the system records the change and the underlying markdown reflects standard GFM output

### Requirement: Save creates a pull request

The system SHALL, on the user's `Save` action, create a new branch on the target repo, commit the user's edits to it, and open a pull request against the file's source ref. The system SHALL NOT commit directly to the file's source ref.

#### Scenario: Successful save with write access

- **WHEN** an authenticated user with write access on the repo clicks `Save` after making edits
- **THEN** the system creates a branch (e.g., `hashly/spec-edit-<timestamp>`), commits the edits to it, opens a PR against the source ref, and shows the user the PR URL

#### Scenario: Multiple saves within a single session

- **WHEN** an authenticated user clicks `Save` twice in the same session, each time after making further edits
- **THEN** the second save updates the existing PR (pushes a new commit to the same branch) rather than opening a duplicate PR

### Requirement: Conflict detection on stale SHA

The system SHALL, when the file's SHA on the source ref has advanced since the page loaded, refuse to overwrite the upstream change and surface a conflict to the user.

In v0.3 the system SHALL use a strict SHA-equality check: any SHA mismatch (regardless of whether the user's edits actually overlap the upstream change at the line level) is treated as a conflict. Three-way merge of non-overlapping edits is deferred — see follow-up issue #124.

#### Scenario: Stale-SHA save

- **WHEN** the user saves and the source ref has advanced (the file's SHA on the source ref differs from the SHA captured when the user loaded the spec)
- **THEN** the system displays a "your edit and an upstream change overlap; please reload" message, does NOT open or update a PR, and preserves the user's in-memory edits so they can copy them out before reloading

#### Scenario: Same-SHA save (no upstream change)

- **WHEN** the user saves and the source ref has not advanced (the file's SHA matches the captured baseline)
- **THEN** the system proceeds with the save, opens the PR, and reports the PR URL to the user

### Requirement: Hard-fail on no-write-access

The system SHALL detect when an authenticated user lacks write permission on the target repo and SHALL refuse to save with a copy-friendly message asking the user to be added as a collaborator. The system SHALL NOT in v0.3 fork the repo or open a PR from a fork.

#### Scenario: Authenticated user without write access attempts save

- **WHEN** a signed-in user clicks `Save` on a spec in a repo where they have read-only access (or no installed GitHub App permission)
- **THEN** the system displays a message: "You don't have write access to `<repo>`. Ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo) and try again." The system displays no other "save" option such as "fork and PR."

#### Scenario: Permission check happens before any write attempt

- **WHEN** an authenticated user opens a spec in a repo they cannot write to
- **THEN** the system surfaces the no-write-access state proactively (e.g., the editor opens in a "view-only — no write access" state) rather than allowing the user to type and only failing at save time

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
