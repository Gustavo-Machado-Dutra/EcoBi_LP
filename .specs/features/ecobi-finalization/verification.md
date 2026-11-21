# ecobi-finalization verification

**Verdict**: PASS (initial verifier round at `acc416c`; visual audit closed through `29de035`/`1c1f6e1`; final Windows installation, Power BI, resilience, and 17-step Chrome E2E extension verified in same-session execution through `f841ffa` — see notes below)
**Proofs**: `proofs.md` regenerated at clean `HEAD` after closure fixes
**Verifier**: independent sub-agent (author != verifier) at `acc416c` + independent real-Chrome visual audit at `36882d0` / `29de035`; post-`96da3cd` extension checks (`51484da`..`f841ffa`) executed and verified within the same session (no separate sub-agent spawned per `AGENTS.md` §4.5)

## Checks

| Check | Test | Holds |
| --- | --- | --- |
| C1 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_c21_windows_launcher_and_bootstrap_lifecycle`; `tests/test_root_launcher.py` `test_root_start_script_reaches_launcher_in_isolated_project_root`; `tests/test_local_network_security.py` `test_launcher_rejects_network_bind_hosts_before_startup` | yes |
| C2 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_c25_*` (5 tests); `tests/test_ollama_bootstrap.py` (21 tests) | yes |
| C3 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_c22_scheduled_connector_sync_and_concurrency_lock` | yes |
| C4 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_c23_scheduled_hmac_backup_retention_and_restore_trial` | yes |
| C5 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_c24_multiproject_dashboard_consolidation_and_rbac` | yes |
| C6 | `tests/frontend/onboarding.test.cjs` `contextual guides cover all twelve existing views`, `stored onboarding preferences are versioned and non-sensitive`, `welcome and tour preserve non-modal keyboard navigation while help remains modal` | yes |
| C7 | `tests/test_finalization_frontend.py` `test_application_shell_loads_onboarding_controller`, `test_onboarding_controller_is_served_as_local_static_asset`, `test_quick_demo_session_uses_analyst_role` | yes |
| C8 | `tests/test_data_quality.py` `test_corrupted_file_rejected_cleanly`, `test_canonical_mapping_save_and_reapply` | yes |
| C9 | `tests/test_simulation.py` `test_simulation_outputs_separated_and_bounds_validated` | yes |
| C10 | `tests/test_security_memory_api.py` `test_auth_session_lgpd_consent_and_401`, `test_pii_masking_and_lgpd_cascade_purge` | yes |
| C11 | `tests/test_quality_overflow.py` `test_quality_mapping_table_keeps_accessible_labels_inside_scrollport`; `tests/test_powerbi_generator.py` `test_pbip_deduplicates_repeated_analyses_preserving_source_period_rows` | yes |
| C12 | `tests/test_analytics_financial_esg.py` `test_financial_esg_deterministic_and_credit_separation` | yes |
| C13 | `tests/test_llm_tool_calling.py` `test_assistant_api_endpoint` | yes |
| C14 | `tests/test_predictive_backtesting.py` `test_temporal_split_and_insufficient_history` | yes |
| C15 | `tests/test_validation_engine.py` `test_rejected_analysis_blocks_powerbi_generation` | yes |
| C16 | `tests/test_powerbi_generator.py` `test_pbip_pbir_generation_and_reconciliation`, `test_pbip_queryrefs_match_model_tables_and_m_promotes_headers` | yes |
| C17 | `tests/test_phase4_packaging_scheduler_multiproject.py` `test_scheduler_dispatches_persisted_due_job_once` | yes |
| C18 | `Run suite` (`pytest -vv`, 93 passed) | yes |
| C19 | `tests/frontend/onboarding.test.cjs` `general tour controls navigate only existing views, issue no controller-owned fetches, and persist completion`, `general tour uses real navigation without business writes or project changes` | yes |
| C20 | `tests/test_finalization_e2e.py` `test_api_journey_persists_project_import_quality_analysis_validation_and_powerbi` | yes |
| C21 | `tests/test_finalization_e2e.py` `test_failed_reupload_with_existing_filename_preserves_dataset_file`; `tests/test_data_quality.py` `test_concurrent_same_filename_ingests_use_distinct_storage_paths` | yes |
| C22 | `tests/test_finalization_e2e.py` `test_upload_under_tight_host_ram_and_clean_rollback_when_exhausted` | yes |
| C23 | `tests/test_root_launcher.py` `test_start_ecobi_accepts_python_3_11_plus_and_checks_declared_imports`, `test_root_start_script_serves_health_and_onboarding_then_shuts_down_cleanly` | yes |
| C24 | `tests/test_resilience_recovery.py` (7 tests covering occupied port, duplicate EcoBI launch, corrupted/locked SQLite, HTTP readiness `/api/health` + `/`, Ollama 500 fallback + `trust_env=False`, XLSX watched dir & PostgreSQL credential redaction) | yes |

## Findings

| Finding | Evidence | Fix | Closed |
| --- | --- | --- | --- |
| `normalizeState` crashes with an uncaught `TypeError` when `localStorage["ecobi.onboarding.v1"]` contains the valid JSON literal `"null"`, breaking onboarding startup instead of resetting invalid state | `frontend/onboarding.js:102-111` | Guard `normalizeState` so non-object, `null`, or array JSON falls back to `{}` and assert `"null"`, `"[]"`, and `"42"` reset to default state in `tests/frontend/onboarding.test.cjs` | `fba5520` (C6) |
| C7's selected proof does not fail if `/static/onboarding.js` is not served | `tasks.md:230-231` | Add `test_onboarding_controller_is_served_as_local_static_asset PASSED` proof under `run shell` to C7 in `tasks.md` | `fba5520` (C7) |
| Hidden SVG backdrop dimmed non-tour screens on `display: block`, `openHelp()` left tour overlays behind chooser, `ARROW_EDGE_PAD=22` overhung `18px` rounded corners, and 78-char recovery copy clipped inside fixed `228px` panel | Chrome visual audit (`onboarding-visual-audit.json` + `probe_390.mjs`) | Add `[hidden] { display: none !important; }` CSS rule, set `ARROW_EDGE_PAD = 28`, close active tour in `openHelp()`, guard `renderCurrent()` `rAF`, shorten recovery copy, toggle SVG DOM `hidden` attribute | `36882d0`, `29de035` (C6, C7) |
| `ollama_bootstrap.ps1` failed closed before `StartServer` when port 11434 had no listener (`Get-NetTCPConnection -LocalPort 11434 -ErrorAction Stop` throws `ObjectNotFound`), lacked disk/HTTP API checks, and `ecobi_launcher.py` lacked duplicate-instance/corrupt-DB/readiness guards | `scripts/ollama_bootstrap.ps1:56`, `scripts/ecobi_launcher.py` | Filter `Where-Object { $_.LocalPort -eq 11434 }`, add disk-space & `/api/tags` probes, `-AutoApprove`, duplicate-instance/occupied-port/SQLite error guards, `wait_for_readiness`, `start.bat`, and `trust_env=False` | `51484da`, `39a700f` (C2, C24) |
| `start_ecobi.ps1` threw `NativeCommandError` in Windows PowerShell 5.1 on a clean clone when `python -c "import ..."` wrote `ModuleNotFoundError` to stderr under `$ErrorActionPreference = "Stop"` | Clean-clone test in `.codex-tmp/clean-install-test` (`task-190`) | Set `$ErrorActionPreference = "Continue"` around native commands with explicit `$LASTEXITCODE` checks and non-stderr import probe | `c895362` (C1, C23) |
| Power BI `model.bim` placed predictive/simulation DAX measures on `FactOperacoesMensais` while `report.json` queried `FactPrevisoes`/`FactSimulacoes`, report sections were misaligned with display names, and M partitions lacked `Table.PromoteHeaders` and `PastaDados` parameter | `backend/services/powerbi_generator.py` inspection | Attach DAX measures to their target tables, align 4 report sections, add `PastaDados` M parameter + `Table.PromoteHeaders`, add cross-table `queryRef` validation in `validate_pbip_bundle`, and test opening in Power BI Desktop `2.159.1231.0` | `af3c4c1` (C16) |
| Clicking `#btn-quick-demo-session` ("Sessão Rápida Demo Local") sent `role: "admin"`, causing HTTP 422 against `SessionCreateRequest` (`Literal["analyst"]`) in real Chrome E2E | Real Chrome Phase 1 run (`task-240`) | Update `frontend/app.js:3010-3012` to send `"analyst"` and add regression `test_quick_demo_session_uses_analyst_role` | `f841ffa` (C7) |
