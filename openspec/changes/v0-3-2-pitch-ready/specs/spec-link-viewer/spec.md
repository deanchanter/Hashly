## ADDED Requirements

### Requirement: URL-scheme allow-list on rendered links

The viewer SHALL apply a URL-scheme allow-list (HTTP(S), `mailto:`, in-document `#` anchors) to every `href` and `src` attribute in rendered markdown output, including links and embedded resources inserted dynamically after initial render. The matcher SHALL normalize the attribute value before checking by lowercasing, stripping zero-width characters (U+200B, U+200C, U+200D, U+FEFF), and percent-decoding once, so that bypasses such as `j​avascript:` (zero-width insertion), `j%61vascript:` (percent-encoded), or mixed-case `JaVaScRiPt:` SHALL all be rejected. Disallowed-scheme links SHALL be rendered with their `href` neutralized (set to `#` or removed) and disallowed-scheme images SHALL be rendered with their `src` neutralized.

#### Scenario: Plain `javascript:` URL

- **WHEN** the loaded markdown contains `[click](javascript:alert(1))`
- **THEN** the rendered link's `href` is neutralized; clicking it does not execute JavaScript

#### Scenario: Zero-width-character bypass

- **WHEN** the loaded markdown contains a link whose scheme prefix has a zero-width character inserted (e.g., `j` + U+200B + `avascript:alert(1)`)
- **THEN** the sanitizer normalizes the value, recognizes the disallowed scheme, and neutralizes the link

#### Scenario: Percent-encoded scheme bypass

- **WHEN** the loaded markdown contains a link whose scheme is percent-encoded (e.g., `j%61vascript:alert(1)`)
- **THEN** the sanitizer percent-decodes the value once before matching, recognizes the disallowed scheme, and neutralizes the link

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
