// Issue #90 / AC 4.2 — Landing page for missing/invalid params.
//
// Renders a static, Milkdown-free landing surface that explains how to
// use the web viewer (`?repo=…&path=…`) and offers an example link.
// Optionally surfaces a parse-error string in a `[role="alert"]` so the
// user can tell "I forgot the params" apart from "I typed them wrong".

const EXAMPLE_HREF = '?repo=deanchanter/Hashly&path=README.md';

export function renderLanding(host: HTMLElement, error?: string): void {
  // Hard clear — same contract as `renderFileError`.
  host.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'viewer-landing';

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
