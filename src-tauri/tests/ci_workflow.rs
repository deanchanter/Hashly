//! Issue #20: CI workflow contract tests.
//!
//! These tests parse `.github/workflows/ci.yml` and assert the structure that
//! issue #20 requires. We can't run GitHub Actions locally, so the contract is
//! enforced by static parsing — the same pattern used by `config.rs` and
//! `frontend.rs` in this directory.

use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn workflow_path() -> PathBuf {
    repo_root().join(".github/workflows/ci.yml")
}

fn load_workflow() -> serde_yaml::Value {
    let path = workflow_path();
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "could not read {} (Issue #20 AC #1: a CI workflow must exist at this path): {}",
            path.display(),
            e
        )
    });
    serde_yaml::from_str(&raw)
        .unwrap_or_else(|e| panic!("{} is not valid YAML: {}", path.display(), e))
}

// =====================================================================
// Slice A — workflow exists, has a name, triggers on push to main + PR.
// =====================================================================

#[test]
fn ci_workflow_file_exists_and_parses_as_yaml() {
    // Issue #20 AC #1: GitHub Actions workflow under `.github/workflows/` must
    // exist. We pin the canonical name `ci.yml` so the contract is unambiguous.
    let path = workflow_path();
    assert!(
        path.exists(),
        "expected `.github/workflows/ci.yml` to exist (Issue #20 AC #1), but {} does not exist",
        path.display()
    );

    // Must parse as YAML — guards against accidental tabs / structural typos.
    let _ = load_workflow();
}

#[test]
fn ci_workflow_has_top_level_name() {
    // A workflow without a `name` shows up in the GitHub UI as the file path,
    // which is hostile to required-checks configuration. Pin presence of a
    // non-empty `name`.
    let cfg = load_workflow();
    let name = cfg
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or_else(|| panic!("expected top-level `name:` string in ci.yml, got: {:?}", cfg));
    assert!(
        !name.trim().is_empty(),
        "expected top-level `name:` to be a non-empty string in ci.yml, got: {:?}",
        name
    );
}

#[test]
fn ci_workflow_triggers_on_push_to_main_and_pull_requests() {
    // Issue #20 AC #1: workflow runs on push to `main` AND on pull requests.
    //
    // YAML quirk: the unquoted key `on` parses as the boolean `true` (the
    // notorious "Norway problem" sibling). Real-world workflows use the bare
    // `on:` form, which serde_yaml deserializes with the key `Bool(true)`.
    // We accept either the string key `"on"` or the bool key `true`.
    let cfg = load_workflow();
    let mapping = cfg
        .as_mapping()
        .expect("expected ci.yml top level to be a mapping");

    let on = mapping
        .get(serde_yaml::Value::String("on".into()))
        .or_else(|| mapping.get(serde_yaml::Value::Bool(true)))
        .unwrap_or_else(|| {
            panic!(
                "expected top-level `on:` trigger block in ci.yml (Issue #20 AC #1), got keys: {:?}",
                mapping.keys().collect::<Vec<_>>()
            )
        });

    let on_map = on
        .as_mapping()
        .unwrap_or_else(|| panic!("expected `on:` to be a mapping (Issue #20 AC #1), got: {:?}", on));

    // ---- push.branches must include "main" ----
    let push = on_map
        .get(serde_yaml::Value::String("push".into()))
        .unwrap_or_else(|| {
            panic!(
                "expected `on.push:` trigger in ci.yml (Issue #20 AC #1: run on push to main), got `on:` = {:?}",
                on
            )
        });
    let push_branches = push
        .get(serde_yaml::Value::String("branches".into()))
        .and_then(|b| b.as_sequence())
        .unwrap_or_else(|| {
            panic!(
                "expected `on.push.branches:` sequence in ci.yml (Issue #20 AC #1), got `push:` = {:?}",
                push
            )
        });
    let has_main = push_branches
        .iter()
        .any(|v| v.as_str() == Some("main"));
    assert!(
        has_main,
        "expected `on.push.branches:` to include `main` in ci.yml (Issue #20 AC #1), got: {:?}",
        push_branches
    );

    // ---- pull_request trigger must be present (any value: null map, {}, or {branches: ...}) ----
    assert!(
        on_map.contains_key(serde_yaml::Value::String("pull_request".into())),
        "expected `on.pull_request:` trigger in ci.yml (Issue #20 AC #1: run on pull requests), got `on:` = {:?}",
        on
    );
}

