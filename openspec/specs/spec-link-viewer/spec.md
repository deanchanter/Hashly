# Spec link viewer

## Purpose

A web UI that opens any GitHub-hosted markdown file via a URL query parameter and renders it WYSIWYG in the browser. Anonymous read for public repos; no sign-in required. Light and dark mode. Tutorial-embeddable as an iframe or plain link.

## Requirements

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

### Requirement: URL-scheme allow-list on rendered links

The viewer SHALL apply a URL-scheme allow-list (HTTP(S), `mailto:`, in-document `#` anchors) to every `href` and `src` attribute in rendered markdown output, including links and embedded resources inserted dynamically after initial render. The matcher SHALL normalize the attribute value before checking by lowercasing, stripping zero-width characters (U+200B, U+200C, U+200D, U+FEFF) and ASCII control characters (tab, LF, CR, NUL), and percent-decoding once, so that bypasses such as `j​avascript:` (zero-width insertion), `j%61vascript:` (percent-encoded), `java\tscript:` (ASCII tab), or mixed-case `JaVaScRiPt:` SHALL all be rejected. Disallowed-scheme links SHALL be rendered with their `href` neutralized (set to `#` or removed) and disallowed-scheme images SHALL be rendered with their `src` neutralized.

#### Scenario: Plain `javascript:` URL

- **WHEN** the loaded markdown contains `[click](javascript:alert(1))`
- **THEN** the rendered link's `href` is neutralized; clicking it does not execute JavaScript

#### Scenario: Zero-width-character bypass

- **WHEN** the loaded markdown contains a link whose scheme prefix has a zero-width character inserted (e.g., `j` + U+200B + `avascript:alert(1)`)
- **THEN** the sanitizer normalizes the value, recognizes the disallowed scheme, and neutralizes the link

#### Scenario: Percent-encoded scheme bypass

- **WHEN** the loaded markdown contains a link whose scheme is percent-encoded (e.g., `j%61vascript:alert(1)`)
- **THEN** the sanitizer percent-decodes the value once before matching, recognizes the disallowed scheme, and neutralizes the link

#### Scenario: ASCII control-character bypass

- **WHEN** the loaded markdown contains a link with an ASCII tab/LF/CR (raw or percent-encoded) inside the scheme prefix (e.g., `java\tscript:` or `java%09script:`)
- **THEN** the sanitizer strips the control character before matching, recognizes the disallowed scheme that the WHATWG URL parser would also strip, and neutralizes the link

#### Scenario: Dynamically inserted disallowed-scheme link

- **WHEN** a link with a disallowed scheme is inserted into the rendered viewer surface after initial render (e.g., from a paste, IME composition, or programmatic DOM mutation)
- **THEN** the viewer re-applies the sanitizer to the inserted node and neutralizes the link before any user interaction can dispatch its `href`

#### Scenario: Allowed scheme passes through

- **WHEN** the loaded markdown contains a standard `https://example.com` link or a `mailto:` link
- **THEN** the rendered link's `href` is preserved unchanged

### Requirement: Visible error state on viewer load failure

The viewer SHALL surface a visible error state, with a recovery affordance, when the markdown fetch or `mountViewer` rejects. The viewer SHALL NOT render a silent blank surface on failure. The error state SHALL update `document.title` so that a failed load is distinguishable from a successful one in the browser tab and history.

#### Scenario: GitHub fetch returns network error

- **WHEN** the viewer attempts to fetch a spec and the request fails with a network error
- **THEN** the viewer renders a visible error message naming the failure mode and offers a "retry" affordance and a "back to landing" affordance

#### Scenario: GitHub fetch returns non-2xx other than 404

- **WHEN** the viewer attempts to fetch a spec and GitHub returns 5xx or 403
- **THEN** the viewer renders a visible error message distinguishing this case from "spec not found", offers retry, and updates `document.title` to reflect the error

#### Scenario: `mountViewer` rejection

- **WHEN** the viewer fetch succeeds but `mountViewer` rejects (e.g., Milkdown initialization failure)
- **THEN** the viewer renders a visible error message rather than leaving the surface blank, and exposes the failure to assistive tech via `role="alert"`

#### Scenario: Loading state during fetch

- **WHEN** the viewer is fetching a spec
- **THEN** the surface shows a visible loading indicator until the fetch resolves or rejects, so the user does not see an indistinguishable blank screen during load
