## ADDED Requirements

### Requirement: Open a GitHub-hosted spec via URL parameters

The system SHALL accept URL query parameters identifying a GitHub-hosted markdown file (`repo` as `owner/name`, `path` as the file path within the repo, optional `ref` defaulting to the repo's default branch) and load that file's content for rendering.

#### Scenario: Valid public-repo spec link

- **WHEN** a user navigates to `?repo=octocat/specs&path=specs/foo.md`
- **THEN** the system fetches the file's raw content via the GitHub public REST API and prepares it for WYSIWYG rendering

#### Scenario: Missing required parameters

- **WHEN** a user navigates to the app without `repo` or without `path`
- **THEN** the system displays a landing page that explains the URL-parameter format and shows an example link

#### Scenario: Repo or file does not exist

- **WHEN** the GitHub API returns a 404 for the requested file
- **THEN** the system displays a friendly "this spec wasn't found at `<repo>` `<path>`" message rather than a raw error

### Requirement: Anonymous read for public repos

The system SHALL render public-repo specs without requiring sign-in. No GitHub authentication is requested as a precondition for reading.

#### Scenario: Anonymous user opens a public-repo link

- **WHEN** an unauthenticated user opens a link to a `.md` file in a public GitHub repo
- **THEN** the system fetches and renders the file's content without prompting for sign-in

#### Scenario: Anonymous user opens a private-repo link

- **WHEN** an unauthenticated user opens a link to a `.md` file in a private GitHub repo
- **THEN** the system displays a "this spec is in a private repo — sign in with GitHub to view" message with a sign-in affordance, instead of a raw 404 or 403

### Requirement: WYSIWYG rendering using Milkdown

The system SHALL render the loaded markdown content via Milkdown (carried over from the v0.1–v0.2 desktop frontend), preserving the rendering quality already shipped: GFM tables, fenced code blocks with syntax highlighting, broken-image alt-text fallback, list rhythm, GitHub-style H1 underline, and frontmatter recognition.

#### Scenario: Spec contains GFM table

- **WHEN** the loaded spec contains a GitHub-flavored markdown table
- **THEN** the rendered output shows the table with the same polish v0.2.1 shipped on desktop

#### Scenario: Spec contains frontmatter

- **WHEN** the loaded spec begins with YAML frontmatter delimited by `---`
- **THEN** the system recognizes the frontmatter (per v0.2 behavior) and renders it without garbling subsequent content

### Requirement: Light and dark mode

The system SHALL respect the user's `prefers-color-scheme` and render in both light and dark modes with the v0.2 brand palette.

#### Scenario: User's OS is in dark mode

- **WHEN** a user with dark-mode OS preference loads any spec
- **THEN** the rendered output uses the dark-mode palette without a flash of light theme

#### Scenario: User's OS is in light mode

- **WHEN** a user with light-mode OS preference loads any spec
- **THEN** the rendered output uses the light-mode palette without a flash of dark theme

### Requirement: Display source location

The system SHALL display the source repository, file path, and ref of the currently-rendered spec somewhere persistent (e.g., header bar) so the user is never confused about what they are reading.

#### Scenario: Loaded spec is rendering

- **WHEN** a spec has finished loading from `?repo=octocat/specs&path=specs/foo.md&ref=main`
- **THEN** a persistent header shows `octocat/specs` `specs/foo.md` `main` with a link out to the file on github.com

### Requirement: Tutorial-embeddable

The system SHALL render correctly when loaded inside an `<iframe>` with the same URL parameters, so tutorial authors can embed a spec directly in their writing without an extra integration step.

#### Scenario: Standard iframe embed

- **WHEN** the app's URL is loaded inside a 600px-wide `<iframe>` on a third-party page
- **THEN** the spec renders without horizontal scroll, without breaking out of the iframe, and without requiring any cookies or auth for public-repo reads
