# Hashly

A free, WYSIWYG markdown reader and editor for [Spec-Driven Development](https://specdriven.dev/) workflows. v0.3 is a web app at **<https://hashly-md.pages.dev>** — paste a GitHub spec link in the URL and edit it WYSIWYG; saving opens a pull request on the source repo.

## Use

Open a public-repo markdown file at:

```
https://hashly-md.pages.dev/?repo=<owner>/<name>&path=<spec-path>&ref=<branch-or-sha>
```

For example: <https://hashly-md.pages.dev/?repo=deanchanter/Hashly&path=README.md>

The viewer renders read-only with the v0.2 polish carried over (GFM tables, fenced code, list rhythm, H1 underline, broken-image fallback, frontmatter recognition, light/dark following the OS).

To edit, click into the document and start typing. You'll be redirected to GitHub for sign-in (just-in-time — no auth needed to read), then dropped back where you were. Click **Save** when done; Hashly opens a pull request against the source ref. You don't need a local checkout.

## Embed

The viewer works inside an `<iframe>` — useful for tutorials and courses that want to display a spec inline:

```html
<iframe src="https://hashly-md.pages.dev/?repo=owner/name&path=docs/spec.md" width="600" height="400"></iframe>
```

## Desktop app (legacy)

v0.2.3 was the final desktop release. The Tauri-based macOS app is no longer under active development; the [v0.2.3 release page](https://github.com/deanchanter/Hashly/releases/tag/v0.2.3-bundle-signing) has the last `.dmg`. The Homebrew cask at `deanchanter/homebrew-hashly` is pinned to v0.2.3 and won't receive updates.

The `src-tauri/` crate has been removed from `main`; desktop builds from current `main` no longer work. Use the [`v0.2.3` git tag](https://github.com/deanchanter/Hashly/releases/tag/v0.2.3) for desktop rollback.

## Develop

Frontend (Vite + TypeScript + Milkdown):

```sh
npm install
npm run dev    # local viewer at http://localhost:1420 with mock data
npm test       # vitest + jsdom
```

Worker backend (Cloudflare Workers + WebCrypto):

```sh
cd worker
npm test       # vitest + @cloudflare/vitest-pool-workers
```

The Worker is deployed via `wrangler deploy` from the `worker/` directory; secrets (GitHub App ID, App private key, OAuth client ID/secret, session HMAC key, KV namespace ID) are configured per the [v0.3 external-actions checklist](https://github.com/deanchanter/Hashly/issues/98).

## License & status

Free forever, no monetization. v0.3 is the active development surface; v0.2.x is in maintenance-only mode. See `specs/hashly-vision.md` for the broader product direction.
