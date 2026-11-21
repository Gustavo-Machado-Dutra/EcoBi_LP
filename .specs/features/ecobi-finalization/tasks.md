# EcoBI Finalization Tasks

## Execution Protocol

Implement this approved feature according to `.specs/features/ecobi-finalization/spec.md` and `design.md`. User approval covers the remaining implementation tasks as of 2026-11-19. Preserve existing working-tree changes. One task per commit where `.git` permits; never bypass read-only Git permissions. If a commit is blocked, record the task and evidence without committing. A fresh independent verifier is required after implementation; if no independent session/tool is available, record that limitation rather than self-approving.

**Design**: `.specs/features/ecobi-finalization/design.md`
**Status**: Complete — code, live runtime (`qwen3.5:4b`), 12-module browser UAT, 4-direction visual audit (`36882d0`, `29de035`), and TLC 4.1.0 verification closed on `main` (no push)

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines: `AGENTS.md`, `README.md`; existing tests use Pytest integration/service patterns in `tests/`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Python service/domain | unit | Map every specified branch and edge case to ACs; include failure behavior | `tests/test_*.py` | `\.venv\Scripts\python.exe -m pytest tests/<target>.py -q` |
| FastAPI/controller and local persistence | integration | In-scope routes, success, invalid input, persistence, errors, audit and isolated DB | `tests/test_*.py` | `\.venv\Scripts\python.exe -m pytest tests/<target>.py -q` |
| Vanilla JS onboarding | unit/DOM | First run, defer, skip/version, navigation, close, missing target, keyboard, no business side effects | `tests/frontend/` if supported, otherwise documented Node DOM harness | `node --test <target>` |
| Windows launcher/bootstrap | integration | clean/repeat setup, local bind, failure/fallback, no global mutation, safe shutdown | `tests/test_*launcher*.py` and PowerShell parser | `\.venv\Scripts\python.exe -m pytest tests/<target>.py -q`; PowerShell AST parse |
| Packaging/configuration | build | resource inclusion and launch configuration; no schema/network exposure regression | `ecobi.spec`, package test | `\.venv\Scripts\python.exe -m PyInstaller ecobi.spec --noconfirm` only if safe and dependencies available |
| Evidence/docs | structural | all requirement IDs classified with exact evidence type and JSON valid | `.specs/features/ecobi-finalization/`, root docs | TLC validators; JSON parse |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Focused unit/frontend tests | `node --check frontend/app.js`; target Pytest under `.codex-tmp` |
| Full | Integration or phase completion | `$env:TEMP="$PWD\.codex-tmp"; $env:TMP=$env:TEMP; $env:TMPDIR=$env:TEMP; .\.venv\Scripts\python.exe -m pytest -q` |
| Build | Final | `.venv` compileall; full Pytest; Node syntax; PowerShell AST; JSON parse; spec/task/verification validators; `git diff --check` |

Every test run must set `TEMP`, `TMP`, `TMPDIR` and pytest basetemp to workspace `.codex-tmp`. Use a disposable test DB and assert the real DB was not touched. Do not run PyInstaller if it would overwrite an existing user artifact; first use an isolated dist/work directory.

## Execution Plan

Phases are sequential; tasks within each phase execute in listed order.

### Phase 1: Isolated bootstrap and startup

`T1 → T2 → T3`

### Phase 2: Onboarding controller and shell integration

`T4 → T5 → T6`

### Phase 3: Functional closure and evidence

`T7 → T8 → T9`

## Task Breakdown

### T1: Isolate launcher environment and protect test database

**Status**: Complete — commit `d8d726b` (`fix(launcher): keep check-only from initializing SQLite`). Current verification: `pytest tests/test_phase4_packaging_scheduler_multiproject.py::test_c21_windows_launcher_and_bootstrap_lifecycle -q` — 1 passed, one Starlette/httpx deprecation warning. Operational DB observation is existence/mtime/size only.

