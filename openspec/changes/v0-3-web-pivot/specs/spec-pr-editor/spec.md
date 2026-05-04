## ADDED Requirements

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

### Requirement: Auto-rebase on stale SHA

The system SHALL, when the file's SHA on the source ref has advanced since the page loaded, attempt to rebase the user's edits onto the latest content before opening or updating the PR.

#### Scenario: Non-overlapping edits during stale-SHA save

- **WHEN** the user saves and the source ref has advanced, but the upstream changes do not overlap with the user's edits at the line level
- **THEN** the system fetches the latest content, applies the user's edits onto it via three-way merge, and proceeds with the PR using the rebased content

#### Scenario: Overlapping edits during stale-SHA save

- **WHEN** the user saves and the upstream changes overlap with the user's edits at the line level (a real conflict)
- **THEN** the system displays a "your edit and an upstream change overlap; please reload to see the latest version" message, does NOT open or update a PR, and preserves the user's in-memory edits so they can copy them out before reloading

### Requirement: Hard-fail on no-write-access

The system SHALL detect when an authenticated user lacks write permission on the target repo and SHALL refuse to save with a copy-friendly message asking the user to be added as a collaborator. The system SHALL NOT in v0.3 fork the repo or open a PR from a fork.

#### Scenario: Authenticated user without write access attempts save

- **WHEN** a signed-in user clicks `Save` on a spec in a repo where they have read-only access (or no installed GitHub App permission)
- **THEN** the system displays a message: "You don't have write access to `<repo>`. Ask the dev to add you as a collaborator (or install the Hashly GitHub App on the repo) and try again." The system displays no other "save" option such as "fork and PR."

#### Scenario: Permission check happens before any write attempt

- **WHEN** an authenticated user opens a spec in a repo they cannot write to
- **THEN** the system surfaces the no-write-access state proactively (e.g., the editor opens in a "view-only — no write access" state) rather than allowing the user to type and only failing at save time
