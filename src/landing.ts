// Issue #90 / AC 4.2 — Landing page for missing/invalid params.
//
// Renders a static, Milkdown-free landing surface that explains how to
// use the web viewer (`?repo=…&path=…`) and offers an example link.
// Optionally surfaces a parse-error string in a `[role="alert"]` so the
// user can tell "I forgot the params" apart from "I typed them wrong".

const EXAMPLE_HREF = '?repo=deanchanter/Hashly&path=README.md';

// Issue #90 / fix #7 — wordmark carry-over. Each web-mode surface owns
// its own wordmark since bootstrap strips the static `.hashly-titlebar`
// from index.html. Markup mirrors the v0.2 `index.html` (issue #46) so
// the gold # / ink "hashly" CSS hooks already in src/style.css apply.
function appendWordmark(parent: HTMLElement): void {
  const wordmark = document.createElement('span');
  wordmark.className = 'hashly-wordmark';
  wordmark.setAttribute('aria-label', 'hashly');
  const hash = document.createElement('span');
  hash.className = 'hashly-wordmark__hash';
  hash.setAttribute('aria-hidden', 'true');
  hash.textContent = '#';
  const name = document.createElement('span');
  name.className = 'hashly-wordmark__name';
  name.textContent = 'hashly';
  wordmark.appendChild(hash);
  wordmark.appendChild(name);
  parent.appendChild(wordmark);
}

export function renderLanding(host: HTMLElement, error?: string): void {
  // Hard clear — same contract as `renderFileError`.
  host.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'viewer-landing';

  appendWordmark(wrap);

  if (error !== undefined) {
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.className = 'viewer-landing__error';
    alert.textContent = error;
    wrap.appendChild(alert);
  }

  const heading = document.createElement('h1');
  heading.textContent = 'Hashly viewer';
  wrap.appendChild(heading);

  const explanation = document.createElement('p');
  explanation.textContent =
    'Add a repo and path query parameter to view a public spec — for example, ';
  const link = document.createElement('a');
  link.setAttribute('href', EXAMPLE_HREF);
  link.textContent = EXAMPLE_HREF;
  explanation.appendChild(link);
  explanation.appendChild(document.createTextNode('.'));
  wrap.appendChild(explanation);

  host.appendChild(wrap);
}
