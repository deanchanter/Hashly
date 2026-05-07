# Hashly — Vision

**Status:** Draft
**Author:** deanchanter
**Date:** 2026-04-28
**Horizon:** _Open — TBD_

## Summary

Hashly is a free, writing-first, WYSIWYG markdown editor aimed at non-engineers participating in Spec-Driven Development workflows. The bet is that as AI-assisted coding and SDD push markdown from a side artifact to the primary artifact, the existing free options — which are all code-editor-shaped — will feel wrong for PMs, designers, and other non-eng collaborators. Hashly's win condition is becoming the markdown editor that SDD tutorials recommend by default. This is a portfolio / reputation play, not a business — free forever, no monetization.

## Problem space & why now

People writing markdown today are stuck choosing between code-editor-shaped tools (VS Code, Zed, Sublime) that are free but wrong-shaped for writing, and writing-shaped tools (iA Writer, Typora) that cost money. The free, writing-first slot is empty.

What's changed: AI-assisted coding and Spec-Driven Development have moved markdown from a side artifact (READMEs, notes) to the *primary* artifact — specs, prompts, agent instructions, plans. That pulls in a new audience (PMs, designers, non-engineers participating in SDD) who don't want an IDE and shouldn't have to pick one.

If nothing changes: SDD tutorials keep defaulting to "open VS Code" because it's the free option with a name, and non-eng SDD participants keep using a tool that wasn't built for them.

## Target segments

**Primary segment(s):** PMs, designers, and other non-engineers participating in SDD workflows. Sizing is unknown — could be niche-but-passionate or broad as SDD goes mainstream; left as an open question.

**Explicitly not the target:**
- Developers who want IDE-like features (vim mode, integrated terminal, syntax themes, language servers).
- PKM / note-graph users (the Obsidian audience).

WYSIWYG-only users — people who don't want to see raw markdown syntax — *are* in scope.

## Strategic goals

- Become the default markdown editor recommended in SDD tutorials, courses, and blog posts.
- Get deanchanter's name attached to a recognizable tool in the SDD space.
- Stay free forever; resist the pull toward monetization features.

## Success signals

| Signal | Rough target | Horizon |
|---|---|---|
| Mentions / links in SDD tutorials, blog posts, videos | TBD | TBD |
| Other leading metrics (stars, weekly active writers, session length) | TBD | TBD |

_Horizon and concrete metric targets are open questions — see below._

## Differentiation & bets

**How this differs from alternatives or status quo:**

- vs. **VS Code / Zed / Sublime** — writing-first surface, not a code editor that happens to render markdown.
- vs. **iA Writer / Typora** — free, no paywall.
- vs. **MarkText** — active, with a distribution wedge (SDD communities) rather than generic "free WYSIWYG."
- vs. **Obsidian** — explicitly not PKM; no graph, no vault, no plugin economy.

**Core bets / assumptions that must hold:**

- SDD continues to grow as a movement and keeps markdown as its primary artifact.
- A free, writing-first, WYSIWYG editor is "good enough not to embarrass" — the bar is credibility, not feature parity with paid tools.
- Distribution through SDD tutorials and communities is reachable for a solo builder.

**Biggest risk to the thesis:**

Never cracking the distribution loop — Hashly ships and works fine, but SDD tutorials keep recommending VS Code anyway. No mitigation locked in yet; this is the load-bearing risk to revisit each phase.

## Horizon & shape

Rough phase sketch (not a roadmap):

- **v0.1** — WYSIWYG editor that opens and saves a single `.md` file. Runs on Mac. Light and dark modes from day one.
- **v0.2** — Spec templates and frontmatter helpers (the SDD-native wedge).
- **v0.3** — Web build, so tutorials and courses can embed or link directly. Extended in implementation: the web build also supports authenticated edit-and-save via just-in-time GitHub auth, with saves landing as pull requests on the source repo. The desktop app (v0.2.3) is sunset; v0.3 is the active surface. Reconciliation note 2026-05-05: the original "embed or link directly" framing understated the scope — v0.3 ships viewer-AND-editor with PR-back save, addressing the validated PM/dev workflow gap that motivated the pivot.
- **v0.3.1** — Hosting consolidation: ported the standalone Cloudflare Worker (`worker/src/*`) into Pages Functions (`functions/`) so the frontend and backend share the `*.pages.dev` origin without a service-binding indirection. Rationale: the v0.3 deploy on 2026-05-05 surfaced that `*.pages.dev` URLs cannot route prefixes to a separate Worker without either a custom domain (deferred per #98 item 12) or a Pages Functions service-binding proxy (chosen as the v0.3 stopgap). Porting consolidates secret + KV management onto the Pages project, removes the proxy hop, and cuts the dual `wrangler deploy` cycle. Scoped narrowly to the move; no behavior change. Shipped 2026-05-07.
- **v0.3.2** — Pitch-ready hardening: closes the JIT-auth round-trip (#153 → /login/oauth/authorize), adds a centralized origin + method gate for state-changing routes, hardens the URL sanitizer against the bypass class from #105 (zero-width chars, percent-encoded variants, ASCII control chars, MutationObserver re-sweep), refactors viewer/editor/save error+status surfaces onto a single banner primitive with WCAG AA contrast and full keyboard control, and stands up a Playwright e2e layer with a hostname-gated auth stub for scenario-based testing. Goal: a deploy that holds up to a live walkthrough in a pitch / demo without obvious gaps.
- **After v0.3** — push for the first tutorial mention; let distribution feedback shape what comes next. v0.4 likely opens with the SDD-tutorial wedge (the actual distribution lever, separate from the readiness work in v0.3.x).

## Non-goals for this horizon

- No plugin system.
- No sync.
- No mobile.
- No collaboration / multiplayer.
- No AI features beyond export-friendly output.
- No monetization, paid tier, or "pro" features.
- No PKM / note-graph / vault concepts.
- No IDE-style features (vim mode, terminal, LSP, etc.).

## Hard constraints

- Light and dark modes are required, not optional.

## Stakeholders to align

Solo build — just deanchanter. No co-builder, design partner, or SDD-community contact lined up yet.

## Open questions

- What's the horizon? 1 year, 2 years, 3+? Strategy differs significantly across these.
- What leading metrics should be tracked toward "default in SDD tutorials," and at what rough targets?
- How big is the wedge audience (non-eng SDD participants) — niche-but-passionate or broad?
- How will the distribution loop actually be cracked, given it's the biggest risk?
- Which SDD communities, tutorial authors, or courses are the first realistic amplifiers?

## References

- iA Writer — paid, writing-focused (positioning reference).
- Typora — paid WYSIWYG markdown (positioning reference).
- MarkText — free WYSIWYG, low momentum (positioning reference).
- Obsidian — free, PKM-shaped; explicit non-target audience.

---

_Generated via feature-interviewer skill on 2026-04-28 (level: vision)_