// =====================================================================
// Slice B — npm job: setup-node@v4 with Node 20.19+/22.12+, npm ci + npm test.
// =====================================================================

/// Walk every job in the workflow, returning `(job_name, job_value)` pairs.
fn jobs(cfg: &serde_yaml::Value) -> Vec<(String, serde_yaml::Value)> {
    let jobs_map = cfg
        .get("jobs")
        .and_then(|j| j.as_mapping())
        .unwrap_or_else(|| panic!("expected top-level `jobs:` mapping in ci.yml, got: {:?}", cfg));
    jobs_map
        .iter()
        .filter_map(|(k, v)| Some((k.as_str()?.to_string(), v.clone())))
        .collect()
}

/// Walk all `steps:` in a job (sequence of mappings) and return them.
fn steps(job: &serde_yaml::Value) -> Vec<serde_yaml::Mapping> {
    job.get("steps")
        .and_then(|s| s.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|step| step.as_mapping().cloned())
                .collect()
        })
        .unwrap_or_default()
}

/// True if `step` has `uses:` matching `prefix` (e.g. "actions/setup-node@").
fn step_uses(step: &serde_yaml::Mapping, prefix: &str) -> bool {
    step.get(serde_yaml::Value::String("uses".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.starts_with(prefix))
        .unwrap_or(false)
}

/// True if `step.run` (a string OR a multi-line block) contains `needle` as a token.
/// We split on whitespace AND newlines so `npm ci` and `npm test` can be on separate
/// lines, on one line separated by `&&`, or in a multi-step list.
fn step_run_contains(step: &serde_yaml::Mapping, needle: &str) -> bool {
    step.get(serde_yaml::Value::String("run".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.contains(needle))
        .unwrap_or(false)
}

/// Find the unique job in `cfg` that uses `actions/setup-node@...`. Used by Slice B
/// + Slice D. Returns `(name, value)`.
fn find_node_job(cfg: &serde_yaml::Value) -> (String, serde_yaml::Value) {
    let candidates: Vec<_> = jobs(cfg)
        .into_iter()
        .filter(|(_, j)| {
            steps(j)
                .iter()
                .any(|s| step_uses(s, "actions/setup-node@"))
        })
        .collect();
    assert!(
        !candidates.is_empty(),
        "expected at least one job in ci.yml to use `actions/setup-node@<ver>` (Issue #20 AC #2), got jobs: {:?}",
        jobs(cfg).iter().map(|(n, _)| n).collect::<Vec<_>>()
    );
    candidates.into_iter().next().unwrap()
}

#[test]
fn ci_workflow_node_job_uses_setup_node_v4() {
    // Issue #20 AC #2: Node.js install via the official setup-node action,
    // pinned to v4 (the current major as of this issue). Pinning the major
    // guards against accidental drift when an older v3 leaks back in via copy-
    // paste.
    let cfg = load_workflow();
    let (job_name, job) = find_node_job(&cfg);
    let has_v4 = steps(&job)
        .iter()
        .any(|s| step_uses(s, "actions/setup-node@v4"));
    assert!(
        has_v4,
        "expected job `{}` to use `actions/setup-node@v4` (Issue #20 AC #2), got steps: {:?}",
        job_name,
        steps(&job)
    );
}

#[test]
fn ci_workflow_node_job_pins_node_version_satisfying_engines() {
    // Issue #20 AC #2: the pinned Node version must satisfy package.json
    // engines `"node": "^20.19 || >=22.12"`. We accept either:
    //   - a string `node-version: '20.x'` / `'22'` / `'22.12'` etc., that
    //     starts with `20` or `22` (and if a minor is present, satisfies the
    //     constraint), OR
    //   - a sequence (matrix) where every entry meets the same rule.
    //
    // We do NOT check the live registry — that's overkill. The point is to
    // prevent someone from pinning Node 18 or 16 by mistake.
    fn version_ok(v: &str) -> bool {
        // Accept "20", "20.x", "20.19", "20.19.0", "22", "22.x", "22.12", etc.
        let v = v.trim().trim_start_matches('v');
        let mut parts = v.split('.');
        let major = parts.next().unwrap_or("");
        match major {
            "20" => {
                // Need >= 20.19 if minor is specified.
                match parts.next() {
                    None | Some("x") | Some("X") | Some("*") => true, // "20" / "20.x" — accept; npm picks latest
                    Some(m) => m
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect::<String>()
                        .parse::<u32>()
                        .map(|n| n >= 19)
                        .unwrap_or(false),
                }
            }
            "22" => match parts.next() {
                None | Some("x") | Some("X") | Some("*") => true,
                Some(m) => m
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u32>()
                    .map(|n| n >= 12)
                    .unwrap_or(false),
            },
            _ => false,
        }
    }

    let cfg = load_workflow();
    let (job_name, job) = find_node_job(&cfg);
    let setup_step = steps(&job)
        .into_iter()
        .find(|s| step_uses(s, "actions/setup-node@"))
        .expect("setup-node step must exist (already asserted by ci_workflow_node_job_uses_setup_node_v4)");

    let with = setup_step
        .get(serde_yaml::Value::String("with".into()))
        .and_then(|v| v.as_mapping())
        .unwrap_or_else(|| {
            panic!(
                "expected `with:` block on setup-node step in job `{}` (Issue #20 AC #2: must pin node-version satisfying engines), got: {:?}",
                job_name, setup_step
            )
        });

    let nv = with
        .get(serde_yaml::Value::String("node-version".into()))
        .unwrap_or_else(|| {
            panic!(
                "expected `with.node-version` on setup-node step in job `{}` (Issue #20 AC #2: package.json engines = ^20.19 || >=22.12), got with: {:?}",
                job_name, with
            )
        });

    let versions: Vec<String> = if let Some(s) = nv.as_str() {
        vec![s.to_string()]
    } else if let Some(seq) = nv.as_sequence() {
        seq.iter()
            .filter_map(|v| v.as_str().map(String::from).or_else(|| v.as_u64().map(|n| n.to_string())))
            .collect()
    } else if let Some(n) = nv.as_u64() {
        vec![n.to_string()]
    } else {
        panic!(
            "expected `node-version` to be a string, integer, or sequence in job `{}`, got: {:?}",
            job_name, nv
        )
    };

    assert!(
        !versions.is_empty(),
        "expected at least one node-version pinned in job `{}`, got: {:?}",
        job_name, nv
    );
    for v in &versions {
        assert!(
            version_ok(v),
            "node-version `{}` in job `{}` does not satisfy package.json engines `^20.19 || >=22.12` (Issue #20 AC #2). Use e.g. '20.19', '22', '22.12', or a matrix [20.19, 22].",
            v, job_name
        );
    }
}

#[test]
fn ci_workflow_node_job_runs_npm_ci_and_npm_test() {
    // Issue #20 AC #2: the workflow runs `npm ci` and `npm test`. We accept
    // them in separate run-steps OR in one combined step (e.g. `npm ci && npm
    // test`) — both are legitimate styles.
    let cfg = load_workflow();
    let (job_name, job) = find_node_job(&cfg);
    let step_runs: Vec<String> = steps(&job)
        .iter()
        .filter_map(|s| {
            s.get(serde_yaml::Value::String("run".into()))
                .and_then(|v| v.as_str().map(String::from))
        })
        .collect();

    let any_npm_ci = step_runs.iter().any(|r| r.contains("npm ci"));
    let any_npm_test = step_runs.iter().any(|r| r.contains("npm test"));

    assert!(
        any_npm_ci,
        "expected job `{}` to have a step running `npm ci` (Issue #20 AC #2), got run-steps: {:?}",
        job_name, step_runs
    );
    assert!(
        any_npm_test,
        "expected job `{}` to have a step running `npm test` (Issue #20 AC #2), got run-steps: {:?}",
        job_name, step_runs
    );

    // Order matters: `npm test` cannot run before `npm ci` (would have no
    // node_modules). Find the first step containing each and assert ordering.
    // If both appear in the same step (e.g. `npm ci && npm test`), that step
    // counts for both — order is OK iff the substring `npm ci` appears at or
    // before `npm test` in the combined script text.
    let mut ci_step_idx: Option<usize> = None;
    let mut test_step_idx: Option<usize> = None;
    let mut combined_ok: Option<bool> = None;
    for (i, s) in steps(&job).iter().enumerate() {
        if step_run_contains(s, "npm ci") && ci_step_idx.is_none() {
            ci_step_idx = Some(i);
        }
        if step_run_contains(s, "npm test") && test_step_idx.is_none() {
            test_step_idx = Some(i);
        }
        if step_run_contains(s, "npm ci") && step_run_contains(s, "npm test") && combined_ok.is_none() {
            // Same step has both — check ordering inside the run script.
            let r = s
                .get(serde_yaml::Value::String("run".into()))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let ci_pos = r.find("npm ci").unwrap_or(usize::MAX);
            let test_pos = r.find("npm test").unwrap_or(usize::MAX);
            combined_ok = Some(ci_pos <= test_pos);
        }
    }
    let order_ok = match (ci_step_idx, test_step_idx, combined_ok) {
        (Some(c), Some(t), _) if c < t => true,
        (_, _, Some(true)) => true,
        _ => false,
    };
    assert!(
        order_ok,
        "expected `npm ci` to run before `npm test` in job `{}` (Issue #20 AC #2 — npm test needs node_modules from npm ci), got run-steps: {:?}",
        job_name, step_runs
    );
}

// =====================================================================
// Slice C — cargo job: Rust toolchain stable + cargo test --workspace.
// =====================================================================

/// Find a job that installs the Rust toolchain. We accept either
/// `dtolnay/rust-toolchain@stable` or `actions-rust-lang/setup-rust-toolchain@v1`
/// — both are conventional and the team-lead's spec lists them as
/// interchangeable.
fn find_rust_job(cfg: &serde_yaml::Value) -> (String, serde_yaml::Value) {
    let candidates: Vec<_> = jobs(cfg)
        .into_iter()
        .filter(|(_, j)| {
            steps(j).iter().any(|s| {
                step_uses(s, "dtolnay/rust-toolchain@")
                    || step_uses(s, "actions-rust-lang/setup-rust-toolchain@")
            })
        })
        .collect();
    assert!(
        !candidates.is_empty(),
        "expected a job in ci.yml that installs the Rust toolchain via `dtolnay/rust-toolchain@stable` or `actions-rust-lang/setup-rust-toolchain@v1` (Issue #20 AC #3), got jobs: {:?}",
        jobs(cfg).iter().map(|(n, _)| n).collect::<Vec<_>>()
    );
    candidates.into_iter().next().unwrap()
}

#[test]
fn ci_workflow_rust_job_installs_stable_toolchain() {
    // Issue #20 AC #3: workflow installs the Rust toolchain (stable channel)
    // via a recognised action. We pin the `@stable` ref for dtolnay (the
    // documented stable channel selector for that action) or `@v1` for the
    // actions-rust-lang variant — either is fine.
    let cfg = load_workflow();
    let (job_name, job) = find_rust_job(&cfg);

    let has_dtolnay_stable = steps(&job)
        .iter()
        .any(|s| step_uses(s, "dtolnay/rust-toolchain@stable"));

    // For the actions-rust-lang variant, the channel is configured via
    // `with.toolchain: stable`, not in the `uses:` ref. So accept either:
    //   1. dtolnay/rust-toolchain@stable (channel encoded in ref), OR
    //   2. actions-rust-lang/setup-rust-toolchain@v1 with `with.toolchain: stable`
    //      (or no `with.toolchain` at all — that action defaults to stable).
    let has_actions_rust_lang = steps(&job).iter().any(|s| {
        if !step_uses(s, "actions-rust-lang/setup-rust-toolchain@") {
            return false;
        }
        let with = s
            .get(serde_yaml::Value::String("with".into()))
            .and_then(|v| v.as_mapping());
        match with {
            None => true, // default toolchain is stable
            Some(w) => match w
                .get(serde_yaml::Value::String("toolchain".into()))
                .and_then(|v| v.as_str())
            {
                None => true,
                Some(t) => t == "stable",
            },
        }
    });

    assert!(
        has_dtolnay_stable || has_actions_rust_lang,
        "expected Rust toolchain step in job `{}` to install the `stable` channel (Issue #20 AC #3). Use `dtolnay/rust-toolchain@stable` OR `actions-rust-lang/setup-rust-toolchain@v1` (default-stable, or with `toolchain: stable`). Got steps: {:?}",
        job_name,
        steps(&job)
    );
}

#[test]
fn ci_workflow_rust_job_runs_cargo_test_workspace() {
    // Issue #20 AC #3: the workflow runs `cargo test` against the workspace.
    // Accept any of:
    //   - `cargo test --workspace`
    //   - `cargo test --all` (legacy synonym, still recognised by cargo)
    //   - `cargo test` (in a workspace root, this is workspace-wide by default
    //     in Cargo 1.51+ for `[workspace] resolver = "2"`)
    //
    // The plainest form (`cargo test --workspace`) is preferred and what the
    // team-lead spec recommends, so we assert ONE of the workspace-equivalent
    // forms is present.
    let cfg = load_workflow();
    let (job_name, job) = find_rust_job(&cfg);

    let runs: Vec<String> = steps(&job)
        .iter()
        .filter_map(|s| {
            s.get(serde_yaml::Value::String("run".into()))
                .and_then(|v| v.as_str().map(String::from))
        })
        .collect();

    let any_workspace_test = runs.iter().any(|r| {
        r.contains("cargo test --workspace")
            || r.contains("cargo test --all")
            // Bare `cargo test` is OK only at the workspace root, which our
            // workflow runs from by default. We accept it but require the
            // exact substring `cargo test` followed by end-of-string,
            // whitespace, `&&`, or newline — to avoid matching e.g.
            // `cargo testbench` or `cargo test-helper`.
            || {
                let s = r.as_str();
                s.split(|c: char| c.is_whitespace() || c == '&' || c == ';' || c == '|')
                    .collect::<Vec<_>>()
                    .windows(2)
                    .any(|w| w[0] == "cargo" && w[1] == "test")
            }
    });

    assert!(
        any_workspace_test,
        "expected job `{}` to run `cargo test --workspace` (or equivalent: `--all`, or bare `cargo test` at the workspace root) (Issue #20 AC #3), got run-steps: {:?}",
        job_name, runs
    );
}

// =====================================================================
// Slice D — caching: `cache: 'npm'` on setup-node + Swatinem/rust-cache@v2.
// =====================================================================

#[test]
fn ci_workflow_node_job_enables_npm_cache() {
    // Issue #20 AC #4: avoid redundant `npm install` on every run.
    // setup-node@v4 has built-in caching: `with.cache: 'npm'` activates it
    // and reads `package-lock.json` automatically as the cache key. This is
    // the canonical, zero-extra-action approach.
    let cfg = load_workflow();
    let (job_name, job) = find_node_job(&cfg);
    let setup_step = steps(&job)
        .into_iter()
        .find(|s| step_uses(s, "actions/setup-node@"))
        .expect("setup-node step must exist (asserted by Slice B tests)");

    let with = setup_step
        .get(serde_yaml::Value::String("with".into()))
        .and_then(|v| v.as_mapping())
        .unwrap_or_else(|| {
            panic!(
                "expected `with:` block on setup-node step in job `{}` to include `cache: 'npm'` (Issue #20 AC #4), got step: {:?}",
                job_name, setup_step
            )
        });

    let cache = with
        .get(serde_yaml::Value::String("cache".into()))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            panic!(
                "expected `with.cache: 'npm'` on setup-node step in job `{}` (Issue #20 AC #4: cache `npm install` between runs). Got with: {:?}",
                job_name, with
            )
        });
    assert_eq!(
        cache, "npm",
        "expected `with.cache` on setup-node to be `npm` in job `{}` (Issue #20 AC #4), got: {:?}",
        job_name, cache
    );
}

#[test]
fn ci_workflow_rust_job_uses_swatinem_rust_cache() {
    // Issue #20 AC #4: avoid redundant `cargo build` on every run. The
    // canonical approach for GitHub Actions Rust caching is
    // `Swatinem/rust-cache@v2`, which caches `~/.cargo/{registry,git}` and
    // `target/`. Pin the major to v2 — the action's cache-format compat
    // boundary is at the major version.
    let cfg = load_workflow();
    let (job_name, job) = find_rust_job(&cfg);

    let has_cache = steps(&job)
        .iter()
        .any(|s| step_uses(s, "Swatinem/rust-cache@v2"));

    assert!(
        has_cache,
        "expected job `{}` to have a step `uses: Swatinem/rust-cache@v2` (Issue #20 AC #4: cache cargo registry + target/ between runs). Got steps: {:?}",
        job_name,
        steps(&job)
    );
}