**What**: Refactor environment resolution so check-only and tests honor explicitly isolated DB/temp paths and cannot silently redirect test setup to the repository DB.
**Where**: `scripts/ecobi_launcher.py`, focused launcher tests.
**Depends on**: None
**Reuses**: Existing `ensure_environment()`, `ECOBI_DB_PATH`, `.codex-tmp`.
**Requirement**: SET-02, SET-09, FIN-03, FIN-04
**Done when**: an isolated launcher subprocess uses a disposable root; check-only does not create a missing DB and preserves an existing SQLite canary byte-for-byte; separate operational-database observations remain explicitly limited to existence/mtime/size; normal startup remains stable.
**Tests**: integration
**Gate**: full

### T2: Implement idempotent local Windows bootstrap and fallback

**Status**: Partial — implementation commit `5b6186b` (`feat(bootstrap): prepare local Ollama runtime safely`) and readiness regression commit `75b3eb8` (`test(bootstrap): cover local Ollama readiness`). Current checks: 17 passed across frontend/bootstrap/root-launcher tests; targeted readiness rerun 5 passed; scheduler/multiproject suite 11 passed. Each Pytest run had one Starlette/httpx deprecation warning. Harnesses are isolated; no real installer/model download or live inference was run, so operational approval remains partial.

**What**: Add testable local setup for project `.venv`, declared Python requirements, Ollama/model presence, and deterministic fallback without global changes.
**Where**: `scripts/ecobi_launcher.py`, launcher tests.
**Depends on**: T1
**Reuses**: existing runtime config, `BLOCK_EXTERNAL_AI`, local Ollama allowlist, existing install guidance.
**Requirement**: SET-02 through SET-08
**Done when**: missing resources are handled once via mocked local commands; repeat startup is idempotent; failures are actionable; no global PATH/registry/firewall/Ollama edits or elevation; external AI remains blocked.
**Tests**: integration
**Gate**: full

### T3: Add root one-command PowerShell entry point

**Status**: Partial — root wrapper executed from an isolated copied project root; the real launcher served health and current UI assets over loopback and the isolated SQLite checks passed. A fresh clone with absent dependencies was not tested; Ctrl-Break caused PowerShell to display a debugger prompt at wrapper return despite exit 0.

**What**: Provide `start.ps1` as a small compatibility wrapper to the existing supported launcher.
**Where**: `start.ps1`, launcher tests/docs.
**Depends on**: T2
**Reuses**: `scripts/start_ecobi.ps1` and current command-line contract.
**Requirement**: SET-01, SET-07, SET-09
**Done when**: root invocation reaches the real launcher, preserves local-only bind, returns setup/server failure accurately, and parses on Windows PowerShell without admin.
**Tests**: integration
**Gate**: full

### T4: Create isolated onboarding controller

**Status**: Partial — implementation commit `406c3e6` (`feat(onboarding): add contextual spotlight tours`). Current evidence: `node --test tests/frontend/onboarding.test.cjs` — 7 passed; related frontend integration tests passed in the 17-test run. Simulated DOM only; browser interaction and visual rendering remain unverified.

**What**: Implement versioned local onboarding state, introduction, defer/skip/finish/close and real-target tour orchestration.
**Where**: `frontend/onboarding.js`, onboarding tests.
**Depends on**: None
**Reuses**: real `data-view` navigation and browser localStorage.
**Requirement**: ONB-01 through ONB-08, ONB-12 through ONB-15
**Done when**: controller handles first run, defer/reopen, versioned skip, manual replay, missing target, close-in-place and keyboard actions without business side effects or sensitive storage.
**Tests**: unit/DOM
**Gate**: quick

### T5: Integrate onboarding with actual application shell and navigation

**Status**: Partial — shell integration is included in `406c3e6`; related frontend integration tests passed (2 tests, included in the 17-test run). Browser navigation remains unverified.

**What**: Add accessible permanent help entry points and connect controller to startup/view navigation without changing business actions.
**Where**: `frontend/index.html`, `frontend/app.js`, frontend tests.
**Depends on**: T4
**Reuses**: existing nav controls, view switcher, startup and session lifecycle.
**Requirement**: ONB-02 through ONB-11, ONB-12 through ONB-15
**Done when**: introduction does not conflict with session/UI overlays; general and all twelve contextual guides use real visible module content; next/back/navigation/close work; loading tour creates no DB/audit/business operation.
**Tests**: unit/DOM and integration
**Gate**: full

### T6: Style onboarding and verify responsive/accessibility behavior

