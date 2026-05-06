## ADDED Requirements

### Requirement: Visible edit-mode entry affordance in the viewer header

The system SHALL render a visible, click-driven `Edit` control in the viewer header whenever a spec has successfully loaded for read. The control SHALL be the primary user-facing entry point into the JIT-auth edit flow; pressing keys in the read-only document SHALL remain a secondary entry point but SHALL NOT be the only way to enter edit mode.

The control SHALL be disabled (and present a non-interactive state) until the spec has finished loading, and SHALL be enabled once the read-only viewer has mounted. Activating the control SHALL invoke the same JIT-auth state machine as the keydown entry: anonymous users SHALL be redirected to sign-in, signed-in users without push permission SHALL see the view-only-lock state, and signed-in users with push permission SHALL flip into edit mode.

The control SHALL NOT be rendered on the landing page or on the viewer-error surface — only when a spec has loaded successfully.

#### Scenario: Anonymous user clicks the Edit control

- **WHEN** an unauthenticated user loads a public-repo spec successfully and clicks the `Edit` control in the viewer header
- **THEN** the system pauses the action, stashes a one-shot pending-edit flag in `sessionStorage`, and redirects to the GitHub OAuth start endpoint — identical to the path taken when the user starts typing in the read-only document

#### Scenario: Authenticated user with push access clicks the Edit control

- **WHEN** a signed-in user with push permission on the source repo clicks the `Edit` control
- **THEN** the system flips the read-only viewer into edit mode (the underlying ProseMirror editor becomes editable and the formatting toolbar appears) without prompting for re-authentication

#### Scenario: Authenticated user without push access clicks the Edit control

- **WHEN** a signed-in user who lacks push permission on the source repo clicks the `Edit` control
- **THEN** the system displays the view-only-lock message ("You don't have write access to `<repo>` …") and does NOT flip the editor into edit mode

#### Scenario: Edit control before the spec has loaded

- **WHEN** the viewer header has rendered but the read-only viewer has not finished mounting
- **THEN** the `Edit` control is present in the DOM but reports a disabled / non-interactive state, so a click is a no-op until the mount completes

#### Scenario: Edit control is absent on landing and error surfaces

- **WHEN** the user is on the landing page (no spec parameters) or the viewer-error surface (the spec failed to load)
- **THEN** the `Edit` control is not rendered, since there is no document to edit