**Status**: Partial — style/controller implementation is included in `406c3e6`; simulated geometry and keyboard checks pass in the 7-test Node suite. Real browser/device/theme/accessibility visual matrix remains blocked.

**What**: Add scoped Modern Green spotlight/dialog styles with keyboard focus, reduced-motion, theme and responsive handling.
**Where**: `frontend/styles.css`, frontend visual/DOM tests.
**Depends on**: T5
**Reuses**: current design tokens and theme attributes.
**Requirement**: ONB-09 through ONB-13
**Done when**: targets remain visible and navigable at 390×844, 768×1024, 1280×800, 1440×900 in light/dark; focus and reduced-motion behavior are verified. If real browser approval is denied, record visual verification blocked and do not claim pass.
**Tests**: unit/DOM and browser e2e where available
**Gate**: full

### T7: Add isolated integration coverage for module flows

**Status**: Partial — implementation/regression commit `505e970` (`fix(analytics): preserve uploads and verify persisted workflows`). Current targeted runs: 12 tests across data-quality/API/assistant/Power BI files and 11 scheduler/multiproject tests passed; each run had one Starlette/httpx deprecation warning. Evidence uses isolated synthetic data; browser journeys, crash recovery, real Ollama and corporate integrations remain unverified.

**What**: Extend tests only where current tests do not prove the specified functional contract, using synthetic fixtures and disposable SQLite/files.
**Where**: `tests/` by existing module test patterns.
**Depends on**: T1
**Reuses**: current analytics, import, quality, validation, Power BI, scheduler, multiproject, security and persistence tests.
**Requirement**: MOD-01 through MOD-13, FIN-02 through FIN-06
**Done when**: requirement-by-requirement results cover persisted input/output, failure paths and audit where specified; corporate/live integrations are explicitly separated as not run; existing Power BI dedup and quality overflow regressions remain asserted.
**Tests**: integration
**Gate**: full

### T8: Produce current requirement matrix and verification artifacts

**Status**: Partial - requirement evidence and the independent C1-C21 review are recorded; current proof and structural reruns are complete. Clean committed-HEAD traceability and environment-dependent evidence remain unavailable.

**What**: Record each requirement, test, status, evidence and commit status; update project docs without rewriting unrelated historical approvals.
**Where**: `.specs/features/ecobi-finalization/{spec,tasks,proofs,requirement-matrix,verification}.md`, `.specs/STATE.md`, `PLAN.md`, `README.md`, `audit-results.json`.
**Depends on**: T3, T6, T7
**Reuses**: active specs and current test outputs.
**Requirement**: FIN-01, DOC-01 through DOC-07
**Done when**: matrix uses only defined states, all requirements are classified, evidence types are differentiated, historical results remain historical and current limitations are explicit; valid JSON and TLC structure.
**Tests**: structural
**Gate**: build

### T9: Final regression, real-browser UAT and independent verification

**Status**: Blocked — six local commits now exist on `main` above `origin/main` at `9e7513b`; no push was made. `check_proofs.py` has not been rerun at `d8d726b`. Current `validate_verification.py` reports 6 errors: proofs HEAD mismatch, dirty worktree, and the four unresolved findings (browser UAT, real installer/live Ollama, discrimination sensor). No full-suite result is claimed for this continuation.
- [x] Complete authorized browser/Ollama/E2E validation and independent verification (findings closed in `fba5520`, visual audit fixes in `36882d0` and `29de035`).

**What**: Run complete gates, inspect real application where authorized, review risks adversarially and close or document remaining blockers.
**Where**: test suite, browser evidence, `.specs/features/ecobi-finalization/verification.md`, `tasks.md`, `STATE.md`.
**Depends on**: T8
**Reuses**: real local application and isolated test artifacts.
**Requirement**: all specification requirements and success criteria
**Done when**: complete current evidence is reported; all available gates pass; unavailable browser/tool/hardware integrations remain partial/blocked; independent fresh-eyes verifier is recorded. No Git commit unless `.git` becomes writable through normal authorized means.
**Tests**: full integration/e2e
**Gate**: build

## Requirement Traceability

| Requirements | Task |
| --- | --- |
| FIN-01–FIN-06 | T1, T7, T8, T9 |
| MOD-01–MOD-13 | T7, T9 |
| ONB-01–ONB-15 | T4, T5, T6 |
| SET-01–SET-10 | T1, T2, T3, T9 |
| DOC-01–DOC-07 | T8, T9 |

## Checks

**Build**: `node --check frontend/app.js`; `node --check frontend/onboarding.js`; `.venv/Scripts/python.exe -m compileall -q backend scripts`; `.venv/Scripts/python.exe -m json.tool audit-results.json > /dev/null`; `git diff --check`

**Run launcher**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-launcher tests/test_phase4_packaging_scheduler_multiproject.py -k c21`

**Run root-launcher**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-root-launcher tests/test_root_launcher.py`

**Run launcher-bind**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-launcher-bind tests/test_local_network_security.py -k launcher_rejects_network_bind_hosts`

**Run ollama-bootstrap**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/ollama-bootstrap tests/test_ollama_bootstrap.py`

**Run local-ai**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-ai tests/test_phase4_packaging_scheduler_multiproject.py -k c25`

**Run flows**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-flows tests/test_phase4_packaging_scheduler_multiproject.py tests/test_data_quality.py tests/test_analytics_financial_esg.py tests/test_llm_tool_calling.py tests/test_predictive_backtesting.py tests/test_simulation.py tests/test_validation_engine.py tests/test_powerbi_generator.py tests/test_security_memory_api.py`

**Run api-e2e**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-api-e2e tests/test_finalization_e2e.py`

**Run onboarding**: `node --test tests/frontend/onboarding.test.cjs`

**Run shell**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-shell tests/test_finalization_frontend.py`

**Run quality**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-quality tests/test_quality_overflow.py tests/test_powerbi_generator.py`

**Run reupload-collision**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-reupload-collision tests/test_data_quality.py -k concurrent_same_filename_ingests_use_distinct_storage_paths`

**Run resilience**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-resilience tests/test_resilience_recovery.py`

**Run suite**: `TEMP="$PWD/.codex-tmp" TMP="$PWD/.codex-tmp" TMPDIR="$PWD/.codex-tmp" .venv/Scripts/python.exe -m pytest -vv --basetemp=.codex-tmp/tlc-suite`

**C1** - Isolated launcher check-only preserves missing-DB absence and existing SQLite-canary bytes; unsafe bind is rejected (SET-01, SET-09). Operational DB observation is metadata-only.
Proof: run launcher | test_c21_windows_launcher_and_bootstrap_lifecycle PASSED
Proof: run root-launcher | test_root_start_script_reaches_launcher_in_isolated_project_root PASSED
Proof: run launcher-bind | test_launcher_rejects_network_bind_hosts_before_startup PASSED

**C2** - Ollama readiness is constrained to the local allowlist and unavailable/model-missing paths keep external AI blocked with deterministic fallback (SET-03, SET-04, SET-06)
Proof: run local-ai | 5 passed
Proof: run ollama-bootstrap | 21 passed

**C3** - Scheduled connector runs persist exact initial and incremental rows, skip an overlapping execution while connector I/O is blocked, honor active connector locks, and record job-specific statuses and processed counts in execution history (MOD-13, FIN-03)
Proof: run flows | test_c22_scheduled_connector_sync_and_concurrency_lock PASSED

**C4** - Scheduled backups enforce age/count retention including physical file and metadata deletion, and trial restore leaves operational project, dataset, analysis, and audit rows unchanged (FIN-04)
Proof: run flows | test_c23_scheduled_hmac_backup_retention_and_restore_trial PASSED

**C5** - Multiproject aggregates persisted projects and returns 403 for unknown project IDs (MOD-12)
Proof: run flows | test_c24_multiproject_dashboard_consolidation_and_rbac PASSED

**C6** - Onboarding definitions cover all twelve modules, state excludes unrelated fields, and welcome welcome navigation remains non-trapping and modal help focus is restored on Escape (ONB-10, ONB-13, ONB-15)
Proof: run onboarding | contextual guides cover all twelve existing views
Proof: run onboarding | stored onboarding preferences are versioned and non-sensitive
Proof: run onboarding | welcome and tour preserve non-modal keyboard navigation while help remains modal

**C7** - Real application shell serves the navbar/sidebar help controls and local controller asset, and quick demo session enforces the analyst role (ONB-11, MOD-02)
Proof: run shell | test_application_shell_loads_onboarding_controller PASSED
Proof: run shell | test_onboarding_controller_is_served_as_local_static_asset PASSED
Proof: run shell | test_quick_demo_session_uses_analyst_role PASSED

**C8** - Malformed uploads are rejected and canonical mappings persist and reapply (MOD-03, MOD-04)
Proof: run flows | test_corrupted_file_rejected_cleanly PASSED
Proof: run flows | test_canonical_mapping_save_and_reapply PASSED

**C9** - What-If simulation separates scenario output and rejects invalid bounds (MOD-08)
Proof: run flows | test_simulation_outputs_separated_and_bounds_validated PASSED

**C10** - Session, consent, role and LGPD purge paths keep their defined API behavior (MOD-02, MOD-11)
Proof: run flows | test_auth_session_lgpd_consent_and_401 PASSED
Proof: run flows | test_pii_masking_and_lgpd_cascade_purge PASSED

**C11** - Static Quality label markup remains inside its internal scroll context; Power BI removes repeated analysis exports by source-row identity while preserving genuine duplicate-period rows and per-period revenue reconciliation (MOD-04, MOD-10)
Proof: run quality | test_quality_mapping_table_keeps_accessible_labels_inside_scrollport PASSED
Proof: run quality | test_pbip_deduplicates_repeated_analyses_preserving_source_period_rows PASSED

**C12** - Uploaded QA dataset produces deterministic financial and ESG results (MOD-05)
Proof: run flows | test_financial_esg_deterministic_and_credit_separation PASSED

**C13** - Assistant API returns response/tool metadata for an uploaded dataset and reports one of its supported execution modes (MOD-06)
Proof: run flows | test_assistant_api_endpoint PASSED

**C14** - Predictive service enforces chronological split and insufficient-history behavior (MOD-07)
Proof: run flows | test_temporal_split_and_insufficient_history PASSED

**C15** - Validation blocks export when the analysis is not eligible (MOD-09)
Proof: run flows | test_rejected_analysis_blocks_powerbi_generation PASSED

**C16** - Eligible financial and predictive results create a reconciled Power BI artifact with aligned DAX table bindings and M header promotion (MOD-10)
Proof: run flows | test_pbip_pbir_generation_and_reconciliation PASSED
Proof: run quality | test_pbip_queryrefs_match_model_tables_and_m_promotes_headers PASSED

**C17** - Persisted due jobs run once and update the next execution/status (MOD-13)
Proof: run flows | test_scheduler_dispatches_persisted_due_job_once PASSED

**C18** - Current automated Pytest suite completes (FIN-01)
Proof: run suite | 93 passed

**C19** - General tour supports back/next/skip/close/complete, routes only to documented views, and preserves the last view. Its integration harness invokes production `switchView`, confirms only GET requests, and confirms no project/dataset storage changes (ONB-05, ONB-09)
Proof: run onboarding | general tour controls navigate only existing views, issue no controller-owned fetches, and persist completion
Proof: run onboarding | general tour uses real navigation without business writes or project changes

**C20** - API E2E persists project and dataset, profiles quality, runs financial/predictive/What-If analyses, verifies dashboard aggregation and validation, exports a valid downloadable Power BI artifact with revenue reconciliation, and checks audit events (MOD-01, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10, MOD-11)
Proof: run api-e2e | test_api_journey_persists_project_import_quality_analysis_validation_and_powerbi PASSED

**C21** - Sequential and simultaneous same-name uploads reserve distinct storage paths; a later rejected upload preserves prior files and database records (MOD-03, FIN-03)
Proof: run api-e2e | test_failed_reupload_with_existing_filename_preserves_dataset_file PASSED
Proof: run reupload-collision | test_concurrent_same_filename_ingests_use_distinct_storage_paths PASSED

**C22** - Small uploads succeed under tight host RAM and return HTTP 503 with clean file and database rollback when memory is genuinely exhausted (MOD-03, FIN-03, FIN-06)
Proof: run api-e2e | test_upload_under_tight_host_ram_and_clean_rollback_when_exhausted PASSED

**C23** - Root `start.ps1` supports Python 3.11+ discovery, starts the live loopback server with onboarding assets, shuts down cleanly, and leaves SQLite WAL/FK integrity intact (SET-01, SET-02, SET-09)
Proof: run root-launcher | test_start_ecobi_accepts_python_3_11_plus_and_checks_declared_imports PASSED
Proof: run root-launcher | test_root_start_script_serves_health_and_onboarding_then_shuts_down_cleanly PASSED

**C24** - Launcher handles occupied ports, avoids duplicate EcoBI instances, fails safely on corrupted/locked SQLite, verifies full HTTP readiness, ignores corporate HTTP proxy for local Ollama, and protects XLSX/PostgreSQL connectors (SET-01, SET-06, SET-09, FIN-03, FIN-05)
Proof: run resilience | 7 passed

## Approval

**Approved**: 2026-11-19 - user: "aprovado"
**Approved**: 2026-11-19 - user: "aprovo todas as pendencias que houver"

The user approved the recommended architecture and then explicitly approved all remaining pending items. This task list is therefore authorized for local implementation and tests. External, destructive, global Windows, network, push, and permission-changing actions remain prohibited by the specification.
- Latest T9 gates (2026-11-19): full suite 68 passed; TLC proof runner 28/0; verification validator still fails only on uncommitted proofs. Browser UAT, live Ollama, complete browser E2E, and committed HEAD remain blockers.
- Current package runtime smoke (2026-11-19): fresh PyInstaller 6.22.3 output in `.codex-tmp/finalization-dist-recheck` served `/api/health`, `/`, and `/static/onboarding.js` with HTTP 200 on `127.0.0.1:18083`; onboarding selectors matched the current build; Ollama setup was explicitly declined to avoid installation, fallback kept external AI blocked, Ctrl-Break exited 0, and temporary SQLite integrity/WAL/FK checks passed. This is not an installer-clean-room or live-Ollama test.

### Continuation record — 2026-11-20

- `tests/test_root_launcher.py`: 1 passed independently; root PowerShell check-only and runtime smoke had already been executed in the isolated copy described in verification evidence.
- `tests/frontend/onboarding.test.cjs`: 6 passed after adding ONB-05/ONB-09 interaction coverage; no fetch/API calls, module IDs constrained to existing views, last view preserved, and general progress retained across contextual-guide completion.
- Full Pytest: 69 passed, one deprecation warning, 293.52 seconds. E2E evidence remains test-environment/synthetic; it is not corporate-source or live-service evidence.
- Scoped independent review completed. One suspected contextual-progress defect was not reproducible because contextual guides are currently single-step; the matrix and verification record distinguish partial automated coverage from missing browser evidence.
- T9 remains blocked by unavailable authorized browser validation, absent Ollama for real inference, clean installer-first-run evidence, and TLC's clean committed-HEAD requirement.

### Final gate outcome — 2026-11-20

- `check_proofs.py`: **30 pass / 0 fail**, including root launcher and unsafe-bind targeted proofs, onboarding Node harness, all documented automated flows, full suite, and build checks; exit remains 1 because Git tree is dirty.
- Latest embedded full Pytest: **69 passed**, one deprecation warning, 268.91 s. Standalone current full-suite run: 69 passed, one warning, 293.52 s.
- `validate_spec.py --strict`: 0/0; `validate_tasks.py --execute`: 0 errors / 4 advisory warnings; `validate_verification.py`: one dirty-tree error only after adding C19 row.
- T9 remains **Blocked**: no authorized browser evidence, live Ollama, clean installer-first-run, dedicated criterion-level verifier PASS or clean committed HEAD. Do not mark complete or commit through read-only Git.

### Latest C20/TLC evidence — 2026-11-20

- C20 `tests/test_finalization_e2e.py`: **1 passed** (focused rerun 9.82 s), isolated TestClient/SQLite and synthetic sample file. The journey asserts project/upload/profile, local assistant mode, financial/predictive/What-If analyses, persistence, dashboard aggregation, export status/structure, revenue reconciliation, download and audit.
- C3 `test_c22_scheduled_connector_sync_and_concurrency_lock`: **1 passed** (focused rerun 9.76 s), with a blocked first connector call, overlapping second service invocation returning `SKIPPED_LOCKED`, and explicit active connector-lock coverage.
- Final `check_proofs.py`: **31 pass / 0 fail**; embedded full suite **70 passed**, 1 warning, **252.06 s**. Exit 1 only because the worktree is dirty and evidence is not at a clean committed HEAD.
- `validate_verification.py`: one error remains, specifically proofs ran on uncommitted changes. Spec strict: 0 errors/0 warnings; task execute: 0 errors/4 advisories. JSON, Node syntax, Python compile, PowerShell parsing, and `git diff --check` pass.
- Dashboard UI and all browser-dependent module journeys remain unverified; do not overstate the API E2E as visual or real-source approval.

### Final independent review — 2026-11-20

- A fresh reviewer inspected all C1–C20 checks and returned **FAIL to certify finalization**, with no critical defect confirmed. It independently ran only `node --test tests/frontend/onboarding.test.cjs` (6 passed); it did not rerun Pytest or `check_proofs.py`.
- C3's pre-seeded-lock-only coverage was replaced by a controlled overlapping service execution; C20 now asserts the returned revenue reconciliation. Both focused tests and the complete TLC proof suite pass.
- C1 wording is limited to the existing existence/mtime/size check; no content hash is claimed. Browser UAT, real Ollama installation/model/inference, clean installer-first-run and clean committed HEAD remain pending. No commit or permission workaround was attempted.


## Handoff

**Settled mid-build:** User provided official TLC 4.1.0 skill path `C:\Users\Pichau\.agents\skills\tlc-spec-driven\SKILL.md`, approved the definitive closure Implementation Plan (T10–T17), and confirmed mandatory onboarding spotlight/tooltip layout rules (dimmed backdrop, real unshaded cutout, 4-direction non-overlapping tooltip, fixed height, zero vertical scroll, single-row footer).
**Dispatched:** Independent Verifier (`db99c4ba-e53d-4b13-9e01-961dbed2cb88`) dispatched at clean HEAD `acc416c` (`39 pass, 0 fail`) -> `returned` with 2 findings (`normalizeState` null JSON literal + C7 asset proof binding), both closed in `fba5520`.
**Walked:** Real Google Chrome CDP walks against isolated Uvicorn (`127.0.0.1:18092` and `18093`, disposable SQLite under `.codex-tmp`, `realDbUntouched=true`) exercised: (1) first-run welcome, defer+reload, dismiss+reload, and navbar/sidebar permanent help modal (including `?` mid-tour overlay closing and Escape restoration); (2) all 12 modules + scheduler end-to-end with `samples/ecobi_varejo_piloto.csv`, live local Ollama `qwen3.5:4b`, and clean `390x844` Quality view (`backdropDisplay="none"`, `overflowFree=true`); (3) all 18 general tour steps (5 chapters: `Visão Geral`, `Dados`, `Análises & IA`, `Governança`, `Operação`), all 28 contextual steps across the 12 UI views (46 steps total) in both Light and Dark, and forced 4-direction checks (`bottom`, `top`, `right`, `left`, plus safe fallback on narrow `390px`), `ARROW_EDGE_PAD=28` corner clearance, DOM `hidden` attribute toggle on `SVGElement` backdrop, and 1-line missing-target recovery across `1440x900`, `1280x800`, `768x1024`, `390x844` × Light/Dark with 0 findings (`onboarding-visual-audit.json`) and inspected PNGs under `.specs/features/ecobi-finalization/evidence/`.

- Feature: `ecobi-finalization`
- Phase / Task: Execute / Complete (`T10`–`T17` + independent visual audit closure at `36882d0` and `29de035`)
- Completed commits: `5b6186b`, `406c3e6`, `505e970`, `75b3eb8`, `d8d726b`, `1f2b7b2`, `dafb016` (T10), `3f3d5fd` (T11), `943129d` (T12), `d86a251` (T13), `12d7663` (T14), `6fe8b21` (UI fix), `af4f65c` (T15), `acc416c` (T16), `fba5520` (Verifier fixes), `ac78486`, `51e6df8`, `36882d0`, `29de035`
- Branch: `main` (local atomic commits only; no `git push`)