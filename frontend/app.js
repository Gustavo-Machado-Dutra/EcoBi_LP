/**
 * EcoBI Intelligence — Aplicação Frontend Nativa (Vanilla JavaScript ES6+)
 * Arquitetura Local-First · Paleta Sustainable Tech · Governança Determinística
 */

(function () {
  "use strict";

  // ==========================================================================
  // 1. ESTADO GLOBAL DA APLICAÇÃO E CONSTANTES CANÔNICAS
  // ==========================================================================
  const STORAGE_KEYS = {
    SESSION_TOKEN: "ecobi_session_token",
    OPERATOR_NAME: "ecobi_operator_name",
    OPERATOR_EMAIL: "ecobi_operator_email",
    OPERATOR_ROLE: "ecobi_operator_role",
    ACTIVE_PROJECT_ID: "ecobi_active_project_id",
    ACTIVE_DATASET_ID: "ecobi_active_dataset_id",
    THEME: "ecobi_theme_preference",
    SIDEBAR_COLLAPSED: "ecobi_sidebar_collapsed",
  };

  const CANONICAL_COLUMNS_SPEC = {
    periodo: "periodo — Período temporal (YYYY-MM / Data)",
    receita_bruta: "receita_bruta — Faturamento bruto (R$)",
    impostos_devolucoes: "impostos_devolucoes — Impostos e devoluções (R$)",
    custo_fixo: "custo_fixo — Custos fixos estruturais (R$)",
    custo_variavel: "custo_variavel — Custos variáveis operacionais (R$)",
    unidades_vendidas: "unidades_vendidas — Unidades comercializadas (un)",
    energia_kwh: "energia_kwh — Consumo elétrico adquirido SIN (kWh - Escopo 2)",
    combustivel_litros: "combustivel_litros — Combustível fóssil direto (L - Escopo 1)",
    residuos_gerados_kg: "residuos_gerados_kg — Resíduos sólidos gerados (kg)",
    residuos_reciclados_kg: "residuos_reciclados_kg — Resíduos reciclados (kg)",
    devolucoes_logistica_reversa_un: "devolucoes_logistica_reversa_un — Logística reversa (un)",
    volume_total_entregas_un: "volume_total_entregas_un — Total de entregas (un - Escopo 3)",
    creditos_carbono_tco2e: "creditos_carbono_tco2e — Créditos de carbono separados (tCO2e)",
    observacoes: "observacoes — Notas e observações operacionais",
  };

  const OFFICIAL_DAX_MEASURES = [
    { name: "Faturamento Liquido", expression: "SUM(FactOperacoesMensais[ReceitaLiquida])" },
    { name: "Custo Total", expression: "SUM(FactOperacoesMensais[CustoTotal])" },
    { name: "Lucro Operacional", expression: "[Faturamento Liquido] - [Custo Total]" },
    { name: "Margem Liquida %", expression: "DIVIDE([Lucro Operacional], [Faturamento Liquido], 0) * 100" },
    { name: "Consumo Energia kWh", expression: "SUM(FactOperacoesMensais[EnergiaKwh])" },
    { name: "Emissoes Brutas tCO2e", expression: "SUM(FactOperacoesMensais[TotalGrossEmissionsCO2eTons])" },
    { name: "Creditos Carbono Separados tCO2e", expression: "SUM(FactOperacoesMensais[CreditosCarbonoTCO2e])" },
    { name: "Taxa Reciclagem %", expression: "DIVIDE(SUM(FactOperacoesMensais[ResiduosRecicladosKg]), SUM(FactOperacoesMensais[ResiduosGeradosKg]), 0) * 100" },
    { name: "Taxa Logistica Reversa %", expression: "DIVIDE(SUM(FactOperacoesMensais[DevolucoesLogisticaReversaUn]), SUM(FactOperacoesMensais[VolumeTotalEntregasUn]), 0) * 100" },
    { name: "WAPE Modelo %", expression: "AVERAGE(FactPrevisoes[WAPE_Modelo]) * 100" },
  ];

  const state = {
    currentView: "view-dashboard",
    sessionToken: localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || "",
    operatorName: localStorage.getItem(STORAGE_KEYS.OPERATOR_NAME) || "Carlos Silva",
    operatorEmail: localStorage.getItem(STORAGE_KEYS.OPERATOR_EMAIL) || "carlos.silva@ecovarejo.com.br",
    operatorRole: localStorage.getItem(STORAGE_KEYS.OPERATOR_ROLE) || "analyst",
    projects: [],
    activeProjectId: localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_ID) || "",
    datasets: [],
    activeDatasetId: localStorage.getItem(STORAGE_KEYS.ACTIVE_DATASET_ID) || "",
    sampleData: null,
    qualityReport: null,
    columnMappings: {},
    financialEsgAnalysis: null,
    predictiveAnalysis: null,
    simulationResult: null,
    analyses: [],
    validations: [],
    powerbiReports: [],
    latestPowerbiResult: null,
    auditLogs: [],
    memoryStatus: null,
    modelSettings: null,
    chatHistory: [],
  };
  let projectContextSequence = 0;

  // ==========================================================================
  // 2. UTILITÁRIOS DE FORMATAÇÃO E ESCAPE SEGURO (PREVENÇÃO XSS)
  // ==========================================================================
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatCurrency(val, currency = "BRL") {
    const num = Number(val);
    if (!Number.isFinite(num)) return "R$ --";
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: currency || "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num);
    } catch (_) {
      return `R$ ${num.toFixed(2)}`;
    }
  }

  function formatNumber(val, decimals = 2) {
    const num = Number(val);
    if (!Number.isFinite(num)) return "--";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  }

  function formatDateShort(isoStr) {
    if (!isoStr) return "--";
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return String(isoStr);
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return String(isoStr);
    }
  }

  function safeJsonParse(raw, fallback) {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function showToast(message, isError = false) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const item = document.createElement("div");
    item.className = `toast-item${isError ? " toast-error" : ""}`;
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 4500);
  }

  function setInlineFeedback(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
      el.textContent = "";
      el.className = "inline-feedback";
      return;
    }
    el.textContent = message;
    el.className = `inline-feedback ${isError ? "is-error" : "is-success"}`;
  }

  // ==========================================================================
  // 3. CLIENTE HTTP REST COM SESSÃO LOCAL E RECUPERAÇÃO AUTOMÁTICA
  // ==========================================================================
  async function apiRequest(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (state.sessionToken) {
      headers["Authorization"] = `Bearer ${state.sessionToken}`;
      headers["X-Session-Token"] = state.sessionToken;
    }

    const fetchOptions = Object.assign({}, options, { headers });
    const response = await fetch(path, fetchOptions);

    // Se receber 401 e ainda não tentamos auto-sessão, cria sessão demo local transparente
    if (response.status === 401 && !options._retriedAuth && path !== "/api/auth/session") {
      const autoOk = await ensureLocalSession(true);
      if (autoOk) {
        return apiRequest(path, Object.assign({}, options, { _retriedAuth: true }));
      }
    }

    let payload = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
    } else {
      try {
        const txt = await response.text();
        payload = txt ? { detail: txt } : {};
      } catch (_) {
        payload = {};
      }
    }

    if (!response.ok) {
      const detail =
        (payload && (payload.detail || payload.message || payload.error || payload.reason)) ||
        `Erro HTTP ${response.status}`;
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  // ==========================================================================
  // 4. AUTENTICAÇÃO DE SESSÃO LOCAL & CONSENTIMENTO LGPD
  // ==========================================================================
  function updateSessionUI() {
    const opNameEl = document.getElementById("topbar-operator-name");
    const opRoleEl = document.getElementById("topbar-operator-role");
    if (opNameEl) opNameEl.textContent = state.operatorName || "Operador Local";
    if (opRoleEl) opRoleEl.textContent = state.operatorRole || "analyst";

    const nameInput = document.getElementById("session-operator-name");
    const emailInput = document.getElementById("session-operator-email");
    const roleSelect = document.getElementById("session-operator-role");
    if (nameInput && state.operatorName) nameInput.value = state.operatorName;
    if (emailInput && state.operatorEmail) emailInput.value = state.operatorEmail;
    if (roleSelect && state.operatorRole) roleSelect.value = state.operatorRole;
  }

  function openSessionModal() {
    const modal = document.getElementById("modal-session");
    if (!modal) return;
    modal.hidden = false;
    const firstInput = document.getElementById("session-operator-name");
    if (firstInput) firstInput.focus();
  }

  function closeSessionModal() {
    const modal = document.getElementById("modal-session");
    if (!modal) return;
    modal.hidden = true;
    document.getElementById("btn-open-session-modal")?.focus();
  }

  async function createSessionRequest(operatorName, operatorEmail, role, lgpdConsent) {
    const res = await apiRequest("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({
        operator_name: operatorName,
        operator_email: operatorEmail,
        role: role || "analyst",
        lgpd_consent: Boolean(lgpdConsent),
      }),
    });

    const token = res.session_token || res.token || res.access_token || "";
    if (token) {
      state.sessionToken = token;
      localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, token);
    }
    state.operatorName = res.operator_name || operatorName;
    state.operatorEmail = res.operator_email || operatorEmail;
    state.operatorRole = res.role || role || "analyst";

    localStorage.setItem(STORAGE_KEYS.OPERATOR_NAME, state.operatorName);
    localStorage.setItem(STORAGE_KEYS.OPERATOR_EMAIL, state.operatorEmail);
    localStorage.setItem(STORAGE_KEYS.OPERATOR_ROLE, state.operatorRole);

    updateSessionUI();
    return res;
  }

  async function ensureLocalSession(silent = false) {
    if (state.sessionToken) {
      try {
        const check = await fetch("/api/auth/session", {
          headers: {
            Authorization: `Bearer ${state.sessionToken}`,
            "X-Session-Token": state.sessionToken,
          },
        });
        if (check.ok) {
          const sess = await check.json();
          state.operatorName = sess.operator_name || state.operatorName;
          state.operatorEmail = sess.operator_email || state.operatorEmail;
          state.operatorRole = sess.role || state.operatorRole;
          updateSessionUI();
          return true;
        }
      } catch (_) {
        // Prossegue para criar nova sessão
      }
    }

    try {
      await createSessionRequest(
        state.operatorName || "Carlos Silva",
        state.operatorEmail || "carlos.silva@ecovarejo.com.br",
        state.operatorRole || "admin",
        true
      );
      if (!silent) {
        showToast("Sessão local autenticada com consentimento LGPD registrado.");
      }
      return true;
    } catch (err) {
      if (!silent) {
        openSessionModal();
      }
      return false;
    }
  }

  // ==========================================================================
  // 5. NAVEGAÇÃO ENTRE AS 10 TELAS PRIORITÁRIAS
  // ==========================================================================
  function updateTopbarPageTitle(viewId = state.currentView) {
    const title = document.getElementById("topbar-page-title");
    const heading = document.getElementById(viewId)?.querySelector("h1");
    if (title && heading) title.textContent = heading.textContent.trim();
  }
  function switchView(viewId) {
    const sections = document.querySelectorAll(".view-section");
    sections.forEach((sec) => {
      if (sec.id === viewId) {
        sec.hidden = false;
        sec.classList.add("active");
      } else {
        sec.hidden = true;
        sec.classList.remove("active");
      }
    });

    const navBtns = document.querySelectorAll(".nav-item[data-view]");
    navBtns.forEach((btn) => {
      if (btn.getAttribute("data-view") === viewId) {
        btn.classList.add("active");
        btn.setAttribute("aria-current", "page");
      } else {
        btn.classList.remove("active");
        btn.removeAttribute("aria-current");
      }
    });

    state.currentView = viewId;
    window.EcoBIOnboarding?.setCurrentView(viewId);
    updateTopbarPageTitle(viewId);
    updateWorkflowStates();

    // Fecha sidebar mobile se aberta
    const sidebar = document.getElementById("app-sidebar");
    const openBtn = document.getElementById("btn-open-sidebar");
    if (sidebar && sidebar.classList.contains("is-open")) {
      sidebar.classList.remove("is-open");
      if (openBtn) {
        openBtn.setAttribute("aria-expanded", "false");
        openBtn.setAttribute("aria-label", "Abrir menu lateral");
      }
    }

    // Dispara carregamento específico da view selecionada
    if (viewId === "view-dashboard") {
      refreshDashboardTelemetry();
    } else if (viewId === "view-projects") {
      loadProjects();
    } else if (viewId === "view-import") {
      renderDatasetsTable();
      if (state.activeDatasetId) loadDatasetSample(state.activeDatasetId);
    } else if (viewId === "view-quality") {
      if (state.activeDatasetId) loadQualityReport(state.activeDatasetId);
    } else if (viewId === "view-predictive") {
      renderPredictiveChart();
    } else if (viewId === "view-validation") {
      loadValidations();
    } else if (viewId === "view-powerbi") {
      loadPowerbiView();
    } else if (viewId === "view-audit") {
      loadAuditAndSystemView();
    } else if (viewId === "view-multiproject") {
      loadMultiprojectData();
    } else if (viewId === "view-scheduler") {
      loadSchedulerData();
    }
  }

  // ==========================================================================
  // 6. TELEMETRIA DO SISTEMA: MEMÓRIA RAM (psutil) & MODELO OLLAMA
  // ==========================================================================
  async function loadMemoryStatus() {
    try {
      const mem = await apiRequest("/api/system/memory");
      state.memoryStatus = mem;
      renderMemoryTelemetry(mem);
      return mem;
    } catch (_) {
      return null;
    }
  }

  function renderMemoryTelemetry(mem) {
    if (!mem) return;
    const usedValue = mem.ecobi_ram_used_mb ?? mem.memory_used_mb;
    const budgetValue = mem.ecobi_ram_budget_mb ?? mem.memory_budget_mb;
    const usedMb = usedValue === null || usedValue === undefined ? NaN : Number(usedValue);
    const budgetMb = budgetValue === null || budgetValue === undefined ? NaN : Number(budgetValue);
    const reportedPct = mem.ecobi_ram_usage_percentage;
    const pct = reportedPct !== null && reportedPct !== undefined && Number.isFinite(Number(reportedPct))
      ? Math.min(100, Math.max(0, Number(reportedPct)))
      : Number.isFinite(usedMb) && Number.isFinite(budgetMb) && budgetMb > 0
        ? Math.min(100, Math.max(0, (usedMb / budgetMb) * 100))
        : NaN;
    const hostTotal = mem.host_total_ram_mb === null || mem.host_total_ram_mb === undefined ? NaN : Number(mem.host_total_ram_mb);
    const hostAvail = mem.host_available_ram_mb === null || mem.host_available_ram_mb === undefined ? NaN : Number(mem.host_available_ram_mb);
    const alertLevel = String(mem.memory_alert_level || "UNKNOWN").toUpperCase();
    const canHeavy = mem.can_run_heavy_analysis;

    // Topbar
    const topText = document.getElementById("topbar-ram-text");
    const topBar = document.getElementById("topbar-ram-bar");
    if (topText) topText.textContent = Number.isFinite(usedMb) && Number.isFinite(budgetMb) ? `${Math.round(usedMb)} / ${Math.round(budgetMb)} MB` : "— / — MB";
    if (topBar) {
      topBar.style.width = Number.isFinite(pct) ? `${Math.max(4, pct)}%` : "0%";
      topBar.style.backgroundColor = alertLevel === "CRITICAL" ? "var(--warning)" : "var(--forest-600)";
    }

    // Dashboard Gauge SVG (Arc length = 267)
    const arc = document.getElementById("dash-ram-gauge-arc");
    const pctText = document.getElementById("dash-ram-gauge-pct");
    const mbText = document.getElementById("dash-ram-gauge-mb");
    if (arc) {
      const maxArc = 267;
      const offset = Number.isFinite(pct) ? maxArc - (maxArc * Math.min(100, pct)) / 100 : maxArc;
      arc.setAttribute("stroke-dashoffset", String(offset.toFixed(1)));
      arc.setAttribute("stroke", alertLevel === "CRITICAL" ? "var(--warning)" : "var(--forest-600)");
    }
    if (pctText) pctText.textContent = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "—%";
    if (mbText) mbText.textContent = `${formatNumber(usedMb, 1)} / ${formatNumber(budgetMb, 0)} MB`;

    const usedDetail = document.getElementById("dash-ram-used-detail");
    const budgetDetail = document.getElementById("dash-ram-budget-detail");
    const hostDetail = document.getElementById("dash-ram-host-detail");
    const headroomDetail = document.getElementById("dash-ram-headroom-detail");
    const alertBadge = document.getElementById("dash-ram-alert-badge");

    if (usedDetail) usedDetail.textContent = `${formatNumber(usedMb, 1)} MB`;
    if (budgetDetail) budgetDetail.textContent = `${Math.round(budgetMb)} MB (8,0 GB)`;
    if (hostDetail) hostDetail.textContent = `${formatNumber(hostAvail, 0)} MB livres de ${formatNumber(hostTotal, 0)} MB`;
    if (headroomDetail) headroomDetail.textContent = canHeavy === true ? "Liberado (dentro do orçamento)" : canHeavy === false ? "Restrito (alta ocupação)" : "Não avaliado";
    if (alertBadge) {
      alertBadge.textContent = alertLevel;
      alertBadge.className = `badge ${alertLevel === "NORMAL" ? "badge-approved" : alertLevel === "WARNING" ? "badge-warning" : alertLevel === "CRITICAL" ? "badge-rejected" : "badge-neutral"}`;
    }

    // View Audit (Tela 10)
    const audUsed = document.getElementById("audit-ram-used");
    const audBudget = document.getElementById("audit-ram-budget");
    const audPct = document.getElementById("audit-ram-pct");
    const audHost = document.getElementById("audit-ram-host");
    const audStatus = document.getElementById("audit-ram-status");

    if (audUsed) audUsed.textContent = `${formatNumber(usedMb, 2)} MB`;
    if (audBudget) audBudget.textContent = `${Math.round(budgetMb)} MB`;
    if (audPct) audPct.textContent = `${pct.toFixed(2)}%`;
    if (audHost) audHost.textContent = `${formatNumber(hostAvail, 0)} MB livres / ${formatNumber(hostTotal, 0)} MB total`;
    if (audStatus) audStatus.textContent = alertLevel;
  }

  async function loadModelSettings() {
    try {
      const settings = await apiRequest("/api/settings/model");
      state.modelSettings = settings;
      renderModelSettings(settings);
      return settings;
    } catch (_) {
      return null;
    }
  }

  function renderModelSettings(settings) {
    if (!settings) return;
    const activeModel = settings.active_model || settings.model_name || "qwen3.5:4b";
    const ctxTokens = settings.context_window_tokens || settings.num_ctx || 4096;
    const eligible9b = Boolean(settings.advanced_model_eligible);
    const ollamaStatus = settings.ollama_status || (settings.ollama && settings.ollama.status) || "connected";
    const isOnline = ollamaStatus === "connected" || ollamaStatus === "online" || ollamaStatus === "healthy";

    // Topbar
    const topText = document.getElementById("topbar-ollama-text");
    const topDot = document.getElementById("topbar-ollama-dot");
    if (topText) topText.textContent = activeModel;
    if (topDot) {
      topDot.className = `status-dot ${isOnline ? "status-online" : "status-offline"}`;
    }

    // Dashboard
    const dashActive = document.getElementById("dash-model-active");
    const dashCtx = document.getElementById("dash-model-ctx");
    const dash9b = document.getElementById("dash-model-9b-eligible");
    const dashBadge = document.getElementById("dash-ollama-status-badge");

    if (dashActive) dashActive.textContent = activeModel;
    if (dashCtx) dashCtx.textContent = `${ctxTokens} tokens`;
    if (dash9b) dash9b.textContent = eligible9b ? "Elegível (RAM suficiente)" : "Bloqueado (< 10 GB livres)";
    if (dashBadge) {
      dashBadge.textContent = isOnline ? `Ollama Online (${activeModel})` : `Fallback Determinístico Ativo`;
      dashBadge.className = `badge ${isOnline ? "badge-approved" : "badge-warning"}`;
    }

    // Seletores sincronizados nas Telas 5 e 10
    const assistantSelect = document.getElementById("assistant-model-select");
    const settingsSelect = document.getElementById("settings-model-select");
    const auditCtx = document.getElementById("audit-ctx-tokens");
    if (assistantSelect) assistantSelect.value = activeModel;
    if (settingsSelect) settingsSelect.value = activeModel;
    if (auditCtx) auditCtx.textContent = `${ctxTokens} tokens (Limite seguro <= 8 GB RAM)`;
  }

  async function refreshDashboardTelemetry() {
    await Promise.all([loadMemoryStatus(), loadModelSettings()]);
    updateDashboardKPIs();
  }

  // ==========================================================================
  // 7. TELA 2: GERENCIAMENTO DE PROJETOS & LGPD
  // ==========================================================================
  async function loadProjects() {
    try {
      const res = await apiRequest("/api/projects");
      const list = Array.isArray(res) ? res : res.projects || res.items || [];
      state.projects = list;

      if (list.length > 0) {
        const exists = list.some((p) => p.id === state.activeProjectId);
        if (!state.activeProjectId || !exists) {
          await setActiveProject(list[0].id, false);
        } else {
          syncProjectSelectors();
          await loadProjectContextData(state.activeProjectId);
        }
      } else {
        await setActiveProject("", false);
        syncProjectSelectors();
      }

      renderProjectsGrid();
      return list;
    } catch (err) {
      showToast(`Não foi possível listar projetos: ${err.message}`, true);
      return [];
    }
  }

  function syncProjectSelectors() {
    const globalSelect = document.getElementById("global-project-select");
    const sideName = document.getElementById("sidebar-project-name");
    const sideSector = document.getElementById("sidebar-project-sector");
    const stepProj = document.getElementById("step-status-projects");

    const activeProj = state.projects.find((p) => p.id === state.activeProjectId) || null;
    const executiveProject = document.getElementById("dash-active-project");
    if (executiveProject) executiveProject.textContent = activeProj ? activeProj.name : "Selecione um projeto";

    if (globalSelect) {
      if (state.projects.length === 0) {
        globalSelect.innerHTML = `<option value="">Nenhum projeto cadastrado</option>`;
      } else {
        globalSelect.innerHTML = state.projects
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}" ${p.id === state.activeProjectId ? "selected" : ""}>${escapeHtml(
                p.name
              )} (${escapeHtml(p.sector)})</option>`
          )
          .join("");
      }
      globalSelect.title = activeProj ? `${activeProj.name} (${activeProj.sector})` : "Nenhum projeto selecionado";
    }

    if (sideName) {
      sideName.textContent = activeProj ? activeProj.name : "Crie ou selecione um projeto";
    }
    if (sideSector) {
      sideSector.textContent = activeProj ? activeProj.sector : "Sem projeto";
    }
    if (stepProj) {
      stepProj.textContent = activeProj ? `${state.projects.length} projeto(s) ativo(s)` : "Pendente";
    }
  }

  async function setActiveProject(projectId, notify = true) {
    const nextProjectId = projectId || "";
    if (state.activeProjectId !== nextProjectId || !nextProjectId) resetProjectViewState();
    state.activeProjectId = nextProjectId;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROJECT_ID, state.activeProjectId);
    syncProjectSelectors();
    renderProjectsGrid();

    if (!state.activeProjectId) {
      syncDatasetSelector();
      return;
    }

    await loadProjectContextData(state.activeProjectId);
    if (notify) {
      const proj = state.projects.find((p) => p.id === projectId);
      if (proj) showToast(`Projeto ativo alterado para "${proj.name}".`);
    }
  }

  function resetProjectViewState() {
    state.activeDatasetId = "";
    state.datasets = [];
    state.sampleData = null;
    state.qualityReport = null;
    state.columnMappings = {};
    state.financialEsgAnalysis = null;
    state.predictiveAnalysis = null;
    state.simulationResult = null;
    state.analyses = [];
    state.validations = [];
    state.powerbiReports = [];
    state.latestPowerbiResult = null;
    state.auditLogs = [];
    state.chatHistory = [];
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DATASET_ID, "");
    syncDatasetSelector();
    updateDashboardKPIs();
  }

  async function loadProjectContextData(projectId) {
    if (!projectId) return;
    const sequence = ++projectContextSequence;
    const isCurrentContext = () => sequence === projectContextSequence && projectId === state.activeProjectId;
    // Busca detalhes/datasets/validações/relatórios/auditoria do projeto
    try {
      const projDetail = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`).catch(() => null);
      if (!isCurrentContext()) return;
      if (projDetail && Array.isArray(projDetail.datasets)) {
        state.datasets = projDetail.datasets;
      } else {
        const dsRes = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/datasets`).catch(() => null);
        if (!isCurrentContext()) return;
        if (dsRes) {
          state.datasets = Array.isArray(dsRes) ? dsRes : dsRes.datasets || [];
        }
      }

      if (projDetail && Array.isArray(projDetail.analyses)) {
        state.analyses = projDetail.analyses;
      }

      if (state.datasets.length > 0) {
        const dsExists = state.datasets.some((d) => (d.id || d.dataset_id) === state.activeDatasetId);
        if (!state.activeDatasetId || !dsExists) {
          state.activeDatasetId = state.datasets[0].id || state.datasets[0].dataset_id;
          localStorage.setItem(STORAGE_KEYS.ACTIVE_DATASET_ID, state.activeDatasetId);
        }
      } else {
        state.activeDatasetId = "";
      }

      syncDashboardAnalysis();

      syncDatasetSelector();
      renderDatasetsTable();

      if (state.activeDatasetId) {
        await Promise.all([
          loadDatasetSample(state.activeDatasetId, true),
          loadQualityReport(state.activeDatasetId, true),
        ]);
      }
      if (!isCurrentContext()) return;

      await Promise.all([
        loadValidations(true),
        loadPowerbiReportsList(true),
        loadAuditLogs(true),
      ]);

      if (!isCurrentContext()) return;
      updateDashboardKPIs();
    } catch (_) {
      // Silencioso no bootstrap inicial
    }
  }

  function renderProjectsGrid() {
    const grid = document.getElementById("projects-grid");
    if (!grid) return;

    const searchVal = (document.getElementById("project-search-input")?.value || "").toLowerCase().trim();
    const sectorVal = (document.getElementById("project-sector-filter")?.value || "").toLowerCase().trim();

    const filtered = state.projects.filter((p) => {
      const matchText =
        !searchVal ||
        String(p.name || "").toLowerCase().includes(searchVal) ||
        String(p.description || "").toLowerCase().includes(searchVal) ||
        String(p.sector || "").toLowerCase().includes(searchVal);
      const matchSector = !sectorVal || String(p.sector || "").toLowerCase().includes(sectorVal);
      return matchText && matchSector;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <article class="surface-panel">
          <p class="empty-state-text">Nenhum projeto encontrado. Utilize o formulário ao lado para criar um projeto corporativo.</p>
        </article>
      `;
      return;
    }

    grid.innerHTML = filtered
      .map((p) => {
        const isActive = p.id === state.activeProjectId;
        const retention = p.retention_days ?? 365;
        const dsCount = p.datasets_count ?? (isActive ? state.datasets.length : 0);
        const anCount = p.analyses_count ?? (isActive ? state.analyses.length : 0);
        return `
          <article class="project-card ${isActive ? "is-active-project" : ""}">
            <div>
              <div class="kpi-card-top">
                <span class="badge ${isActive ? "badge-approved" : "badge-neutral"}">${
          isActive ? "PROJETO ATIVO" : escapeHtml(p.sector || "Corporativo")
        }</span>
                <span class="hash-code">${escapeHtml(p.currency || "BRL")} · LGPD ${escapeHtml(retention)}d</span>
              </div>
              <h3 class="project-card-title">${escapeHtml(p.name)}</h3>
              <p class="project-card-desc">${escapeHtml(
                p.description || "Projeto analítico local-first com isolamento de dados e auditoria LGPD."
              )}</p>
            </div>
            <div>
              <div class="project-card-meta">
                <span><strong>Setor:</strong> ${escapeHtml(p.sector)}</span>
                <span><strong>Datasets:</strong> ${escapeHtml(dsCount)}</span>
                <span><strong>Análises:</strong> ${escapeHtml(anCount)}</span>
                <span><strong>Criado:</strong> ${escapeHtml(formatDateShort(p.created_at))}</span>
              </div>
              <div class="project-card-actions">
                <button type="button" class="btn ${
                  isActive ? "btn-secondary" : "btn-primary"
                } btn-sm" data-select-project="${escapeHtml(p.id)}">
                  ${isActive ? "Projeto Selecionado" : "Selecionar Projeto"}
                </button>
                <button type="button" class="btn btn-ghost btn-sm" data-import-project="${escapeHtml(p.id)}">
                  Importar Dados
                </button>
                <button type="button" class="btn btn-terracotta btn-sm" data-delete-project="${escapeHtml(
                  p.id
                )}" data-project-name="${escapeHtml(p.name)}">
                  Excluir (LGPD)
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  // ==========================================================================
  // 8. TELA 3: IMPORTAÇÃO DE DADOS (UPLOAD, SAMPLES & PRÉVIA COM PII MASCARADO)
  // ==========================================================================
  function syncDashboardAnalysis() {
    const latestAnalysis = state.analyses.find((analysis) =>
      analysis.analysis_type === "financial_esg" &&
      analysis.dataset_id === state.activeDatasetId &&
      analysis.status === "COMPLETED"
    );
    const result = safeJsonParse(latestAnalysis?.result_json, null);
    state.financialEsgAnalysis = result && Object.keys(result).length
      ? { ...result, analysis_id: latestAnalysis.id, dataset_id: latestAnalysis.dataset_id }
      : null;
  }

  function syncDatasetSelector() {
    const select = document.getElementById("global-dataset-select");
    const sideBadge = document.getElementById("sidebar-dataset-badge");
    const stepImport = document.getElementById("step-status-import");
    const executiveDataset = document.getElementById("dash-active-dataset");
    const activeDataset = state.datasets.find((dataset) => (dataset.id || dataset.dataset_id) === state.activeDatasetId);
    if (executiveDataset) executiveDataset.textContent = activeDataset ? (activeDataset.filename || activeDataset.name) : "Nenhum dataset selecionado";

    if (select) {
      if (state.datasets.length === 0) {
        select.innerHTML = `<option value="">Nenhum dataset</option>`;
      } else {
        select.innerHTML = state.datasets
          .map((d) => {
            const id = d.id || d.dataset_id;
            const rows = d.row_count ?? d.total_rows ?? 0;
            return `<option value="${escapeHtml(id)}" ${id === state.activeDatasetId ? "selected" : ""}>${escapeHtml(
              d.filename
            )} (${rows} linhas)</option>`;
          })
          .join("");
      }
      select.title = activeDataset ? `${activeDataset.filename || activeDataset.name} (${activeDataset.row_count ?? activeDataset.total_rows ?? 0} linhas)` : "Nenhum dataset selecionado";
    }

    const activeDs = state.datasets.find((d) => (d.id || d.dataset_id) === state.activeDatasetId);
    if (sideBadge) {
      sideBadge.textContent = activeDs ? `${activeDs.filename} (${activeDs.row_count ?? 0}l)` : "Sem dataset";
    }
    if (stepImport) {
      stepImport.textContent = activeDs ? `${activeDs.row_count ?? 0} registros` : "Aguardando CSV";
    }
  }

  function upsertDatasetInState(dsObj) {
    if (!dsObj) return;
    const id = dsObj.dataset_id || dsObj.id;
    if (!id) return;
    const normalized = {
      id: id,
      dataset_id: id,
      project_id: dsObj.project_id || state.activeProjectId,
      filename: dsObj.filename || "dataset.csv",
      row_count: dsObj.row_count ?? dsObj.total_rows ?? 0,
      column_count: dsObj.column_count ?? (Array.isArray(dsObj.columns_detected) ? dsObj.columns_detected.length : 14),
      file_hash: dsObj.sha256_hash || dsObj.file_hash || "auditado",
      pii_detected_json: dsObj.pii_detected_json || dsObj.pii_detected || [],
      created_at: dsObj.created_at || new Date().toISOString(),
    };

    const idx = state.datasets.findIndex((item) => (item.id || item.dataset_id) === id);
    if (idx >= 0) {
      state.datasets[idx] = normalized;
    } else {
      state.datasets.unshift(normalized);
    }

    state.activeDatasetId = id;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_DATASET_ID, id);
    syncDatasetSelector();
    renderDatasetsTable();
  }

  function renderDatasetsTable() {
    const tbody = document.getElementById("datasets-table-body");
    if (!tbody) return;

    if (state.datasets.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-cell">Nenhum dataset carregado neste projeto. Use os botões rápidos acima ou envie um arquivo CSV/Excel.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.datasets
      .map((d) => {
        const id = d.id || d.dataset_id;
        const isCurrent = id === state.activeDatasetId;
        const hashShort = String(d.file_hash || d.sha256_hash || "N/A").slice(0, 16) + "...";
        return `
          <tr>
            <td>
              <strong>${escapeHtml(d.filename)}</strong>
              ${isCurrent ? `<span class="badge badge-approved">Ativo</span>` : ""}
            </td>
            <td>${escapeHtml(d.row_count ?? 0)} linhas / ${escapeHtml(d.column_count ?? 14)} cols</td>
            <td><code class="hash-code" title="${escapeHtml(d.file_hash || d.sha256_hash || "")}">${escapeHtml(
          hashShort
        )}</code></td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" data-preview-dataset="${escapeHtml(id)}">Ver Amostra</button>
              <button type="button" class="btn btn-ghost btn-sm" data-quality-dataset="${escapeHtml(id)}">Qualidade</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function ensureActiveProjectForAction() {
    if (state.activeProjectId) return state.activeProjectId;
    await loadProjects();
    if (state.activeProjectId) return state.activeProjectId;

    // Cria projeto padrão automaticamente caso o banco esteja vazio
    const created = await apiRequest("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "EcoVarejo Sustentável 2026",
        sector: "Varejo / E-commerce Sustentável",
        currency: "BRL",
        retention_days: 365,
        description: "Projeto piloto de inteligência financeira, preditiva e inventário GEE (GHG Protocol).",
      }),
    });
    const newId = created.id || created.project_id;
    await loadProjects();
    await setActiveProject(newId, false);
    return newId;
  }

  async function loadSampleDataset(sampleKey, sampleLabel) {
    try {
      const projectId = await ensureActiveProjectForAction();
      setInlineFeedback("import-feedback", `Carregando base "${sampleLabel}" com verificação SHA-256 e proteção PII...`);

      const progBar = document.getElementById("upload-progress-bar");
      const progPct = document.getElementById("upload-pct-text");
      const progStatus = document.getElementById("upload-status-text");
      if (progBar) progBar.style.width = "60%";
      if (progPct) progPct.textContent = "60%";
      if (progStatus) progStatus.textContent = `Processando ${sampleLabel}...`;

      const filenameMap = {
        piloto: "ecobi_varejo_piloto.csv",
        adversos: "ecobi_dados_adversos.csv",
        curto: "ecobi_curto_insuficiente.csv",
      };

      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/datasets/load-sample?sample=${encodeURIComponent(
          sampleKey
        )}&sample_name=${encodeURIComponent(sampleKey)}`,
        {
          method: "POST",
          body: JSON.stringify({
            sample_name: sampleKey,
            sample: sampleKey,
            sample_type: sampleKey,
            filename: filenameMap[sampleKey] || "ecobi_varejo_piloto.csv",
          }),
        }
      );

      if (progBar) progBar.style.width = "100%";
      if (progPct) progPct.textContent = "100%";
      if (progStatus) progStatus.textContent = `Base ${sampleLabel} ingerida com sucesso!`;

      const dsRecord = res.dataset || res;
      upsertDatasetInState(dsRecord);

      await Promise.all([
        loadDatasetSample(state.activeDatasetId, true),
        loadQualityReport(state.activeDatasetId, true),
      ]);

      setInlineFeedback("import-feedback", `Base "${sampleLabel}" carregada e auditada com sucesso!`);
      showToast(`Dataset "${dsRecord.filename || sampleLabel}" carregado no projeto ativo.`);
      return dsRecord;
    } catch (err) {
      setInlineFeedback("import-feedback", `Falha ao carregar base de exemplo: ${err.message}`, true);
      showToast(`Erro ao carregar sample: ${err.message}`, true);
      return null;
    }
  }

  async function loadDatasetSample(datasetId, silent = false) {
    if (!state.activeProjectId || !datasetId) return;
    const projectId = state.activeProjectId;
    try {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/datasets/sample?dataset_id=${encodeURIComponent(
          datasetId
        )}&limit=50`
      );
      if (projectId !== state.activeProjectId || datasetId !== state.activeDatasetId) return;
      state.sampleData = res;
      renderSamplePreview(res);
    } catch (err) {
      if (!silent) {
        showToast(`Erro ao carregar prévia do dataset: ${err.message}`, true);
      }
    }
  }

  function renderSamplePreview(sample) {
    const container = document.getElementById("sample-preview-container");
    const banner = document.getElementById("sample-pii-banner");
    if (!container) return;

    const rows = (sample && (sample.rows || sample.sample || sample.data)) || [];
    const cols =
      (sample && sample.columns) || (rows.length > 0 ? Object.keys(rows[0]) : []);

    if (rows.length === 0) {
      container.innerHTML = `<p class="empty-state-text">Nenhuma linha disponível para pré-visualização.</p>`;
      if (banner) banner.hidden = true;
      return;
    }

    let piiMaskCount = 0;
    rows.forEach((r) => {
      Object.values(r).forEach((v) => {
        const str = String(v ?? "");
        if (str.includes("***") || str.includes("MASCARADO") || str.includes("DESARMADO")) {
          piiMaskCount += 1;
        }
      });
    });

    if (banner) {
      banner.hidden = false;
      banner.innerHTML = `
        <strong>Proteção LGPD Ativa na Visualização (${escapeHtml(sample.filename || "Dataset")}):</strong>
        Exibindo ${escapeHtml(rows.length)} de ${escapeHtml(
        sample.total_rows ?? rows.length
      )} linhas. Mascaramento automático de PII (CPF/CNPJ/E-mail/Telefone) habilitado${
        piiMaskCount > 0 ? ` — <strong>${piiMaskCount} ocorrência(s) sensível(is) mascarada(s) na prévia</strong>` : ""
      }.
      `;
    }

    const thHtml = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const trHtml = rows
      .slice(0, 25)
      .map((row) => {
        const tds = cols
          .map((c) => {
            const rawVal = row[c];
            if (rawVal === null || rawVal === undefined || rawVal === "") {
              return `<td><span class="badge badge-warning">NULO</span></td>`;
            }
            const strVal = String(rawVal);
            if (strVal.includes("***") || strVal.includes("MASCARADO") || strVal.includes("DESARMADO")) {
              return `<td><span class="badge badge-rejected" title="Dado pessoal mascarado ou prompt injection neutralizado">${escapeHtml(
                strVal
              )}</span></td>`;
            }
            return `<td>${escapeHtml(strVal)}</td>`;
          })
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");

    container.innerHTML = `
      <table class="data-table" aria-label="Prévia de linhas do dataset com PII mascarado">
        <thead><tr>${thHtml}</tr></thead>
        <tbody>${trHtml}</tbody>
      </table>
    `;
  }

  // ==========================================================================
  // 9. TELA 4: QUALIDADE DOS DADOS & MAPEAMENTO CANÔNICO
  // ==========================================================================
  async function loadQualityReport(datasetId, silent = false) {
    if (!state.activeProjectId) return;
    const dsId = datasetId || state.activeDatasetId;
    if (!dsId) return;
    const projectId = state.activeProjectId;

    try {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/quality?dataset_id=${encodeURIComponent(dsId)}`
      );
      if (projectId !== state.activeProjectId || dsId !== state.activeDatasetId) return;
      state.qualityReport = res;
      renderQualityView(res);
      updateDashboardKPIs();
    } catch (err) {
      if (!silent) {
        showToast(`Erro ao obter relatório de qualidade: ${err.message}`, true);
      }
    }
  }

  function renderQualityView(report) {
    if (!report) return;
    const summary = safeJsonParse(report.summary_json || report.summary, {}) || {};
    const score = Number(
      report.overall_quality_score ?? summary.overall_quality_score ?? report.completeness_pct ?? 100
    );
    const completeness = Number(report.completeness_pct ?? summary.completeness_pct ?? score);
    const totalRows = Number(report.total_rows ?? summary.total_rows ?? 0);
    const dups = Number(report.duplicate_rows ?? report.duplicate_count ?? summary.exact_duplicates_count ?? 0);
    const inconsistenciesList = report.inconsistencies || summary.inconsistencies || [];
    const inconsistencyCount = Number(
      report.inconsistency_count ?? inconsistenciesList.length ?? 0
    );
    const suspectCount = Number(report.suspect_count ?? 0);

    // Calcula total de nulos
    const colProfilesObj = summary.column_profiles || {};
    const columnsArray = Array.isArray(report.columns)
      ? report.columns
      : Object.keys(colProfilesObj).map((colName) => ({
          name: colName,
          detected_type: colProfilesObj[colName].dtype || "object",
          null_count: colProfilesObj[colName].null_count || 0,
          null_percentage: colProfilesObj[colName].null_pct || 0,
          unique_count: colProfilesObj[colName].unique_count || 0,
          outliers_detected: (summary.outliers_by_column && summary.outliers_by_column[colName]) || 0,
        }));

    const totalNulls = columnsArray.reduce((acc, c) => acc + Number(c.null_count || 0), 0);

    const scoreEl = document.getElementById("qual-score-val");
    const rowsSub = document.getElementById("qual-rows-sub");
    const nullsEl = document.getElementById("qual-nulls-val");
    const dupsEl = document.getElementById("qual-dups-val");
    const suspectsEl = document.getElementById("qual-suspects-val");
    const incSub = document.getElementById("qual-inconsistencies-sub");
    const stepQual = document.getElementById("step-status-quality");

    if (scoreEl) scoreEl.textContent = `${score.toFixed(1)}%`;
    if (rowsSub) rowsSub.textContent = `Completude: ${completeness.toFixed(1)}% (${totalRows} linhas)`;
    if (nullsEl) nullsEl.textContent = `${totalNulls} célula(s)`;
    if (dupsEl) dupsEl.textContent = `${dups} linha(s)`;
    if (suspectsEl) suspectsEl.textContent = `${suspectCount + inconsistencyCount} preservado(s)`;
    if (incSub) incSub.textContent = `Inconsistências físicas/contábeis: ${inconsistencyCount}`;
    if (stepQual) stepQual.textContent = `Score: ${score.toFixed(1)}%`;

    // Renderiza lista de alertas e valores suspeitos preservados
    const warnContainer = document.getElementById("quality-warnings-list");
    if (warnContainer) {
      const itemsHtml = [];

      inconsistenciesList.forEach((inc) => {
        itemsHtml.push(`
          <div class="warning-item">
            <div>
              <strong>${escapeHtml(inc.type || "INCONSISTENCIA_DETECTADA")} (${escapeHtml(inc.column || "Coluna")}):</strong>
              <span>${escapeHtml(inc.description || "Anomalia física ou contábil detectada.")}</span>
            </div>
            <span class="badge badge-rejected">Preservado para Auditoria (${escapeHtml(inc.count || 1)})</span>
          </div>
        `);
      });

      if (dups > 0) {
        itemsHtml.push(`
          <div class="warning-item">
            <div>
              <strong>DUPLICIDADE_EXATA (REG-QUAL-02):</strong>
              <span>Foram identificados ${escapeHtml(dups)} registro(s) duplicado(s) na base importada.</span>
            </div>
            <span class="badge badge-warning">Sinalizado (${escapeHtml(dups)})</span>
          </div>
        `);
      }

      if (totalNulls > 0) {
        itemsHtml.push(`
          <div class="warning-item">
            <div>
              <strong>CAMPOS_AUSENTES (REG-QUAL-01):</strong>
              <span>Foram detectadas ${escapeHtml(totalNulls)} célula(s) nula(s) ou vazias sem imputação silenciosa.</span>
            </div>
            <span class="badge badge-warning">Nulos Preservados</span>
          </div>
        `);
      }

      const outliersByCol = summary.outliers_by_column || {};
      Object.keys(outliersByCol).forEach((colKey) => {
        const cnt = outliersByCol[colKey];
        if (cnt > 0) {
          itemsHtml.push(`
            <div class="warning-item">
              <div>
                <strong>OUTLIER_IQR_ROBUSTO (${escapeHtml(colKey)}):</strong>
                <span>${escapeHtml(cnt)} valor(es) extremo(s) fora de 1.5x IQR detectado(s) e preservado(s) sem exclusão automática.</span>
              </div>
              <span class="badge badge-mint">Preservado (${escapeHtml(cnt)})</span>
            </div>
          `);
        }
      });

      if (itemsHtml.length === 0) {
        warnContainer.innerHTML = `
          <div class="alert-banner alert-info">
            <strong>Integridade Plena Confirmada:</strong> Nenhuma duplicidade, inconsistência física ou célula nula crítica encontrada neste dataset.
          </div>
        `;
      } else {
        warnContainer.innerHTML = itemsHtml.join("");
      }
    }

    // Renderiza tabela de mapeamento canônico
    const tbody = document.getElementById("quality-columns-tbody");
    if (!tbody) return;

    const existingMappings = report.mappings || report.mapping || state.columnMappings || {};

    tbody.innerHTML = columnsArray
      .map((col) => {
        const colName = col.name || col.column_name;
        const guessedCanon =
          existingMappings[colName] ||
          col.canonical_mapping ||
          (CANONICAL_COLUMNS_SPEC[colName.toLowerCase()] ? colName.toLowerCase() : "");

        const optionsHtml = [
          `<option value="">-- Ignorar / Não Mapeado --</option>`,
          ...Object.keys(CANONICAL_COLUMNS_SPEC).map(
            (canonKey) =>
              `<option value="${escapeHtml(canonKey)}" ${
                guessedCanon === canonKey ? "selected" : ""
              }>${escapeHtml(CANONICAL_COLUMNS_SPEC[canonKey])}</option>`
          ),
        ].join("");

        const nullPct = Number(col.null_percentage ?? col.null_pct ?? 0);
        const outliers = Number(col.outliers_detected ?? 0);

        return `
          <tr>
            <td><strong>${escapeHtml(colName)}</strong></td>
            <td><code>${escapeHtml(col.detected_type || col.dtype || "string")}</code></td>
            <td>
              <span class="badge ${nullPct > 10 ? "badge-rejected" : nullPct > 0 ? "badge-warning" : "badge-approved"}">
                ${escapeHtml(col.null_count ?? 0)} (${nullPct.toFixed(1)}%)
              </span>
            </td>
            <td>${escapeHtml(col.unique_count ?? "--")}</td>
            <td>Outliers IQR: <strong>${escapeHtml(outliers)}</strong> (Preservados)</td>
            <td>
              <label for="map-col-${escapeHtml(colName)}" class="sr-only">Mapear coluna ${escapeHtml(colName)}</label>
              <select id="map-col-${escapeHtml(colName)}" class="canonical-map-select" data-orig-col="${escapeHtml(
          colName
        )}">
                ${optionsHtml}
              </select>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // ==========================================================================
  // 10. TELA 5: ANÁLISE FINANCEIRA/ESG DETERMINÍSTICA & ASSISTENTE IA
  // ==========================================================================
  async function executeFinancialEsgAnalysis() {
    try {
      const projectId = await ensureActiveProjectForAction();
      if (!state.activeDatasetId) {
        await loadSampleDataset("piloto", "Piloto Varejo Sustentável");
      }

      const periodStart = document.getElementById("esg-period-start")?.value || "2024-01";
      const periodEnd = document.getElementById("esg-period-end")?.value || "2025-12";
      const factorSource = document.getElementById("esg-factor-source")?.value || "GHG_PROTOCOL_BRASIL_2025";

      setInlineFeedback("esg-analysis-feedback", "Executando cálculo determinístico via Python/Pandas...");

      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/analyze/financial-esg`,
        {
          method: "POST",
          body: JSON.stringify({
            dataset_id: state.activeDatasetId,
            period_start: periodStart,
            period_end: periodEnd,
            emission_factor_source: factorSource,
          }),
        }
      );

      state.financialEsgAnalysis = res;
      const persistedAnalyses = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/analyses`).catch(() => null);
      if (persistedAnalyses && Array.isArray(persistedAnalyses.analyses)) {
        state.analyses = persistedAnalyses.analyses;
      }
      renderFinancialEsgResults(res);
      updateDashboardKPIs();
      await loadValidations(true);

      setInlineFeedback(
        "esg-analysis-feedback",
        `Cálculo determinístico concluído (ID: ${res.analysis_id || res.id || "auditado"}). Escopos 1, 2 e 3 segregados de créditos de carbono.`
      );
      showToast("Análise Financeira & ESG calculada e validada com sucesso!");
      return res;
    } catch (err) {
      setInlineFeedback("esg-analysis-feedback", `Erro no cálculo Financeiro/ESG: ${err.message}`, true);
      showToast(`Erro na análise ESG: ${err.message}`, true);
      return null;
    }
  }

  function renderFinancialEsgResults(res) {
    if (!res) return;
    const fin = res.financial_kpis || (res.result && res.result.financial_kpis) || {};
    const op = res.operational_kpis || (res.result && res.result.operational_kpis) || {};
    const esg = res.esg_kpis || (res.result && res.result.esg_kpis) || {};

    const grossRev = Number(fin.receita_bruta_total ?? fin.total_revenue ?? 0);
    const netRev = Number(fin.receita_liquida_total ?? fin.total_revenue ?? grossRev);
    const totalCost = Number(fin.custo_total ?? fin.total_cost ?? 0);
    const profit = Number(fin.lucro_operacional_total ?? fin.gross_margin ?? netRev - totalCost);
    const marginPct = Number(fin.margem_liquida_pct ?? fin.gross_margin_percentage ?? 0);

    const sc1 = Number(esg.scope1_co2e_tons ?? 0);
    const sc2 = Number(esg.scope2_co2e_tons ?? 0);
    const sc3 = Number(esg.scope3_co2e_tons ?? 0);
    const totalGross = Number(
      esg.total_gross_emissions_co2e_tons ?? esg.total_emissions_co2e_tons ?? sc1 + sc2 + sc3
    );
    const credits = Number(esg.carbon_credits_acquired_tco2e ?? esg.creditos_carbono_tco2e ?? 0);
    const recPct = Number(esg.taxa_reciclagem_pct ?? 0);
    const revLogPct = Number(op.taxa_logistica_reversa_pct ?? 0);
    const engInt = Number(esg.intensidade_energetica_kwh_por_mil_brl ?? 0);
    const carbInt = Number(esg.carbon_intensity_kg_per_brl_revenue ?? 0);

    const elGross = document.getElementById("fin-res-gross-rev");
    const elNet = document.getElementById("fin-res-net-rev");
    const elCost = document.getElementById("fin-res-total-cost");
    const elProfit = document.getElementById("fin-res-profit");

    if (elGross) elGross.textContent = formatCurrency(grossRev);
    if (elNet) elNet.textContent = formatCurrency(netRev);
    if (elCost) elCost.textContent = formatCurrency(totalCost);
    if (elProfit) elProfit.textContent = `${formatCurrency(profit)} (${formatNumber(marginPct, 1)}%)`;

    const elSc1 = document.getElementById("esg-res-scope1");
    const elSc2 = document.getElementById("esg-res-scope2");
    const elSc3 = document.getElementById("esg-res-scope3");
    const elTot = document.getElementById("esg-res-total-gross");
    const bar1 = document.getElementById("esg-bar-scope1");
    const bar2 = document.getElementById("esg-bar-scope2");
    const bar3 = document.getElementById("esg-bar-scope3");

    const denom = totalGross > 0 ? totalGross : 1;
    if (elSc1) elSc1.textContent = `${formatNumber(sc1, 3)} tCO2e (${formatNumber((sc1 / denom) * 100, 1)}%)`;
    if (elSc2) elSc2.textContent = `${formatNumber(sc2, 3)} tCO2e (${formatNumber((sc2 / denom) * 100, 1)}%)`;
    if (elSc3) elSc3.textContent = `${formatNumber(sc3, 3)} tCO2e (${formatNumber((sc3 / denom) * 100, 1)}%)`;
    if (elTot) elTot.textContent = `${formatNumber(totalGross, 3)} tCO2e`;

    if (bar1) bar1.style.width = `${Math.min(100, (sc1 / denom) * 100)}%`;
    if (bar2) bar2.style.width = `${Math.min(100, (sc2 / denom) * 100)}%`;
    if (bar3) bar3.style.width = `${Math.min(100, (sc3 / denom) * 100)}%`;

    const elCred = document.getElementById("esg-res-credits");
    const elRec = document.getElementById("esg-res-recycling");
    const elRev = document.getElementById("esg-res-rev-logistics");
    const elEngInt = document.getElementById("esg-res-energy-int");
    const elCarbInt = document.getElementById("esg-res-carbon-int");

    if (elCred) elCred.textContent = `${formatNumber(credits, 2)} tCO2e`;
    if (elRec) elRec.textContent = `${formatNumber(recPct, 1)}%`;
    if (elRev) elRev.textContent = `${formatNumber(revLogPct, 2)}%`;
    if (elEngInt) elEngInt.textContent = `${formatNumber(engInt, 2)} kWh/mil R$`;
    if (elCarbInt) elCarbInt.textContent = `${formatNumber(carbInt, 4)} kg/R$`;

    const stepAst = document.getElementById("step-status-assistant");
    if (stepAst) stepAst.textContent = `${formatNumber(totalGross, 1)} tCO2e bruto`;
  }

  async function sendAssistantMessage(userMessage) {
    if (!userMessage || !userMessage.trim()) return;
    const cleanMsg = userMessage.trim();
    const projectId = await ensureActiveProjectForAction();
    const selectedModel = document.getElementById("assistant-model-select")?.value || "qwen3.5:4b";

    appendChatMessage("user", cleanMsg, { model: selectedModel });
    state.chatHistory.push({ role: "user", content: cleanMsg });

    try {
      const res = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/assistant`, {
        method: "POST",
        body: JSON.stringify({
          message: cleanMsg,
          prompt: cleanMsg,
          dataset_id: state.activeDatasetId || undefined,
          model_name: selectedModel,
          conversation_history: state.chatHistory.slice(-8),
        }),
      });

      const replyText = res.response || res.answer || res.explanation || "Solicitação processada.";
      const toolsCalled = res.tools_called || res.tool_calls || [];
      const modelUsed = res.model_used || selectedModel;
      const isFallback =
        res.ollama_status === "offline" ||
        res.execution_mode === "deterministic_local_fallback" ||
        String(modelUsed).includes("fallback");

      const fallbackBanner = document.getElementById("assistant-fallback-banner");
      if (fallbackBanner) {
        fallbackBanner.hidden = !isFallback;
      }

      appendChatMessage("assistant", replyText, {
        model: modelUsed,
        toolsCalled: toolsCalled,
        isFallback: isFallback,
      });

      state.chatHistory.push({ role: "assistant", content: replyText });

      // Se alguma tool calculou KPIs ou predições, sincroniza com a UI
      toolsCalled.forEach((tc) => {
        if (tc.tool_name === "calculate_financial_esg_kpis" && tc.result) {
          state.financialEsgAnalysis = tc.result;
          renderFinancialEsgResults(tc.result);
        } else if (tc.tool_name === "run_predictive_model" && tc.result) {
          state.predictiveAnalysis = tc.result;
          renderPredictiveResults(tc.result);
        }
      });

      updateDashboardKPIs();
      await loadValidations(true);
    } catch (err) {
      appendChatMessage(
        "assistant",
        `Bloqueio de segurança ou erro na execução: ${err.message}`,
        { model: "security_guard", isError: true }
      );
    }
  }

  function appendChatMessage(role, text, meta = {}) {
    const log = document.getElementById("assistant-chat-log");
    if (!log) return;

    const div = document.createElement("div");
    div.className = `chat-msg ${role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`;

    const authorLabel = role === "user" ? state.operatorName || "Operador" : "Assistente EcoBI";
    const badgeClass = meta.isError
      ? "badge-rejected"
      : meta.isFallback
      ? "badge-warning"
      : "badge-mint";
    const badgeLabel = meta.isError
      ? "Bloqueado"
      : meta.isFallback
      ? "Fallback Determinístico Local"
      : meta.model || "qwen3.5:4b";

    let toolsHtml = "";
    if (Array.isArray(meta.toolsCalled) && meta.toolsCalled.length > 0) {
      toolsHtml = meta.toolsCalled
        .map((t) => {
          const argsStr = JSON.stringify(t.arguments || {});
          return `
            <div class="tool-call-card">
              <strong>Tool Executada:</strong> <code>${escapeHtml(t.tool_name || t.name)}</code><br>
              <span>Argumentos validados (Pydantic): ${escapeHtml(argsStr)}</span>
            </div>
          `;
        })
        .join("");
    }

    div.innerHTML = `
      <div class="chat-msg-meta">
        <strong>${escapeHtml(authorLabel)}</strong>
        <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      </div>
      <p>${escapeHtml(text)}</p>
      ${toolsHtml}
    `;

    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ==========================================================================
  // 11. TELA 6: RESULTADOS PREDITIVOS & GRÁFICO SVG RESPONSIVO
  // ==========================================================================
  async function executePredictiveAnalysis(e) {
    if (e) e.preventDefault();
    try {
      const projectId = await ensureActiveProjectForAction();
      if (!state.activeDatasetId) {
        await loadSampleDataset("piloto", "Piloto Varejo Sustentável");
      }

      const targetCol = document.getElementById("pred-target-col")?.value || "receita_bruta";
      const modelType = document.getElementById("pred-model-type")?.value || "ridge";
      const horizon = Number(document.getElementById("pred-horizon")?.value || 6);

      setInlineFeedback(
        "predictive-feedback",
        `Treinando modelo ${modelType} para '${targetCol}' com split cronológico e backtesting...`
      );

      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/analyze/predictive`,
        {
          method: "POST",
          body: JSON.stringify({
            dataset_id: state.activeDatasetId,
            target_column: targetCol,
            target_col: targetCol,
            time_column: "periodo",
            time_col: "periodo",
            feature_columns: ["unidades_vendidas", "custo_variavel", "energia_kwh", "combustivel_litros"],
            model_type: modelType,
            forecast_horizon_periods: horizon,
            horizon: horizon,
          }),
        }
      );

      state.predictiveAnalysis = res;
      renderPredictiveResults(res);
      await loadValidations(true);

      const isSuperior = res.baseline_comparison_status === "SUPERIOR_AO_BASELINE";
      setInlineFeedback(
        "predictive-feedback",
        `Modelagem concluída: ${res.baseline_comparison_status}. WAPE Modelo: ${formatNumber(
          (res.metrics?.model_wape ?? 0) * 100,
          2
        )}% vs Baseline: ${formatNumber((res.metrics?.baseline_wape ?? 0) * 100, 2)}%.`,
        !isSuperior
      );
      showToast(`Análise preditiva (${modelType}) concluída.`);
    } catch (err) {
      setInlineFeedback("predictive-feedback", `Falha na modelagem preditiva: ${err.message}`, true);
      showToast(`Erro preditivo: ${err.message}`, true);
    }
  }

  function renderPredictiveResults(res) {
    if (!res) return;
    const metrics = res.metrics || {};
    const split = res.temporal_split || {};
    const forecast = res.forecast || [];
    const status = res.baseline_comparison_status || "SUPERIOR_AO_BASELINE";
    const isSuperior = status === "SUPERIOR_AO_BASELINE";

    const badgeEl = document.getElementById("pred-baseline-badge");
    const valBadgeEl = document.getElementById("pred-validation-badge");
    const splitSummary = document.getElementById("pred-split-summary");
    const stepPred = document.getElementById("step-status-predictive");

    if (badgeEl) {
      badgeEl.textContent = status;
      badgeEl.className = `badge ${isSuperior ? "badge-approved" : "badge-rejected"}`;
    }
    if (valBadgeEl) {
      valBadgeEl.textContent = isSuperior ? "APROVADO (Supera Baseline)" : "REJEITADO (WAPE >= Baseline)";
      valBadgeEl.className = `badge ${isSuperior ? "badge-mint" : "badge-rejected"}`;
    }
    if (splitSummary && split.train_start) {
      splitSummary.textContent = `Treino: ${split.train_start} a ${split.train_end} (${
        split.train_samples || "--"
      } obs) | Teste Holdout: ${split.test_start} a ${split.test_end} (${
        split.test_samples || "--"
      } obs) · Zero Data Leakage`;
    }
    if (stepPred) {
      stepPred.textContent = isSuperior
        ? `WAPE ${formatNumber((metrics.model_wape ?? 0) * 100, 1)}%`
        : "Rejeitado";
    }

    // Tabela comparativa de métricas
    const metricsTbody = document.getElementById("predictive-metrics-tbody");
    if (metricsTbody) {
      const modWapePct = (metrics.model_wape ?? 0) * 100;
      const baseWapePct = (metrics.baseline_wape ?? 0) * 100;
      const gainPct = metrics.wape_improvement_pct ?? 0;

      metricsTbody.innerHTML = `
        <tr>
          <td><strong>WAPE (Erro Percentual Absoluto Ponderado)</strong></td>
          <td><strong>${formatNumber(modWapePct, 2)}%</strong> (${formatNumber(metrics.model_wape, 4)})</td>
          <td>${formatNumber(baseWapePct, 2)}% (${formatNumber(metrics.baseline_wape, 4)})</td>
          <td>
            <span class="badge ${isSuperior ? "badge-approved" : "badge-rejected"}">
              ${isSuperior ? `Melhoria de +${formatNumber(gainPct, 1)}%` : "Inferior ao Baseline"}
            </span>
          </td>
        </tr>
        <tr>
          <td><strong>MAE (Erro Absoluto Médio)</strong></td>
          <td>${formatNumber(metrics.model_mae, 2)}</td>
          <td>${formatNumber(metrics.baseline_mae, 2)}</td>
          <td><span class="badge badge-neutral">Escala da variável</span></td>
        </tr>
        <tr>
          <td><strong>RMSE (Raiz do Erro Quadrático Médio)</strong></td>
          <td>${formatNumber(metrics.model_rmse, 2)}</td>
          <td>${formatNumber(metrics.baseline_rmse, 2)}</td>
          <td><span class="badge badge-neutral">Penaliza desvios extremos</span></td>
        </tr>
        <tr>
          <td><strong>Bias (Viés Médio de Estimação)</strong></td>
          <td>${formatNumber(metrics.model_bias ?? 0, 2)}</td>
          <td>0,00 (Referência)</td>
          <td><span class="badge badge-mint">Razão de viés: ${formatNumber((metrics.bias_ratio ?? 0) * 100, 1)}%</span></td>
        </tr>
      `;
    }

    // Tabela de projeções futuras
    const forecastTbody = document.getElementById("predictive-forecast-tbody");
    if (forecastTbody) {
      if (forecast.length === 0) {
        forecastTbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Série insuficiente para projeção futura.</td></tr>`;
      } else {
        forecastTbody.innerHTML = forecast
          .map(
            (f) => `
            <tr>
              <td><strong>${escapeHtml(f.period)}</strong></td>
              <td><strong>${formatNumber(f.predicted_value, 2)}</strong></td>
              <td>${formatNumber(f.ci_lower_90, 2)}</td>
              <td>${formatNumber(f.ci_upper_90, 2)}</td>
            </tr>
          `
          )
          .join("");
      }
    }

    renderPredictiveChart();
  }

  function renderPredictiveChart() {
    const container = document.getElementById("predictive-svg-container");
    if (!container) return;

    const pred = state.predictiveAnalysis;
    const targetCol = pred?.target_column || document.getElementById("pred-target-col")?.value || "receita_bruta";

    // Extrai série histórica do sampleData ou monthly_series da análise financeira
    let histPoints = [];
    if (state.financialEsgAnalysis && Array.isArray(state.financialEsgAnalysis.monthly_series)) {
      histPoints = state.financialEsgAnalysis.monthly_series
        .map((m) => ({
          period: m.periodo,
          value: Number(m[targetCol] ?? m.receita_bruta ?? 0),
        }))
        .filter((p) => Number.isFinite(p.value) && p.value > 0);
    } else if (state.sampleData && Array.isArray(state.sampleData.rows)) {
      histPoints = state.sampleData.rows
        .map((r) => ({
          period: r.periodo || "",
          value: Number(r[targetCol] ?? r.receita_bruta ?? 0),
        }))
        .filter((p) => Number.isFinite(p.value) && p.value > 0);
    }

    const forecastPoints = (pred && Array.isArray(pred.forecast) ? pred.forecast : []).map((f) => ({
      period: f.period,
      value: Number(f.predicted_value),
      low: Number(f.ci_lower_90),
      high: Number(f.ci_upper_90),
    }));

    if (histPoints.length === 0 && forecastPoints.length === 0) {
      container.innerHTML = `
        <p class="empty-state-text">Clique em "Treinar &amp; Avaliar Modelo" acima para renderizar o gráfico SVG da série histórica, previsão e faixa de incerteza de 90%.</p>
      `;
      return;
    }

    const width = 860;
    const height = 300;
    const padLeft = 72;
    const padRight = 32;
    const padTop = 26;
    const padBottom = 44;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const totalPoints = histPoints.length + forecastPoints.length;
    const allValues = [
      ...histPoints.map((p) => p.value),
      ...forecastPoints.flatMap((f) => [f.value, f.low, f.high]),
    ].filter(Number.isFinite);

    const minVal = Math.min(...allValues) * 0.9;
    const maxVal = Math.max(...allValues) * 1.08;
    const valSpan = maxVal - minVal > 0 ? maxVal - minVal : 1;

    const xForIdx = (idx) =>
      padLeft + (totalPoints > 1 ? (idx / (totalPoints - 1)) * plotW : plotW / 2);
    const yForVal = (v) => padTop + plotH - ((v - minVal) / valSpan) * plotH;

    // Polígono do Intervalo de Confiança 90%
    let ciPolygonSvg = "";
    if (forecastPoints.length > 0) {
      const startIdx = Math.max(0, histPoints.length - 1);
      const anchorVal = histPoints.length > 0 ? histPoints[histPoints.length - 1].value : forecastPoints[0].value;
      const upperCoords = [`${xForIdx(startIdx).toFixed(1)},${yForVal(anchorVal).toFixed(1)}`];
      const lowerCoords = [`${xForIdx(startIdx).toFixed(1)},${yForVal(anchorVal).toFixed(1)}`];

      forecastPoints.forEach((fp, i) => {
        const idx = histPoints.length + i;
        upperCoords.push(`${xForIdx(idx).toFixed(1)},${yForVal(fp.high).toFixed(1)}`);
        lowerCoords.unshift(`${xForIdx(idx).toFixed(1)},${yForVal(fp.low).toFixed(1)}`);
      });

      ciPolygonSvg = `<polygon points="${[...upperCoords, ...lowerCoords].join(
        " "
      )}" fill="#B9D6C2" fill-opacity="0.55" stroke="#4F7A59" stroke-width="1" stroke-dasharray="3,3" />`;
    }

    // Linha histórica
    const histPolyPoints = histPoints
      .map((p, idx) => `${xForIdx(idx).toFixed(1)},${yForVal(p.value).toFixed(1)}`)
      .join(" ");

    // Linha prevista + linha Naive Baseline (persistência do último valor histórico)
    let forecastPolyPoints = "";
    let baselineLineSvg = "";
    let splitLineSvg = "";

    if (forecastPoints.length > 0) {
      const fcCoords = [];
      if (histPoints.length > 0) {
        const lastIdx = histPoints.length - 1;
        const lastVal = histPoints[lastIdx].value;
        fcCoords.push(`${xForIdx(lastIdx).toFixed(1)},${yForVal(lastVal).toFixed(1)}`);

        const splitX = xForIdx(lastIdx).toFixed(1);
        splitLineSvg = `
          <line x1="${splitX}" y1="${padTop}" x2="${splitX}" y2="${padTop + plotH}" stroke="#183A32" stroke-width="1.4" stroke-dasharray="4,4" />
          <text x="${Number(splitX) + 6}" y="${padTop + 14}" font-size="10" font-weight="700" fill="#183A32">Início da Projeção (IC 90%)</text>
        `;

        const baseY = yForVal(lastVal).toFixed(1);
        const endX = xForIdx(totalPoints - 1).toFixed(1);
        baselineLineSvg = `<line x1="${splitX}" y1="${baseY}" x2="${endX}" y2="${baseY}" stroke="#C8784A" stroke-width="2" stroke-dasharray="5,4" />`;
      }

      forecastPoints.forEach((fp, i) => {
        const idx = histPoints.length + i;
        fcCoords.push(`${xForIdx(idx).toFixed(1)},${yForVal(fp.value).toFixed(1)}`);
      });
      forecastPolyPoints = fcCoords.join(" ");
    }

    // Linhas de grade horizontais
    const gridTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const val = minVal + t * valSpan;
      const y = yForVal(val).toFixed(1);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#DCE8D9" stroke-width="1" />
        <text x="${padLeft - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="10" fill="#35544B">${formatNumber(
        val,
        0
      )}</text>
      `;
    });

    // Rótulos do eixo X
    const allLabels = [
      ...histPoints.map((p) => p.period),
      ...forecastPoints.map((f) => f.period),
    ];
    const stepX = Math.max(1, Math.floor(allLabels.length / 8));
    const xLabelsSvg = allLabels
      .map((lbl, idx) => {
        if (idx % stepX !== 0 && idx !== allLabels.length - 1) return "";
        const x = xForIdx(idx).toFixed(1);
        return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="10" fill="#35544B">${escapeHtml(
          lbl
        )}</text>`;
      })
      .join("");

    const histCircles = histPoints
      .map(
        (p, idx) =>
          `<circle cx="${xForIdx(idx).toFixed(1)}" cy="${yForVal(p.value).toFixed(
            1
          )}" r="3.2" fill="#183A32"><title>${escapeHtml(p.period)}: ${formatNumber(p.value, 2)}</title></circle>`
      )
      .join("");

    const fcCircles = forecastPoints
      .map((fp, i) => {
        const idx = histPoints.length + i;
        return `<circle cx="${xForIdx(idx).toFixed(1)}" cy="${yForVal(fp.value).toFixed(
          1
        )}" r="4" fill="#4F7A59" stroke="#FFFFFF" stroke-width="1.2"><title>${escapeHtml(
          fp.period
        )} Previsto: ${formatNumber(fp.value, 2)} [IC90%: ${formatNumber(fp.low, 2)} a ${formatNumber(
          fp.high,
          2
        )}]</title></circle>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="predictive-svg" role="img" aria-label="Série temporal histórica e previsão com intervalo de confiança de 90%">
        ${gridTicks.join("")}
        ${ciPolygonSvg}
        ${splitLineSvg}
        ${baselineLineSvg}
        ${
          histPolyPoints
            ? `<polyline fill="none" stroke="#183A32" stroke-width="2.5" points="${histPolyPoints}" />`
            : ""
        }
        ${
          forecastPolyPoints
            ? `<polyline fill="none" stroke="#4F7A59" stroke-width="2.8" points="${forecastPolyPoints}" />`
            : ""
        }
        ${histCircles}
        ${fcCircles}
        ${xLabelsSvg}
      </svg>
    `;
  }

  // ==========================================================================
  // 12. TELA 7: SIMULADOR FINANCEIRO & SOCIOAMBIENTAL (4 BLOCOS SEPARADOS)
  // ==========================================================================
  function bindSimulatorSliders() {
    const pairs = [
      ["sim-cost-slider", "sim-cost-input"],
      ["sim-energy-slider", "sim-energy-input"],
      ["sim-demand-slider", "sim-demand-input"],
      ["sim-logistics-slider", "sim-logistics-input"],
      ["sim-reverse-slider", "sim-reverse-input"],
    ];

    pairs.forEach(([sliderId, inputId]) => {
      const slider = document.getElementById(sliderId);
      const input = document.getElementById(inputId);
      if (!slider || !input) return;

      slider.addEventListener("input", () => {
        input.value = slider.value;
      });
      input.addEventListener("input", () => {
        slider.value = input.value;
      });
    });
  }

  async function executeSimulation(e) {
    if (e) e.preventDefault();
    try {
      const projectId = await ensureActiveProjectForAction();
      if (!state.financialEsgAnalysis) {
        await executeFinancialEsgAnalysis();
      }

      const baseAnalysisId =
        state.financialEsgAnalysis?.analysis_id || state.financialEsgAnalysis?.id || "";

      const readNum = (id, fallback) => {
        const raw = document.getElementById(id)?.value;
        return raw !== undefined && raw !== "" ? Number(raw) : fallback;
      };
      const costVal = readNum("sim-cost-input", -10);
      const energyVal = readNum("sim-energy-input", -15);
      const demandVal = readNum("sim-demand-input", 8);
      const logisticsVal = readNum("sim-logistics-input", -12);
      const reverseVal = readNum("sim-reverse-input", 20);

      setInlineFeedback("simulator-feedback", "Calculando sensibilidade paramétrica nos 4 blocos...");

      // UI usa sinal negativo (-10%) para reduções; backend espera reduction_pct positivo (10%)
      const variationsPayload = {
        cost_reduction_pct: -costVal,
        electricity_reduction_pct: -energyVal,
        energy_reduction_pct: -energyVal,
        fuel_reduction_pct: -logisticsVal,
        fuel_efficiency_gain_pct: -logisticsVal,
        demand_change_pct: demandVal,
        demand_variation_pct: demandVal,
        logistics_optimization_pct: -logisticsVal,
        reverse_logistics_adoption_pct: reverseVal,
        reverse_logistics_rate_pct: reverseVal,
      };

      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/simulate`,
        {
          method: "POST",
          body: JSON.stringify({
            base_analysis_id: baseAnalysisId,
            dataset_id: state.activeDatasetId,
            variations: variationsPayload,
            ...variationsPayload,
          }),
        }
      );

      state.simulationResult = res;
      renderSimulationResults(res);
      await loadValidations(true);

      setInlineFeedback("simulator-feedback", "Simulação What-If concluída com 4 blocos segregados.");
      showToast("Cenário What-If calculado e registrado!");
    } catch (err) {
      setInlineFeedback("simulator-feedback", `Erro na simulação: ${err.message}`, true);
      showToast(`Erro no simulador: ${err.message}`, true);
    }
  }

  function renderSimulationResults(res) {
    if (!res) return;
    const hist = res.historical_values || {};
    const fc = res.forecast_values || {};
    const sim = res.simulated_scenario || {};
    const obs = res.observed_impacts || {};

    const histBox = document.getElementById("sim-historical-content");
    const fcBox = document.getElementById("sim-forecast-content");
    const simBox = document.getElementById("sim-simulated-content");
    const impBox = document.getElementById("sim-impacts-content");
    const disclaimerSpan = document.getElementById("sim-disclaimer-text");
    const assumptionsUl = document.getElementById("sim-assumptions-list");
    const stepSim = document.getElementById("step-status-simulator");

    const histRev = Number(hist.receita_liquida_total ?? hist.revenue ?? 0);
    const histCost = Number(hist.custo_total ?? hist.cost ?? 0);
    const histProfit = Number(hist.lucro_operacional_total ?? histRev - histCost);
    const histEmiss = Number(hist.total_gross_emissions_co2e_tons ?? 0);
    const histRec = Number(hist.taxa_reciclagem_pct ?? 0);

    if (histBox) {
      histBox.innerHTML = `
        <div class="metric-row"><span>Receita Líquida Realizada:</span><strong>${formatCurrency(histRev)}</strong></div>
        <div class="metric-row"><span>Custos Operacionais:</span><strong>${formatCurrency(histCost)}</strong></div>
        <div class="metric-row"><span>Lucro Operacional:</span><strong>${formatCurrency(histProfit)}</strong></div>
        <div class="metric-row"><span>Emissões Brutas GEE:</span><strong>${formatNumber(histEmiss, 3)} tCO2e</strong></div>
        <div class="metric-row"><span>Taxa de Reciclagem:</span><strong>${formatNumber(histRec, 1)}%</strong></div>
      `;
    }

    const fcRev = Number(fc.baseline_revenue_brl ?? histRev);
    const fcCost = Number(fc.baseline_cost_brl ?? histCost);
    const fcProfit = Number(fc.baseline_profit_brl ?? histProfit);
    const fcEmiss = Number(fc.baseline_emissions_co2e_tons ?? histEmiss);

    if (fcBox) {
      fcBox.innerHTML = `
        <div class="metric-row"><span>Receita Inercial Prevista:</span><strong>${formatCurrency(fcRev)}</strong></div>
        <div class="metric-row"><span>Custos Inerciais Previstos:</span><strong>${formatCurrency(fcCost)}</strong></div>
        <div class="metric-row"><span>Lucro Inercial Previsto:</span><strong>${formatCurrency(fcProfit)}</strong></div>
        <div class="metric-row"><span>Emissões Inerciais:</span><strong>${formatNumber(fcEmiss, 3)} tCO2e</strong></div>
        <div class="metric-row"><span>Base de Referência:</span><strong>Sem intervenção</strong></div>
      `;
    }

    const simRev = Number(sim.projected_revenue_brl ?? histRev);
    const simCost = Number(sim.projected_cost_brl ?? histCost);
    const simProfit = Number(sim.projected_profit_brl ?? simRev - simCost);
    const simEmiss = Number(
      sim.projected_total_gross_emissions_co2e_tons ?? res.new_projected_total_emissions_co2e_tons ?? histEmiss
    );
    const simRec = Number(sim.projected_recycling_rate_pct ?? histRec);

    if (simBox) {
      simBox.innerHTML = `
        <div class="metric-row"><span>Receita Simulada (What-If):</span><strong>${formatCurrency(simRev)}</strong></div>
        <div class="metric-row"><span>Custos Simulados:</span><strong>${formatCurrency(simCost)}</strong></div>
        <div class="metric-row"><span>Lucro Operacional Simulado:</span><strong>${formatCurrency(simProfit)}</strong></div>
        <div class="metric-row"><span>Emissões Brutas Simuladas:</span><strong>${formatNumber(simEmiss, 3)} tCO2e</strong></div>
        <div class="metric-row"><span>Taxa de Reciclagem Simulada:</span><strong>${formatNumber(simRec, 1)}%</strong></div>
      `;
    }

    const costSavings = Number(sim.projected_cost_savings_brl ?? res.projected_cost_savings ?? histCost - simCost);
    const profitDelta = simProfit - histProfit;
    const emissAvoided = Number(
      sim.projected_emissions_avoided_co2e_tons ?? res.projected_emissions_avoided_co2e_tons ?? Math.max(0, histEmiss - simEmiss)
    );
    const obsStatus = obs.status || "not_observed_yet";

    if (impBox) {
      impBox.innerHTML = `
        <div class="metric-row"><span>Economia / Redução de Custo:</span><strong>${formatCurrency(costSavings)}</strong></div>
        <div class="metric-row"><span>Delta no Lucro Operacional:</span><strong>${formatCurrency(profitDelta)}</strong></div>
        <div class="metric-row"><span>Emissões GEE Evitadas:</span><strong>${formatNumber(emissAvoided, 3)} tCO2e</strong></div>
        <div class="metric-row"><span>Status Empírico Pós-Ação:</span><strong>${escapeHtml(obsStatus)}</strong></div>
        <div class="metric-row"><span>Rastreabilidade:</span><strong>Condicional às premissas</strong></div>
      `;
    }

    if (disclaimerSpan && res.causal_disclaimer) {
      disclaimerSpan.textContent = res.causal_disclaimer;
    }

    if (assumptionsUl && Array.isArray(res.assumptions) && res.assumptions.length > 0) {
      assumptionsUl.innerHTML = res.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join("");
    }

    if (stepSim) {
      stepSim.textContent = `-${formatNumber(emissAvoided, 1)} tCO2e`;
    }
  }

  // ==========================================================================
  // 13. TELA 8: CENTRAL DE VALIDAÇÃO
  // ==========================================================================
  async function loadValidations(silent = false) {
    if (!state.activeProjectId) return;
    const projectId = state.activeProjectId;
    try {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/validations`
      );
      if (projectId !== state.activeProjectId) return;
      const list = Array.isArray(res) ? res : res.validations || (res.validation_id || res.id ? [res] : []);
      state.validations = list;
      renderValidationsView(list);
      updateDashboardKPIs();
    } catch (err) {
      if (!silent) {
        showToast(`Aviso ao consultar validações: ${err.message}`, true);
      }
    }
  }

  function renderValidationsView(validations) {
    const list = Array.isArray(validations) ? validations : [];
    const approvedCount = list.filter((v) => v.status === "APROVADO").length;
    const caveatsCount = list.filter((v) => v.status === "APROVADO_COM_RESSALVAS").length;
    const rejectedCount = list.filter((v) => v.status === "REJEITADO").length;

    const elApp = document.getElementById("val-count-approved");
    const elCav = document.getElementById("val-count-caveats");
    const elRej = document.getElementById("val-count-rejected");
    const stepVal = document.getElementById("step-status-validation");

    if (elApp) elApp.textContent = String(approvedCount);
    if (elCav) elCav.textContent = String(caveatsCount);
    if (elRej) elRej.textContent = String(rejectedCount);
    if (stepVal) {
      stepVal.textContent = `${approvedCount + caveatsCount} aprov. | ${rejectedCount} rej.`;
    }

    // Popula seletor de análises para revalidação manual
    const select = document.getElementById("validation-analysis-select");
    if (select) {
      const knownIds = new Set();
      const options = [];

      list.forEach((v) => {
        if (v.analysis_id && !knownIds.has(v.analysis_id)) {
          knownIds.add(v.analysis_id);
          options.push(
            `<option value="${escapeHtml(v.analysis_id)}">${escapeHtml(v.analysis_id)} — Status atual: ${escapeHtml(
              v.status
            )}</option>`
          );
        }
      });

      [state.financialEsgAnalysis, state.predictiveAnalysis, state.simulationResult].forEach((an) => {
        const aid = an && (an.analysis_id || an.id || an.simulation_id);
        if (aid && !knownIds.has(aid)) {
          knownIds.add(aid);
          options.push(`<option value="${escapeHtml(aid)}">${escapeHtml(aid)} (Nova Análise)</option>`);
        }
      });

      select.innerHTML =
        options.length > 0
          ? options.join("")
          : `<option value="">Execute uma análise primeiro...</option>`;
    }

    const container = document.getElementById("validations-list-container");
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = `
        <article class="surface-panel">
          <p class="empty-state-text">Nenhum laudo emitido para este projeto ainda. Execute a análise Financeira/ESG, Preditiva ou Simulador.</p>
        </article>
      `;
      return;
    }

    container.innerHTML = list
      .map((v) => {
        const status = v.status || "APROVADO";
        const isRej = status === "REJEITADO";
        const isCav = status === "APROVADO_COM_RESSALVAS";
        const cardClass = isRej ? "is-rejected" : isCav ? "is-caveats" : "is-approved";
        const badgeClass = isRej ? "badge-rejected" : isCav ? "badge-warning" : "badge-approved";

        const rules = safeJsonParse(v.rules_checked || v.rules_json || v.rules, []);
        const discrepancies = safeJsonParse(v.discrepancies || v.discrepancies_json, []);
        const caveats = safeJsonParse(v.caveats || v.caveats_json, []);
        const esgMeth = safeJsonParse(v.esg_methodology || v.esg_methodology_json, {});

        const rulesHtml = Array.isArray(rules)
          ? rules
              .map((r) => {
                const rStat = String(r.status || "PASSED").toUpperCase();
                const rBadge =
                  rStat === "FAILED"
                    ? "badge-rejected"
                    : rStat === "WARNING"
                    ? "badge-warning"
                    : "badge-approved";
                return `
                  <div class="rule-pill">
                    <div class="kpi-card-top">
                      <strong>${escapeHtml(r.rule || "REGRA")}</strong>
                      <span class="badge ${rBadge}">${escapeHtml(rStat)}</span>
                    </div>
                    <span>${escapeHtml(r.description || r.details || "Verificação determinística")}</span>
                    ${r.details ? `<small class="field-help">${escapeHtml(r.details)}</small>` : ""}
                  </div>
                `;
              })
              .join("")
          : "";

        const discHtml =
          Array.isArray(discrepancies) && discrepancies.length > 0
            ? `<div class="alert-banner alert-danger" style="margin-top: 10px;">
                <div><strong>Discrepâncias Detectadas (${discrepancies.length}):</strong> ${escapeHtml(
                JSON.stringify(discrepancies)
              )}</div>
              </div>`
            : "";

        const cavHtml =
          Array.isArray(caveats) && caveats.length > 0
            ? `<div class="alert-banner alert-warning" style="margin-top: 10px;">
                <div><strong>Ressalvas Metodológicas:</strong> ${escapeHtml(caveats.join(" | "))}</div>
              </div>`
            : "";

        return `
          <article class="validation-card ${cardClass}">
            <div class="panel-header">
              <div>
                <span class="eyebrow">LAUDO OFICIAL #${escapeHtml(v.validation_id || v.id || "VAL")}</span>
                <h3 class="panel-title">Análise Auditada: <code>${escapeHtml(v.analysis_id)}</code></h3>
                <p class="panel-subtitle">${escapeHtml(
                  v.summary || "Auditoria determinística executada pelo Validation Engine."
                )}</p>
              </div>
              <div class="panel-header-badges">
                <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
                <span class="badge ${isRej ? "badge-rejected" : "badge-mint"}">
                  ${isRej ? "BLOQUEADO PARA POWER BI" : "AUTORIZADO PARA POWER BI"}
                </span>
              </div>
            </div>
            <div class="rules-grid">${rulesHtml}</div>
            ${discHtml}
            ${cavHtml}
            <div class="provenance-bar" style="margin-top: 12px;">
              <span><strong>Metodologia ESG:</strong> ${escapeHtml(
                esgMeth.protocol || "GHG Protocol Corporate Standard · Créditos Separados"
              )}</span>
              <span><strong>Auditado em:</strong> ${escapeHtml(formatDateShort(v.validated_at || v.created_at))}</span>
            </div>
          </article>
        `;
      })
      .join("");

    renderPowerbiChecklist();
  }

  // ==========================================================================
  // 14. TELA 9: RELATÓRIOS POWER BI (.PBIP / .PBIR / DAX / DOWNLOAD .ZIP)
  // ==========================================================================
  async function loadPowerbiView() {
    await Promise.all([loadValidations(true), loadPowerbiReportsList(true)]);
    renderPowerbiChecklist();
  }

  function renderPowerbiChecklist() {
    const container = document.getElementById("powerbi-analyses-checklist");
    if (!container) return;

    const list = state.validations || [];
    if (list.length === 0) {
      container.innerHTML = `<p class="empty-state-text">Nenhuma análise validada disponível. Execute uma análise e valide-a primeiro.</p>`;
      return;
    }

    container.innerHTML = list
      .map((v) => {
        const isRejected = v.status === "REJEITADO";
        const badgeClass = isRejected
          ? "badge-rejected"
          : v.status === "APROVADO_COM_RESSALVAS"
          ? "badge-warning"
          : "badge-approved";

        return `
          <div class="pbi-analysis-item ${isRejected ? "is-blocked" : ""}">
            <label class="pbi-analysis-label" for="pbi-chk-${escapeHtml(v.analysis_id)}">
              <input
                type="checkbox"
                id="pbi-chk-${escapeHtml(v.analysis_id)}"
                class="pbi-analysis-checkbox"
                value="${escapeHtml(v.analysis_id)}"
                data-status="${escapeHtml(v.status)}"
                ${isRejected ? "disabled" : "checked"}
              >
              <span>Análise <code>${escapeHtml(v.analysis_id)}</code></span>
            </label>
            <div class="panel-header-badges">
              <span class="badge ${badgeClass}">${escapeHtml(v.status)}</span>
              ${
                isRejected
                  ? `<span class="badge badge-rejected" title="Análises REJEITADAS são bloqueadas pelo Validation Engine">BLOQUEADO (Hard Gate)</span>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");
  }

  async function generatePowerbiReport(e) {
    if (e) e.preventDefault();
    try {
      const projectId = await ensureActiveProjectForAction();
      const title =
        document.getElementById("powerbi-report-title")?.value.trim() ||
        "EcoBI - Relatório Executivo ESG & Finanças 2026";

      const checkedBoxes = Array.from(
        document.querySelectorAll(".pbi-analysis-checkbox:checked")
      );
      let analysisIds = checkedBoxes.map((cb) => cb.value);

      if (analysisIds.length === 0) {
        // Se não havia análise ainda, executa a financeira/ESG automaticamente para viabilizar o fluxo
        const finRes = await executeFinancialEsgAnalysis();
        if (finRes && (finRes.analysis_id || finRes.id)) {
          analysisIds = [finRes.analysis_id || finRes.id];
        }
      }

      setInlineFeedback("powerbi-feedback", "Compilando projeto PBIP/PBIR, medidas DAX e pacote .zip...");

      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/powerbi/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            report_title: title,
            report_name: title,
            analysis_ids: analysisIds,
          }),
        }
      );

      state.latestPowerbiResult = res;
      renderPowerbiLatestDetails(res);
      await loadPowerbiReportsList(true);

      setInlineFeedback("powerbi-feedback", `Projeto Power BI "${title}" gerado e reconciliado com sucesso!`);
      showToast("Pacote Power BI (.pbip / .zip) compilado com sucesso!");
    } catch (err) {
      setInlineFeedback("powerbi-feedback", `Bloqueio ou erro na geração Power BI: ${err.message}`, true);
      showToast(`Erro ao gerar Power BI: ${err.message}`, true);
    }
  }

  function renderPowerbiLatestDetails(res) {
    const box = document.getElementById("powerbi-latest-details");
    if (!box || !res) return;

    const reportId = res.report_id || res.id;
    const downloadUrl =
      res.download_url ||
      `/api/projects/${encodeURIComponent(state.activeProjectId)}/powerbi/reports/${encodeURIComponent(
        reportId
      )}/download`;
    const recon = safeJsonParse(res.reconciliation || res.reconciliation_json, {});

    const daxHtml = OFFICIAL_DAX_MEASURES.slice(0, 6)
      .map((m) => `${m.name} = ${m.expression}`)
      .join("\n");

    box.innerHTML = `
      <div class="sim-metrics-list">
        <div class="metric-row">
          <span>Caminho do Projeto (<code>.pbip</code>):</span>
          <code class="hash-code">${escapeHtml(res.pbip_path || res.bundle_dir)}</code>
        </div>
        <div class="metric-row">
          <span>Diretório do Bundle PBIR:</span>
          <code class="hash-code">${escapeHtml(res.bundle_dir || res.pbir_dir || "--")}</code>
        </div>
        <div class="metric-row">
          <span>Status Estrutural &amp; Tema:</span>
          <span class="badge badge-approved">PBIP v1.0 · Tema Sustainable Tech Aplicado</span>
        </div>
        <div class="metric-row">
          <span>Reconciliação Numérica (Python vs Power BI):</span>
          <strong>${escapeHtml(JSON.stringify(recon))}</strong>
        </div>
      </div>

      <h3 class="block-heading" style="margin-top: 14px;">Medidas DAX Geradas no Modelo Tabular (<code>model.bim</code>)</h3>
      <pre class="dax-code-block">${escapeHtml(daxHtml)}</pre>

      <div class="panel-footer-actions">
        <a href="${escapeHtml(downloadUrl)}" class="btn btn-primary" download>
          <span>Baixar Pacote Power BI (.zip)</span>
        </a>
      </div>
    `;
  }

  async function loadPowerbiReportsList(silent = false) {
    if (!state.activeProjectId) return;
    const projectId = state.activeProjectId;
    try {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/powerbi/reports`
      );
      if (projectId !== state.activeProjectId) return;
      const list = Array.isArray(res) ? res : res.reports || [];
      state.powerbiReports = list;
      renderPowerbiReportsTable(list);
    } catch (err) {
      if (!silent) {
        showToast(`Erro ao listar relatórios Power BI: ${err.message}`, true);
      }
    }
  }

  function renderPowerbiReportsTable(list) {
    const tbody = document.getElementById("powerbi-reports-table-body");
    const stepPbi = document.getElementById("step-status-powerbi");
    if (stepPbi) {
      stepPbi.textContent = list.length > 0 ? `${list.length} pacote(s) PBIP` : "Pronto p/ exportar";
    }
    if (!tbody) return;

    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Nenhum pacote PBIP gerado para este projeto até o momento.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((r) => {
        const rid = r.id || r.report_id;
        const title = r.report_title || r.report_name || rid;
        const path = r.pbip_path || r.bundle_dir || "";
        const dlUrl =
          r.download_url ||
          `/api/projects/${encodeURIComponent(state.activeProjectId)}/powerbi/reports/${encodeURIComponent(
            rid
          )}/download`;
        return `
          <tr>
            <td><strong>${escapeHtml(title)}</strong><br><small class="field-help">${escapeHtml(rid)}</small></td>
            <td><code class="hash-code">${escapeHtml(path)}</code></td>
            <td><span class="badge badge-approved">${escapeHtml(r.validation_status || "APROVADO")}</span></td>
            <td><span class="badge badge-mint">PBIP/PBIR Válido</span></td>
            <td>
              <a href="${escapeHtml(dlUrl)}" class="btn btn-primary btn-sm" download>Baixar .ZIP</a>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // ==========================================================================
  // 15. TELA 10: HISTÓRICO DE AUDITORIA, CONFIGURAÇÃO DE MODELO & EXPURGO LGPD
  // ==========================================================================
  async function loadAuditAndSystemView() {
    await Promise.all([loadMemoryStatus(), loadModelSettings(), loadAuditLogs(false)]);
  }

  async function loadAuditLogs(silent = false) {
    if (!state.activeProjectId) return;
    const projectId = state.activeProjectId;
    try {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/audit?limit=100`
      );
      if (projectId !== state.activeProjectId) return;
      const list = Array.isArray(res) ? res : res.logs || res.audit_logs || [];
      state.auditLogs = list;
      renderAuditLogsTable();
    } catch (err) {
      if (!silent) {
        showToast(`Erro ao carregar trilha de auditoria: ${err.message}`, true);
      }
    }
  }

  function renderAuditLogsTable() {
    const tbody = document.getElementById("audit-logs-table-body");
    if (!tbody) return;

    const filterText = (document.getElementById("audit-filter-input")?.value || "").toLowerCase().trim();
    const filtered = (state.auditLogs || []).filter((item) => {
      if (!filterText) return true;
      const blob = JSON.stringify(item).toLowerCase();
      return blob.includes(filterText);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Nenhum registro de auditoria encontrado para o filtro atual.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((log) => {
        const ts = formatDateShort(log.created_at || log.timestamp);
        const actor = log.actor || log.operator_id || "system";
        const action = log.action || "EVENT";
        const resType = `${log.resource_type || "system"}${log.resource_id ? ` (${log.resource_id})` : ""}`;
        const ip = log.ip_or_origin || log.ip_address || "127.0.0.1";
        const detailsObj = safeJsonParse(log.details || log.details_json, {});
        const detailsStr = typeof detailsObj === "object" ? JSON.stringify(detailsObj) : String(detailsObj);

        return `
          <tr>
            <td>${escapeHtml(ts)}</td>
            <td><strong>${escapeHtml(actor)}</strong></td>
            <td><span class="badge badge-mint">${escapeHtml(action)}</span></td>
            <td><code>${escapeHtml(resType)}</code></td>
            <td><code>${escapeHtml(ip)}</code></td>
            <td><code class="hash-code">${escapeHtml(detailsStr.slice(0, 140))}</code></td>
          </tr>
        `;
      })
      .join("");
  }

  // ==========================================================================
  // 16. ATUALIZAÇÃO CONSOLIDADA DOS KPIS DO DASHBOARD INICIAL
  // ==========================================================================
  function updateDashboardKPIs() {
    const fin = state.financialEsgAnalysis?.financial_kpis || {};
    const esg = state.financialEsgAnalysis?.esg_kpis || {};
    const qual = state.qualityReport || {};
    const qualSummary = safeJsonParse(qual.summary_json || qual.summary, {}) || {};

    const grossRevenue = Number(fin.receita_bruta_total ?? fin.total_revenue ?? NaN);
    const netRevenue = Number(fin.receita_liquida_total ?? NaN);
    const marginPct = Number(fin.margem_liquida_pct ?? fin.gross_margin_percentage ?? NaN);
    const totalCost = Number(fin.custo_total ?? fin.total_cost ?? NaN);
    const grossEmissions = Number(esg.total_gross_emissions_co2e_tons ?? esg.total_emissions_co2e_tons ?? NaN);
    const credits = Number(esg.carbon_credits_acquired_tco2e ?? NaN);
    const qualityScore = Number(qual.overall_quality_score ?? qualSummary.overall_quality_score ?? qual.completeness_pct ?? NaN);

    const revenueElement = document.getElementById("dash-kpi-revenue");
    const netRevenueElement = document.getElementById("dash-kpi-net-revenue");
    const revenueSubElement = document.getElementById("dash-kpi-revenue-sub");
    const marginElement = document.getElementById("dash-kpi-margin");
    const costSubElement = document.getElementById("dash-kpi-cost-sub");
    const emissionsElement = document.getElementById("dash-kpi-emissions");
    const creditsSubElement = document.getElementById("dash-kpi-credits-sub");
    const qualityElement = document.getElementById("dash-kpi-quality");
    const validationSubElement = document.getElementById("dash-kpi-validations-sub");

    if (revenueElement) revenueElement.textContent = Number.isFinite(grossRevenue) ? formatCurrency(grossRevenue) : "R$ —";
    if (netRevenueElement) netRevenueElement.textContent = Number.isFinite(netRevenue) ? formatCurrency(netRevenue) : "R$ —";
    if (revenueSubElement) revenueSubElement.textContent = Number.isFinite(netRevenue) ? `Margem líquida: ${Number.isFinite(marginPct) ? `${formatNumber(marginPct, 1)}%` : "—%"}` : "Disponível após análise financeira";
    if (marginElement) marginElement.textContent = Number.isFinite(marginPct) ? `${formatNumber(marginPct, 1)}%` : "—%";
    if (costSubElement) costSubElement.textContent = Number.isFinite(totalCost) ? `Custos totais: ${formatCurrency(totalCost)}` : "Custos indisponíveis";
    if (emissionsElement) emissionsElement.textContent = Number.isFinite(grossEmissions) ? `${formatNumber(grossEmissions, 2)} tCO2e` : "— tCO2e";
    if (creditsSubElement) creditsSubElement.textContent = Number.isFinite(credits) ? `Créditos separados (não abatidos): ${formatNumber(credits, 2)} tCO2e` : "Créditos separados (não abatidos): — tCO2e";
    if (qualityElement) qualityElement.textContent = Number.isFinite(qualityScore) ? `${formatNumber(qualityScore, 1)}%` : "—%";
    if (validationSubElement) {
      const approvedCount = state.validations.filter((validation) => validation.status !== "REJEITADO").length;
      const rejectedCount = state.validations.filter((validation) => validation.status === "REJEITADO").length;
      validationSubElement.textContent = `Aprovadas: ${approvedCount} | Rejeitadas: ${rejectedCount}`;
    }

    updateDashboardQuality(qual, qualSummary, qualityScore);
    updateDashboardCharts(fin, esg, state.financialEsgAnalysis?.monthly_series);
    updateDashboardOperations(qual, qualSummary);
    updateWorkflowStates();
  }

  function updateDashboardQuality(report, summary, qualityScore) {
    const scoreElement = document.getElementById("dash-quality-score");
    const progressElement = document.getElementById("dash-quality-progress");
    const rowsElement = document.getElementById("dash-quality-rows");
    const alertsElement = document.getElementById("dash-quality-alerts");
    const hasReport = Boolean(state.qualityReport);
    const totalRows = Number(report.total_rows ?? summary.total_rows ?? NaN);
    const inconsistencyCount = Number(report.inconsistency_count ?? (Array.isArray(summary.inconsistencies) ? summary.inconsistencies.length : NaN));

    if (scoreElement) scoreElement.textContent = Number.isFinite(qualityScore) ? `${formatNumber(qualityScore, 1)}%` : "—%";
    if (rowsElement) rowsElement.textContent = Number.isFinite(totalRows) ? new Intl.NumberFormat("pt-BR").format(totalRows) : "—";
    if (alertsElement) alertsElement.textContent = Number.isFinite(inconsistencyCount) ? new Intl.NumberFormat("pt-BR").format(inconsistencyCount) : "—";
    if (progressElement) {
      const available = hasReport && Number.isFinite(qualityScore);
      progressElement.hidden = !available;
      if ("value" in progressElement) progressElement.value = available ? Math.max(0, Math.min(100, qualityScore)) : 0;
      if (available) {
        progressElement.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, qualityScore))));
        progressElement.setAttribute("aria-valuetext", `${formatNumber(qualityScore, 1)}% de qualidade dos dados`);
      } else {
        progressElement.removeAttribute("aria-valuenow");
        progressElement.setAttribute("aria-valuetext", "Indicador indisponível até o perfilamento dos dados");
      }
    }
  }

  function updateDashboardFinanceChart(monthlySeries) {
    const container = document.getElementById("dash-finance-chart");
    if (!container) return;

    const validPeriods = Array.isArray(monthlySeries)
      ? monthlySeries.filter((item) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(item.periodo || "")))
      : [];
    const series = validPeriods
      .map((item) => ({
        period: String(item.periodo),
        revenue: Number(item.receita_liquida),
        cost: Number(item.custo_total),
        margin: Number(item.margem_liquida_pct),
      }))
      .filter((item) => Number.isFinite(item.revenue) && Number.isFinite(item.cost))
      .sort((first, second) => first.period.localeCompare(second.period));

    if (series.length < 2 || new Set(series.map((item) => item.period)).size < 2) {
      container.innerHTML = '<p class="empty-state-text">A evolução financeira aparece após uma análise com pelo menos dois períodos reais.</p>';
      container.setAttribute("aria-label", "Série temporal financeira indisponível");
      return;
    }

    const width = 640;
    const height = 248;
    const left = 68;
    const right = 590;
    const top = 22;
    const bottom = 176;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const moneyMaximum = Math.max(...series.flatMap((item) => [Math.abs(item.revenue), Math.abs(item.cost)]), 1);
    const margins = series.map((item) => item.margin).filter(Number.isFinite);
    const marginMinimum = margins.length ? Math.min(...margins, 0) : 0;
    const marginMaximum = margins.length ? Math.max(...margins, 100) : 100;
    const marginRange = marginMaximum - marginMinimum || 1;
    const xFor = (index) => left + (index / (series.length - 1)) * plotWidth;
    const moneyY = (value) => bottom - ((value / moneyMaximum) * plotHeight);
    const marginY = (value) => bottom - (((value - marginMinimum) / marginRange) * plotHeight);
    const pathFor = (property, yFor) => series.map((item, index) => `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(item[property]).toFixed(1)}`).join(" ");
    const compactCurrency = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value);
    const grid = [0, 0.5, 1].map((ratio) => {
      const y = bottom - ratio * plotHeight;
      return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(compactCurrency(ratio * moneyMaximum))}</text>`;
    }).join("");
    const labelIndexes = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));
    const periodLabels = labelIndexes.map((index) => `<text class="chart-axis-label" x="${xFor(index)}" y="${bottom + 24}" text-anchor="middle">${escapeHtml(series[index].period)}</text>`).join("");
    const marginPath = margins.length === series.length
      ? `<path class="finance-series-line finance-series-margin" d="${pathFor("margin", marginY)}"></path><text class="chart-axis-label chart-axis-label-secondary" x="${right + 8}" y="${top + 4}">${formatNumber(marginMaximum, 0)}%</text><text class="chart-axis-label chart-axis-label-secondary" x="${right + 8}" y="${bottom}">${formatNumber(marginMinimum, 0)}%</text>`
      : "";

    container.innerHTML = `
      <svg class="finance-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="dash-finance-svg-title dash-finance-svg-description">
        <title id="dash-finance-svg-title">Receita líquida, custos e margem por período</title>
        <desc id="dash-finance-svg-description">Série financeira real para ${escapeHtml(series[0].period)} a ${escapeHtml(series[series.length - 1].period)}; margem em eixo percentual separado.</desc>
        ${grid}
        <path class="finance-series-line finance-series-revenue" d="${pathFor("revenue", moneyY)}"></path>
        <path class="finance-series-line finance-series-cost" d="${pathFor("cost", moneyY)}"></path>
        ${marginPath}
        ${periodLabels}
      </svg>
      <div class="chart-legend" aria-label="Séries do gráfico">
        <span><i class="legend-swatch legend-revenue"></i>Receita líquida</span>
        <span><i class="legend-swatch legend-cost"></i>Custos totais</span>
        ${margins.length === series.length ? '<span><i class="legend-swatch legend-margin"></i>Margem (%)</span>' : ""}
      </div>
    `;
    container.setAttribute("aria-label", `Evolução financeira real, ${series.length} períodos`);
  }

  function updateDashboardOperations(qualityReport, qualitySummary) {
    const activityBody = document.getElementById("dash-activity-tbody");
    const validationStatus = document.getElementById("dash-ops-validation");
    const alertsStatus = document.getElementById("dash-ops-alerts");

    const activities = [
      ...state.analyses.map((analysis) => ({
        activity: ({ financial_esg: "Análise financeira & ESG", predictive: "Análise preditiva", simulation: "Simulação What-If" })[analysis.analysis_type] || analysis.analysis_type || "Análise",
        source: analysis.model_name || analysis.analysis_type || "EcoBI",
        status: analysis.status || "Registrada",
        date: analysis.created_at || "",
      })),
      ...state.datasets.map((dataset) => ({
        activity: dataset.filename || dataset.name || "Dataset",
        source: "Importação de dados",
        status: "Disponível",
        date: dataset.created_at || "",
      })),
    ].sort((first, second) => String(second.date).localeCompare(String(first.date))).slice(0, 6);

    if (activityBody) {
      activityBody.innerHTML = activities.length
        ? activities.map((item) => `<tr><td>${escapeHtml(item.activity)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.date ? formatDateShort(item.date) : "—")}</td></tr>`).join("")
        : '<tr><td class="empty-cell" colspan="4">Ainda não há análises ou importações neste projeto.</td></tr>';
    }

    if (validationStatus) {
      const latestValidation = state.validations[0];
      validationStatus.textContent = latestValidation ? latestValidation.status : "Nenhuma validação registrada";
    }

    if (alertsStatus) {
      const summary = qualitySummary || safeJsonParse(qualityReport.summary_json || qualityReport.summary, {}) || {};
      const alertCount = Number(qualityReport.inconsistency_count ?? (Array.isArray(summary.inconsistencies) ? summary.inconsistencies.length : NaN));
      alertsStatus.textContent = state.qualityReport && Number.isFinite(alertCount)
        ? `${new Intl.NumberFormat("pt-BR").format(alertCount)} inconsistência(s)`
        : "Aguardando perfilamento de dados";
    }
  }

  function updateDashboardCharts(financial, esg, monthlySeries) {
    updateDashboardFinanceChart(monthlySeries);

    const emissionRows = [
      ["scope1", esg.scope1_co2e_tons],
      ["scope2", esg.scope2_co2e_tons],
      ["scope3", esg.scope3_co2e_tons],
    ].map(([key, value]) => [key, value === null || value === undefined ? NaN : Number(value)]);
    const container = document.getElementById("dash-emissions-chart");
    if (container) {
      const knownValues = emissionRows.map(([, value]) => value).filter(Number.isFinite);
      const maximum = Math.max(...knownValues.map(Math.abs), 0);
      let visibleRows = 0;
      emissionRows.forEach(([key, value]) => {
        const row = container.querySelector(`[data-metric="${key}"]`);
        if (!row) return;
        row.hidden = !Number.isFinite(value);
        if (!Number.isFinite(value)) return;
        visibleRows += 1;
        const amount = row.querySelector("strong");
        const bar = row.querySelector(".metric-bar-fill");
        if (amount) amount.textContent = `${formatNumber(value, 2)} tCO2e`;
        if (bar) bar.style.width = `${maximum ? Math.min(Math.abs(value) / maximum * 100, 100) : 0}%`;
      });
      let empty = container.querySelector(".dashboard-chart-empty");
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "dashboard-chart-empty empty-state-text";
        empty.textContent = "Emissões por escopo disponíveis após a análise ESG.";
        container.append(empty);
      }
      empty.hidden = visibleRows > 0;
      container.setAttribute("aria-label", visibleRows ? `${visibleRows} escopos com emissões calculadas` : "Emissões por escopo indisponíveis");
    }

    const credits = esg.carbon_credits_acquired_tco2e;
    const creditsElement = document.getElementById("dash-carbon-credits");
    if (creditsElement && credits !== null && credits !== undefined && Number.isFinite(Number(credits))) {
      creditsElement.textContent = `Créditos de carbono adquiridos (em bloco independente): ${formatNumber(Number(credits), 2)} tCO2e`;
    }
  }
  function updateWorkflowStates() {
    const steps = [
      { view: "view-projects", done: Boolean(state.activeProjectId), blocked: false, waiting: "Aguardando projeto" },
      { view: "view-import", done: state.datasets.length > 0, blocked: !state.activeProjectId, waiting: "Aguardando projeto" },
      { view: "view-quality", done: Boolean(state.qualityReport), blocked: !state.activeDatasetId, waiting: "Aguardando dataset" },
      { view: "view-assistant", done: Boolean(state.financialEsgAnalysis), blocked: !state.activeDatasetId, waiting: "Aguardando dataset" },
      { view: "view-predictive", done: Boolean(state.predictiveAnalysis), blocked: !state.activeDatasetId, waiting: "Aguardando dataset" },
      { view: "view-simulator", done: Boolean(state.simulationResult), blocked: !state.financialEsgAnalysis, waiting: "Aguardando análise" },
      { view: "view-validation", done: state.validations.length > 0, blocked: !state.financialEsgAnalysis, waiting: "Aguardando análise" },
      { view: "view-powerbi", done: state.powerbiReports.length > 0, blocked: !state.financialEsgAnalysis, waiting: "Aguardando análise" },
    ];

    steps.forEach((step) => {
      const button = document.querySelector(`.workflow-step-btn[data-goto-view="${step.view}"]`);
      if (!button) return;
      const status = button.querySelector(".step-meta");
      const current = state.currentView === step.view;
      button.classList.toggle("is-current", current);
      button.classList.toggle("is-complete", step.done && !current);
      button.classList.toggle("is-blocked", step.blocked && !current);
      if (current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      if (status) status.textContent = current ? "Etapa atual" : step.done ? "Concluído" : step.blocked ? step.waiting : "Disponível";
      button.setAttribute("aria-label", `${button.querySelector(".step-title")?.textContent || "Etapa"}: ${status?.textContent || "Disponível"}`);
    });
  }

  function applyUiPreferences() {
    const theme = localStorage.getItem(STORAGE_KEYS.THEME) === "dark" ? "dark" : "light";
    const sidebarCollapsed = localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === "true";
    document.documentElement.setAttribute("data-theme", theme);
    const themeButton = document.getElementById("btn-toggle-theme");
    if (themeButton) {
      themeButton.setAttribute("aria-label", theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro");
      themeButton.setAttribute("aria-pressed", String(theme === "dark"));
    }
    const sidebar = document.getElementById("app-sidebar");
    const toggleButton = document.getElementById("btn-toggle-sidebar");
    if (sidebar) sidebar.classList.toggle("is-collapsed", sidebarCollapsed);
    if (toggleButton) {
      toggleButton.setAttribute("aria-expanded", String(!sidebarCollapsed));
      toggleButton.setAttribute("aria-label", sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral");
      toggleButton.title = sidebarCollapsed ? "Expandir menu" : "Recolher menu";
    }
    document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
      const label = button.querySelector(".nav-text")?.textContent.trim();
      if (label) {
        button.title = label;
        if (sidebarCollapsed) button.setAttribute("aria-label", label);
        else button.removeAttribute("aria-label");
      }
    });
  }

  // ==========================================================================
  // 17. EVENT LISTENERS E INICIALIZAÇÃO COMPLETA
  // ==========================================================================
  function normalizeGlobalSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  }

  function closeGlobalSearch(restoreFocus = false) {
    const input = document.getElementById("global-search-input");
    const results = document.getElementById("global-search-results");
    if (results) results.hidden = true;
    if (input) {
      input.setAttribute("aria-expanded", "false");
      if (restoreFocus) input.focus();
    }
  }

  function renderGlobalSearchResults(query) {
    const input = document.getElementById("global-search-input");
    const results = document.getElementById("global-search-results");
    if (!input || !results) return;

    const term = normalizeGlobalSearchText(query);
    results.replaceChildren();
    if (!term) {
      closeGlobalSearch();
      return;
    }

    const candidates = [
      ...Array.from(document.querySelectorAll(".nav-item[data-view]"), (button) => ({
        type: "view",
        id: button.dataset.view,
        label: button.querySelector(".nav-text")?.textContent.trim() || "Módulo",
        detail: "Módulo",
      })),
      ...state.projects.map((project) => ({
        type: "project",
        id: project.id,
        label: project.name || "Projeto sem nome",
        detail: project.sector || "Projeto",
      })),
      ...state.datasets.map((dataset) => ({
        type: "dataset",
        id: dataset.id || dataset.dataset_id,
        label: dataset.filename || dataset.name || "Dataset sem nome",
        detail: "Dataset do projeto ativo",
      })),
    ].filter((item) => item.id && normalizeGlobalSearchText(`${item.label} ${item.detail}`).includes(term)).slice(0, 8);

    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.className = "global-search-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "Nenhum módulo, projeto ou dataset correspondente.";
      results.append(empty);
    } else {
      candidates.forEach((item) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "global-search-result";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.searchType = item.type;
        option.dataset.searchId = item.id;
        const label = document.createElement("span");
        label.className = "global-search-result-label";
        label.textContent = item.label;
        const detail = document.createElement("span");
        detail.className = "global-search-result-detail";
        detail.textContent = item.detail;
        option.append(label, detail);
        results.append(option);
      });
    }

    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function bindGlobalSearch() {
    const input = document.getElementById("global-search-input");
    const results = document.getElementById("global-search-results");
    if (!input || !results) return;

    input.addEventListener("input", () => renderGlobalSearchResults(input.value));
    input.addEventListener("keydown", (event) => {
      const options = results.querySelectorAll(".global-search-result");
      if (event.key === "Escape") {
        closeGlobalSearch();
      } else if (event.key === "ArrowDown" && options.length) {
        event.preventDefault();
        options[0].focus();
      } else if (event.key === "Enter" && options.length) {
        event.preventDefault();
        options[0].click();
      }
    });
    results.addEventListener("keydown", (event) => {
      const options = Array.from(results.querySelectorAll(".global-search-result"));
      const currentIndex = options.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeGlobalSearch(true);
      } else if (event.key === "ArrowDown" && currentIndex < options.length - 1) {
        event.preventDefault();
        options[currentIndex + 1].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentIndex <= 0) input.focus();
        else options[currentIndex - 1].focus();
      }
    });
    results.addEventListener("click", async (event) => {
      const option = event.target.closest(".global-search-result");
      if (!option) return;
      const { searchType, searchId } = option.dataset;
      closeGlobalSearch(true);
      input.value = "";
      try {
        if (searchType === "view") {
          switchView(searchId);
        } else if (searchType === "project") {
          await setActiveProject(searchId, true);
          switchView("view-dashboard");
        } else if (searchType === "dataset" && state.datasets.some((dataset) => (dataset.id || dataset.dataset_id) === searchId)) {
          const selector = document.getElementById("global-dataset-select");
          if (selector) {
            selector.value = searchId;
            selector.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      } catch (error) {
        showToast(`Não foi possível abrir o resultado da busca: ${error.message}`, true);
      }
    });
    document.addEventListener("click", (event) => {
      if (!input.closest(".global-search")?.contains(event.target)) closeGlobalSearch();
    });
  }
  function bindEvents() {
    updateTopbarPageTitle();
    bindGlobalSearch();
    document.getElementById("btn-toggle-theme")?.addEventListener("click", () => {
      const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
      document.getElementById("btn-toggle-theme")?.setAttribute("aria-label", theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro");
      document.getElementById("btn-toggle-theme")?.setAttribute("aria-pressed", String(theme === "dark"));
    });

    document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => {
      const sidebar = document.getElementById("app-sidebar");
      if (!sidebar) return;
      if (window.matchMedia("(max-width: 860px)").matches) {
        sidebar.classList.remove("is-open");
        const mobileButton = document.getElementById("btn-open-sidebar");
        mobileButton?.setAttribute("aria-expanded", "false");
        mobileButton?.setAttribute("aria-label", "Abrir menu lateral");
        return;
      }
      const collapsed = sidebar.classList.toggle("is-collapsed");
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, String(collapsed));
      const button = document.getElementById("btn-toggle-sidebar");
      button?.setAttribute("aria-expanded", String(!collapsed));
      button?.setAttribute("aria-label", collapsed ? "Expandir menu lateral" : "Recolher menu lateral");
      if (button) button.title = collapsed ? "Expandir menu" : "Recolher menu";
      document.querySelectorAll(".nav-item[data-view]").forEach((navButton) => {
        const label = navButton.querySelector(".nav-text")?.textContent.trim();
        if (!label) return;
        if (collapsed) navButton.setAttribute("aria-label", label);
        else navButton.removeAttribute("aria-label");
      });
    });

    // 1. Navegação da Sidebar
    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-view");
        if (target) switchView(target);
      });
    });

    // Atalhos de navegação internos (data-goto-view)
    document.querySelectorAll("[data-goto-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-goto-view");
        if (target) switchView(target);
      });
    });

    // Menu mobile da Sidebar
    const openSideBtn = document.getElementById("btn-open-sidebar");
    const sidebar = document.getElementById("app-sidebar");
    if (openSideBtn && sidebar) {
      openSideBtn.addEventListener("click", () => {
        const isOpen = sidebar.classList.toggle("is-open");
        openSideBtn.setAttribute("aria-expanded", String(isOpen));
        openSideBtn.setAttribute("aria-label", isOpen ? "Fechar menu lateral" : "Abrir menu lateral");
      });
    }

    // Seletores Globais no Topbar
    const globalProjSelect = document.getElementById("global-project-select");
    if (globalProjSelect) {
      globalProjSelect.addEventListener("change", () => {
        if (globalProjSelect.value) setActiveProject(globalProjSelect.value, true);
      });
    }

    const globalDsSelect = document.getElementById("global-dataset-select");
    if (globalDsSelect) {
      globalDsSelect.addEventListener("change", async () => {
        state.activeDatasetId = globalDsSelect.value;
        localStorage.setItem(STORAGE_KEYS.ACTIVE_DATASET_ID, state.activeDatasetId);
        state.sampleData = null;
        state.qualityReport = null;
        syncDashboardAnalysis();
        syncDatasetSelector();
        updateDashboardKPIs();
        if (state.activeDatasetId) {
          await Promise.all([
            loadDatasetSample(state.activeDatasetId, true),
            loadQualityReport(state.activeDatasetId, true),
          ]);
        }
        updateDashboardKPIs();
      });
    }

    // Modal de Sessão Local & LGPD
    document.getElementById("btn-open-session-modal")?.addEventListener("click", openSessionModal);
    document.getElementById("btn-close-session-modal")?.addEventListener("click", closeSessionModal);
    document.addEventListener("keydown", (event) => {
      const modal = document.getElementById("modal-session");
      if (!modal || modal.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeSessionModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")]
        .filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.getElementById("form-session-auth")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("session-operator-name")?.value.trim() || "";
      const email = document.getElementById("session-operator-email")?.value.trim() || "";
      const role = document.getElementById("session-operator-role")?.value || "analyst";
      const consent = document.getElementById("session-lgpd-consent")?.checked || false;

      if (!name || !email) {
        setInlineFeedback("session-form-feedback", "Preencha o nome e o e-mail corporativo do operador.", true);
        return;
      }
      if (!consent) {
        setInlineFeedback(
          "session-form-feedback",
          "O consentimento explícito com os termos de governança e LGPD é obrigatório.",
          true
        );
        return;
      }

      try {
        await createSessionRequest(name, email, role, consent);
        setInlineFeedback("session-form-feedback", "Sessão segura iniciada com sucesso!");
        showToast(`Sessão iniciada para ${name} (${role}).`);
        closeSessionModal();
        await loadProjects();
      } catch (err) {
        setInlineFeedback("session-form-feedback", `Erro ao iniciar sessão: ${err.message}`, true);
      }
    });

    document.getElementById("btn-quick-demo-session")?.addEventListener("click", async () => {
      try {
        await createSessionRequest("Ana Beatriz Mendes", "ana.mendes@ecobi.local", "analyst", true);
        setInlineFeedback("session-form-feedback", "Sessão Rápida Demo Local ativada!");
        showToast("Sessão Rápida Demo Local autenticada.");
        closeSessionModal();
        await loadProjects();
      } catch (err) {
        setInlineFeedback("session-form-feedback", `Erro na sessão demo: ${err.message}`, true);
      }
    });

    // Dashboard actions
    document.getElementById("btn-refresh-dashboard")?.addEventListener("click", () => {
      refreshDashboardTelemetry();
      showToast("Telemetria de memória e status do sistema atualizados.");
    });

    document.getElementById("btn-run-guided-demo")?.addEventListener("click", async () => {
      showToast("Iniciando fluxo guiado do Caso Piloto Varejo Sustentável...");
      await ensureLocalSession(true);
      await ensureActiveProjectForAction();
      await loadSampleDataset("piloto", "Piloto Varejo Sustentável");
      await executeFinancialEsgAnalysis();
      await refreshDashboardTelemetry();
    });

    // Tela 2: Projetos
    document.getElementById("btn-refresh-projects")?.addEventListener("click", loadProjects);
    document.getElementById("project-search-input")?.addEventListener("input", renderProjectsGrid);
    document.getElementById("project-sector-filter")?.addEventListener("change", renderProjectsGrid);

    document.getElementById("form-create-project")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("project-name")?.value.trim() || "";
      const sector = document.getElementById("project-sector")?.value || "Varejo / E-commerce Sustentável";
      const currency = document.getElementById("project-currency")?.value || "BRL";
      const retentionDays = Number(document.getElementById("project-retention-days")?.value || 365);
      const description = document.getElementById("project-description")?.value.trim() || "";

      if (!name) {
        setInlineFeedback("project-form-feedback", "Informe um nome único para o projeto corporativo.", true);
        return;
      }

      try {
        const created = await apiRequest("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name,
            sector,
            currency,
            retention_days: retentionDays,
            description,
          }),
        });
        document.getElementById("project-name").value = "";
        document.getElementById("project-description").value = "";
        setInlineFeedback("project-form-feedback", `Projeto "${created.name || name}" criado com sucesso!`);
        showToast(`Projeto "${created.name || name}" registrado.`);
        await loadProjects();
        await setActiveProject(created.id || created.project_id, false);
      } catch (err) {
        setInlineFeedback("project-form-feedback", `Erro ao criar projeto: ${err.message}`, true);
      }
    });

    document.getElementById("projects-grid")?.addEventListener("click", async (e) => {
      const selBtn = e.target.closest("[data-select-project]");
      if (selBtn) {
        await setActiveProject(selBtn.getAttribute("data-select-project"), true);
        return;
      }
      const impBtn = e.target.closest("[data-import-project]");
      if (impBtn) {
        await setActiveProject(impBtn.getAttribute("data-import-project"), false);
        switchView("view-import");
        return;
      }
      const delBtn = e.target.closest("[data-delete-project]");
      if (delBtn) {
        const pid = delBtn.getAttribute("data-delete-project");
        const pname = delBtn.getAttribute("data-project-name") || pid;
        try {
          await apiRequest(`/api/projects/${encodeURIComponent(pid)}`, { method: "DELETE" });
          showToast(`Projeto "${pname}" excluído com expurgo LGPD em cascata.`);
          if (state.activeProjectId === pid) state.activeProjectId = "";
          await loadProjects();
        } catch (err) {
          showToast(`Erro ao excluir projeto: ${err.message}`, true);
        }
      }
    });

    // Tela 3: Importação de Dados
    document.getElementById("btn-load-sample-piloto")?.addEventListener("click", () => {
      loadSampleDataset("piloto", "Piloto Varejo Sustentável");
    });
    document.getElementById("btn-load-sample-adverso")?.addEventListener("click", () => {
      loadSampleDataset("adversos", "Base Adversa (Teste)");
    });
    document.getElementById("btn-load-sample-curto")?.addEventListener("click", () => {
      loadSampleDataset("curto", "Série Curta (5 Meses)");
    });

    const fileInput = document.getElementById("dataset-file-input");
    const fileLabel = document.getElementById("selected-file-label");
    if (fileInput && fileLabel) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const f = fileInput.files[0];
          fileLabel.textContent = `Selecionado: ${f.name} (${formatNumber(f.size / 1024, 1)} KB)`;
        }
      });
    }

    document.getElementById("form-upload-dataset")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        setInlineFeedback("import-feedback", "Selecione um arquivo .csv, .xlsx ou .xls antes de enviar.", true);
        return;
      }

      try {
        const projectId = await ensureActiveProjectForAction();
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);

        const progBar = document.getElementById("upload-progress-bar");
        const progPct = document.getElementById("upload-pct-text");
        if (progBar) progBar.style.width = "50%";
        if (progPct) progPct.textContent = "50%";

        const res = await apiRequest(
          `/api/projects/${encodeURIComponent(projectId)}/datasets/upload`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (progBar) progBar.style.width = "100%";
        if (progPct) progPct.textContent = "100%";

        const dsRecord = res.dataset || res;
        upsertDatasetInState(dsRecord);
        await Promise.all([
          loadDatasetSample(state.activeDatasetId, true),
          loadQualityReport(state.activeDatasetId, true),
        ]);

        setInlineFeedback("import-feedback", `Arquivo "${dsRecord.filename}" ingerido com sucesso!`);
        showToast(`Upload de "${dsRecord.filename}" concluído.`);
      } catch (err) {
        setInlineFeedback("import-feedback", `Falha na ingestão do arquivo: ${err.message}`, true);
        showToast(`Erro no upload: ${err.message}`, true);
      }
    });

    document.getElementById("datasets-table-body")?.addEventListener("click", async (e) => {
      const prevBtn = e.target.closest("[data-preview-dataset]");
      if (prevBtn) {
        const dsId = prevBtn.getAttribute("data-preview-dataset");
        state.activeDatasetId = dsId;
        syncDatasetSelector();
        await loadDatasetSample(dsId, false);
        return;
      }
      const qualBtn = e.target.closest("[data-quality-dataset]");
      if (qualBtn) {
        const dsId = qualBtn.getAttribute("data-quality-dataset");
        state.activeDatasetId = dsId;
        syncDatasetSelector();
        await loadQualityReport(dsId, false);
        switchView("view-quality");
      }
    });

    document.getElementById("btn-refresh-sample")?.addEventListener("click", () => {
      if (state.activeDatasetId) loadDatasetSample(state.activeDatasetId, false);
    });

    // Tela 4: Qualidade e Mapeamento Canônico
    document.getElementById("btn-refresh-quality")?.addEventListener("click", () => {
      if (state.activeDatasetId) loadQualityReport(state.activeDatasetId, false);
    });

    document.getElementById("btn-auto-map-columns")?.addEventListener("click", () => {
      document.querySelectorAll(".canonical-map-select").forEach((sel) => {
        const orig = (sel.getAttribute("data-orig-col") || "").toLowerCase().trim();
        if (CANONICAL_COLUMNS_SPEC[orig]) {
          sel.value = orig;
        }
      });
      setInlineFeedback("quality-mapping-feedback", "Colunas associadas automaticamente ao schema canônico EcoBI.");
    });

    document.getElementById("form-canonical-mapping")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.activeProjectId || !state.activeDatasetId) {
        setInlineFeedback("quality-mapping-feedback", "Carregue um dataset antes de salvar o mapeamento.", true);
        return;
      }

      const mappings = {};
      document.querySelectorAll(".canonical-map-select").forEach((sel) => {
        const orig = sel.getAttribute("data-orig-col");
        if (orig && sel.value) {
          mappings[orig] = sel.value;
        }
      });

      try {
        await apiRequest(`/api/projects/${encodeURIComponent(state.activeProjectId)}/quality`, {
          method: "POST",
          body: JSON.stringify({
            dataset_id: state.activeDatasetId,
            mappings: mappings,
            mapping: mappings,
          }),
        });
        state.columnMappings = mappings;
        setInlineFeedback(
          "quality-mapping-feedback",
          `Mapeamento canônico de ${Object.keys(mappings).length} coluna(s) persistido com sucesso no SQLite!`
        );
        showToast("Mapeamento canônico salvo.");
      } catch (err) {
        setInlineFeedback("quality-mapping-feedback", `Erro ao salvar mapeamento: ${err.message}`, true);
      }
    });

    // Tela 5: Análise Financeira/ESG + Chat Assistente
    document.getElementById("btn-run-financial-esg")?.addEventListener("click", executeFinancialEsgAnalysis);

    document.querySelectorAll(".prompt-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const promptText = chip.getAttribute("data-prompt") || "";
        const input = document.getElementById("assistant-message-input");
        if (input) input.value = promptText;
        sendAssistantMessage(promptText);
      });
    });

    document.getElementById("form-assistant-chat")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("assistant-message-input");
      if (!input || !input.value.trim()) return;
      const msg = input.value;
      input.value = "";
      sendAssistantMessage(msg);
    });

    document.getElementById("btn-clear-chat")?.addEventListener("click", () => {
      state.chatHistory = [];
      const log = document.getElementById("assistant-chat-log");
      if (log) {
        log.innerHTML = `
          <div class="chat-msg chat-msg-assistant">
            <div class="chat-msg-meta">
              <strong>Assistente EcoBI Local</strong>
              <span class="badge badge-mint">Histórico Reiniciado</span>
            </div>
            <p>Histórico limpo. Selecione uma sugestão acima ou envie uma nova consulta analítica.</p>
          </div>
        `;
      }
    });

    document.getElementById("assistant-model-select")?.addEventListener("change", async (e) => {
      const newModel = e.target.value;
      try {
        const updated = await apiRequest("/api/settings/model", {
          method: "POST",
          body: JSON.stringify({ model_name: newModel }),
        });
        renderModelSettings(updated);
        showToast(`Modelo local alterado para ${newModel}.`);
      } catch (err) {
        showToast(`Portão de Memória RAM bloqueou troca para ${newModel}: ${err.message}`, true);
        await loadModelSettings();
      }
    });

    // Tela 6: Preditivo
    document.getElementById("form-predictive")?.addEventListener("submit", executePredictiveAnalysis);

    // Tela 7: Simulador What-If
    bindSimulatorSliders();
    document.getElementById("form-simulator")?.addEventListener("submit", executeSimulation);

    document.getElementById("btn-sim-preset-green")?.addEventListener("click", () => {
      const preset = {
        cost: -12,
        energy: -25,
        demand: 10,
        logistics: -20,
        reverse: 35,
      };
      ["cost", "energy", "demand", "logistics", "reverse"].forEach((k) => {
        const s = document.getElementById(`sim-${k}-slider`);
        const i = document.getElementById(`sim-${k}-input`);
        if (s) s.value = String(preset[k]);
        if (i) i.value = String(preset[k]);
      });
      executeSimulation();
    });

    document.getElementById("btn-sim-reset")?.addEventListener("click", () => {
      const defaults = { cost: -10, energy: -15, demand: 8, logistics: -12, reverse: 20 };
      ["cost", "energy", "demand", "logistics", "reverse"].forEach((k) => {
        const s = document.getElementById(`sim-${k}-slider`);
        const i = document.getElementById(`sim-${k}-input`);
        if (s) s.value = String(defaults[k]);
        if (i) i.value = String(defaults[k]);
      });
      setInlineFeedback("simulator-feedback", "Parâmetros restaurados para os valores padrão.");
    });

    // Tela 8: Central de Validação
    document.getElementById("btn-refresh-validations")?.addEventListener("click", () => {
      loadValidations(false);
    });

    document.getElementById("btn-revalidate-all")?.addEventListener("click", async () => {
      if (!state.activeProjectId) return;
      const select = document.getElementById("validation-analysis-select");
      const firstId = select?.value || state.financialEsgAnalysis?.analysis_id || "";
      if (firstId) {
        try {
          await apiRequest(`/api/projects/${encodeURIComponent(state.activeProjectId)}/validations`, {
            method: "POST",
            body: JSON.stringify({ analysis_id: firstId }),
          });
        } catch (_) {
          // Prossegue para recarregar lista
        }
      }
      await loadValidations(false);
      showToast("Laudos de validação atualizados.");
    });

    document.getElementById("form-trigger-validation")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.activeProjectId) return;
      const analysisId = document.getElementById("validation-analysis-select")?.value || "";
      if (!analysisId) {
        setInlineFeedback("validation-feedback", "Selecione uma análise para executar a validação.", true);
        return;
      }

      try {
        const res = await apiRequest(
          `/api/projects/${encodeURIComponent(state.activeProjectId)}/validations`,
          {
            method: "POST",
            body: JSON.stringify({ analysis_id: analysisId }),
          }
        );
        setInlineFeedback(
          "validation-feedback",
          `Auditoria concluída para ${analysisId}: Parecer ${res.status || "emitido"}.`
        );
        await loadValidations(false);
      } catch (err) {
        setInlineFeedback("validation-feedback", `Erro na validação: ${err.message}`, true);
      }
    });

    // Tela 9: Relatórios Power BI
    document.getElementById("btn-refresh-powerbi")?.addEventListener("click", loadPowerbiView);
    document.getElementById("form-powerbi-generate")?.addEventListener("submit", generatePowerbiReport);

    // Tela 10: Auditoria, Modelo & Expurgo LGPD
    document.getElementById("btn-refresh-audit")?.addEventListener("click", loadAuditAndSystemView);
    document.getElementById("btn-refresh-memory")?.addEventListener("click", loadMemoryStatus);
    document.getElementById("audit-filter-input")?.addEventListener("input", renderAuditLogsTable);

    document.getElementById("form-model-settings")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const modelName = document.getElementById("settings-model-select")?.value || "qwen3.5:4b";
      try {
        const res = await apiRequest("/api/settings/model", {
          method: "POST",
          body: JSON.stringify({ model_name: modelName }),
        });
        renderModelSettings(res);
        setInlineFeedback("model-settings-feedback", `Modelo ${modelName} configurado com sucesso!`);
        showToast(`Configuração de modelo alterada para ${modelName}.`);
      } catch (err) {
        setInlineFeedback(
          "model-settings-feedback",
          `Bloqueio de memória RAM (Governador psutil): ${err.message}`,
          true
        );
        await loadModelSettings();
      }
    });

    document.getElementById("form-lgpd-purge")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rawDays = document.getElementById("lgpd-purge-days")?.value;
      const bodyPayload =
        rawDays !== undefined && rawDays !== ""
          ? { retention_override_days: Number(rawDays) }
          : {};

      try {
        const res = await apiRequest("/api/system/lgpd-purge", {
          method: "POST",
          body: JSON.stringify(bodyPayload),
        });
        const purgedCount = res.purged_projects ?? res.deleted_projects ?? 0;
        setInlineFeedback(
          "lgpd-purge-feedback",
          `Expurgo LGPD concluído: ${purgedCount} projeto(s) expirado(s)/excluído(s) removido(s) definitivamente.`
        );
        showToast("Rotina de expurgo LGPD executada e registrada na auditoria.");
        await Promise.all([loadProjects(), loadAuditLogs(true)]);
      } catch (err) {
        setInlineFeedback("lgpd-purge-feedback", `Erro no expurgo LGPD: ${err.message}`, true);
      }
    });

    // Controles Fase 2: Monitoramento de Drift (PSI), Benchmark 4B vs 9B, Unload Ocioso e Backup SQLite
    document.getElementById("btn-run-drift-analysis")?.addEventListener("click", async () => {
      if (!state.activeProjectId) {
        setInlineFeedback("drift-analysis-feedback", "Selecione um projeto ativo antes de executar a análise de drift.", true);
        return;
      }
      try {
        setInlineFeedback("drift-analysis-feedback", "Calculando PSI e estabilidade distributiva...");
        const res = await apiRequest(`/api/projects/${encodeURIComponent(state.activeProjectId)}/drift/analyze`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        const tbody = document.getElementById("drift-features-tbody");
        if (tbody && res.feature_drift) {
          const entries = Object.entries(res.feature_drift);
          if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhuma feature numérica monitorada encontrada.</td></tr>';
          } else {
            tbody.innerHTML = entries
              .map(
                ([col, d]) => `
                <tr>
                  <td><code>${escapeHtml(col)}</code></td>
                  <td>${formatNumber(d.baseline_mean, 2)}</td>
                  <td>${formatNumber(d.target_mean, 2)}</td>
                  <td>${formatNumber(d.mean_shift_pct, 2)}%</td>
                  <td><strong>${formatNumber(d.psi, 4)}</strong></td>
                  <td><span class="status-badge">${escapeHtml(d.status)}</span></td>
                </tr>`
              )
              .join("");
          }
        }
        setInlineFeedback(
          "drift-analysis-feedback",
          `Diagnóstico de Drift: ${res.drift_status} (PSI Médio: ${formatNumber(res.overall_psi, 4)} | PSI Máx: ${formatNumber(res.max_psi, 4)}).`
        );
        showToast(`Análise de Drift concluída: ${res.drift_status}`);
      } catch (err) {
        setInlineFeedback("drift-analysis-feedback", `Erro na análise de drift: ${err.message}`, true);
      }
    });

    document.getElementById("btn-unload-model-idle")?.addEventListener("click", async () => {
      try {
        const res = await apiRequest("/api/settings/model/unload", {
          method: "POST",
          body: JSON.stringify({}),
        });
        setInlineFeedback(
          "model-settings-feedback",
          `${res.detail} (RSS: ${res.memory?.ram_after_mb ?? "--"} MB).`
        );
        await loadMemoryStatus();
      } catch (err) {
        setInlineFeedback("model-settings-feedback", `Erro ao descarregar modelo: ${err.message}`, true);
      }
    });

    document.getElementById("btn-run-model-benchmark")?.addEventListener("click", async () => {
      try {
        setInlineFeedback("model-settings-feedback", "Executando benchmark comparativo 4B vs 9B...");
        const res = await apiRequest("/api/system/model-benchmark", {
          method: "POST",
          body: JSON.stringify({ project_id: state.activeProjectId || null }),
        });
        const items = res.benchmarks || [];
        const summary = items
          .map((b) => `${b.model_name}: Acurácia ${b.tool_accuracy_pct}% (${b.latency_ms} ms, Elegível: ${b.eligible ? "Sim" : "Não"})`)
          .join(" | ");
        setInlineFeedback("model-settings-feedback", `Benchmark concluído: ${summary}`);
        showToast("Benchmark comparativo 4B vs 9B registrado na auditoria.");
        await loadAuditLogs(true);
      } catch (err) {
        setInlineFeedback("model-settings-feedback", `Erro no benchmark: ${err.message}`, true);
      }
    });

    document.getElementById("btn-create-sqlite-backup")?.addEventListener("click", async () => {
      try {
        const res = await apiRequest("/api/system/backups", {
          method: "POST",
        });
        setInlineFeedback(
          "lgpd-purge-feedback",
          `Backup íntegro criado: ${res.backup_filename} (SHA-256: ${String(res.sha256_hash).slice(0, 16)}...).`
        );
        showToast("Snapshot de backup SQLite HMAC-SHA256 criado e verificado.");
        await loadAuditLogs(true);
      } catch (err) {
        setInlineFeedback("lgpd-purge-feedback", `Erro ao criar backup SQLite: ${err.message}`, true);
      }
    });

    // Controles Fase 3: Conectores Somente-Leitura, Recalibração Assistida e Avaliação Experimental LoRA
    document.getElementById("btn-sync-watched-samples")?.addEventListener("click", async () => {
      if (!state.activeProjectId) {
        setInlineFeedback("connector-sync-feedback", "Selecione um projeto ativo para registrar e sincronizar um conector.", true);
        return;
      }
      try {
        setInlineFeedback("connector-sync-feedback", "Registrando e sincronizando conector somente-leitura...");
        const connRes = await apiRequest(`/api/projects/${encodeURIComponent(state.activeProjectId)}/connectors`, {
          method: "POST",
          body: JSON.stringify({
            name: "Diretório Corporativo Monitorado (Samples)",
            connector_type: "watched_directory",
            config: { directory_path: "samples" },
            query_or_table: "*.csv",
            watermark_column: "periodo",
          }),
        });
        const syncRes = await apiRequest(
          `/api/projects/${encodeURIComponent(state.activeProjectId)}/connectors/${encodeURIComponent(connRes.id)}/sync`,
          { method: "POST", body: JSON.stringify({}) }
        );
        setInlineFeedback(
          "connector-sync-feedback",
          `Conector '${connRes.name}' sincronizado: status=${syncRes.run_status} (${syncRes.rows_ingested} linhas ingeridas, SHA-256=${String(syncRes.source_sha256 || "").slice(0, 12)}...).`
        );
        showToast(`Ingestão incremental concluída (${syncRes.run_status}).`);
        await loadDatasets();
      } catch (err) {
        setInlineFeedback("connector-sync-feedback", `Erro no conector: ${err.message}`, true);
      }
    });

    document.getElementById("btn-propose-recalibration")?.addEventListener("click", async () => {
      if (!state.activeProjectId) {
        setInlineFeedback("drift-analysis-feedback", "Selecione um projeto ativo antes de propor recalibração.", true);
        return;
      }
      try {
        setInlineFeedback("drift-analysis-feedback", "Executando proposta de recalibração assistida e backtesting...");
        const res = await apiRequest(`/api/projects/${encodeURIComponent(state.activeProjectId)}/recalibrations/propose`, {
          method: "POST",
          body: JSON.stringify({ target_column: "receita_bruta", candidate_model_type: "ridge", forecast_horizon: 6 }),
        });
        setInlineFeedback(
          "drift-analysis-feedback",
          `Proposta ${res.id}: WAPE Incumbente=${formatNumber(res.incumbent_wape, 2)}% vs Candidato=${formatNumber(res.candidate_wape, 2)}% | Validação=${res.validation_status} | Governança=${res.governance_status}.`
        );
        showToast(`Proposta de recalibração criada (${res.governance_status}).`);
      } catch (err) {
        setInlineFeedback("drift-analysis-feedback", `Erro na recalibração assistida: ${err.message}`, true);
      }
    });

    document.getElementById("btn-evaluate-lora")?.addEventListener("click", async () => {
      try {
        const activeProj = state.projects.find((p) => p.id === state.activeProjectId);
        const sectorName = activeProj?.sector || "Varejo";
        setInlineFeedback("model-settings-feedback", `Avaliando adaptador LoRA experimental para o setor '${sectorName}'...`);
        const res = await apiRequest("/api/system/lora/evaluate", {
          method: "POST",
          body: JSON.stringify({ sector: sectorName, project_id: state.activeProjectId || null }),
        });
        const status = String(res.evaluation_status || "DESCONHECIDO");
        const isInconclusive = status.startsWith("INCONCLUSIVO");
        const isBlockedRam = status === "BLOCKED_INSUFFICIENT_RAM";
        const isAlert = isInconclusive || isBlockedRam;
        const fmtPct = (v) =>
          v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? `${v}%` : "n/d";
        const fmtVal = (v, unit) =>
          v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? `${v} ${unit}` : "n/d";
        const toolAcc = fmtPct(res.tool_accuracy_pct);
        const domainFid = fmtPct(res.domain_fidelity_score);
        const alignScore = fmtPct(res.deterministic_alignment_score);
        const latencyText = fmtVal(res.latency_ms, "ms");
        const ramPeakText = fmtVal(res.ram_peak_mb, "MB");
        const metrics = res.metrics || {};
        const refParts = [];
        if (metrics.base_model_reference_accuracy_pct !== null && metrics.base_model_reference_accuracy_pct !== undefined) {
          refParts.push(`Ref. Determinística=${fmtPct(metrics.base_model_reference_accuracy_pct)}`);
        }
        if (metrics.reference_agreement_pct !== null && metrics.reference_agreement_pct !== undefined) {
          refParts.push(`Concordância=${fmtPct(metrics.reference_agreement_pct)}`);
        }
        const refText = refParts.length ? ` | ${refParts.join(" | ")}` : "";
        const limitationReason =
          isAlert && Array.isArray(res.limitations) && res.limitations[0]
            ? ` | Motivo: ${res.limitations[0]}`
            : "";
        setInlineFeedback(
          "model-settings-feedback",
          `LoRA ${res.adapter_name} (${res.sector}): ${status} | Tool Acc=${toolAcc} | Fidelidade=${domainFid} | Alinhamento=${alignScore}${refText} | Latência=${latencyText} | RAM Pico=${ramPeakText}.${limitationReason}`,
          isAlert
        );
        if (isInconclusive) {
          showToast(`Avaliação experimental LoRA inconclusiva: ${status}`, true);
        } else if (isBlockedRam) {
          showToast(`Avaliação experimental LoRA bloqueada por limite de RAM: ${status}`, true);
        } else if (status === "REPROVADO_QUALIDADE") {
          showToast(`Avaliação experimental LoRA reprovada: ${status}`, true);
        } else {
          showToast(`Avaliação experimental LoRA concluída: ${status}`);
        }
        await loadAuditLogs(true);
      } catch (err) {
        setInlineFeedback("model-settings-feedback", `Erro na avaliação LoRA: ${err.message}`, true);
      }
    });

    // Controles Fase 4: Dashboard Multiprojeto & Automações do Agendador
    document.getElementById("btn-refresh-multiproject")?.addEventListener("click", () => {
      loadMultiprojectData();
      showToast("Dados multiprojeto atualizados.");
    });

    document.getElementById("btn-refresh-scheduler")?.addEventListener("click", () => {
      loadSchedulerData();
      showToast("Rotinas agendadas atualizadas.");
    });

    document.getElementById("form-create-scheduled-job")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("sched-job-name");
      const typeSelect = document.getElementById("sched-job-type");
      const intervalInput = document.getElementById("sched-job-interval");
      const retentionInput = document.getElementById("sched-job-retention");
      const feedback = document.getElementById("sched-form-feedback");

      if (!nameInput || !typeSelect || !intervalInput) return;

      const payload = {
        name: nameInput.value.trim(),
        job_type: typeSelect.value,
        interval_minutes: parseInt(intervalInput.value, 10) || 60,
        retention_days: retentionInput ? parseInt(retentionInput.value, 10) || 30 : 30,
        project_id: state.activeProjectId || null,
      };

      setInlineFeedback("sched-form-feedback", "Cadastrando rotina agendada...");
      try {
        await apiRequest("/api/scheduler/jobs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setInlineFeedback("sched-form-feedback", "Rotina agendada cadastrada com sucesso!");
        showToast("Nova rotina agendada com sucesso.");
        nameInput.value = "";
        await loadSchedulerData();
      } catch (err) {
        setInlineFeedback("sched-form-feedback", `Erro ao agendar rotina: ${err.message}`, true);
      }
    });
  }

  // ==========================================================================
  // 17. FASE 4: DASHBOARD MULTIPROJETO & AGENDADOR LOCAL
  // ==========================================================================

  async function loadMultiprojectData() {
    try {
      const [overview, rankingRes] = await Promise.all([
        apiRequest("/api/multiproject/overview"),
        apiRequest("/api/multiproject/ranking"),
      ]);

      const totals = overview.consolidated_totals || {};
      const elRev = document.getElementById("mp-total-revenue");
      const elProfit = document.getElementById("mp-total-profit");
      const elMargin = document.getElementById("mp-weighted-margin");
      const elEmiss = document.getElementById("mp-total-emissions");
      const elScopes = document.getElementById("mp-scopes-breakdown");
      const elInt = document.getElementById("mp-corporate-intensity");
      const elCredits = document.getElementById("mp-carbon-credits");
      const elLineage = document.getElementById("mp-lineage-counts");

      if (elRev) elRev.textContent = formatCurrency(totals.receita_bruta_total || 0);
      if (elProfit) elProfit.textContent = formatCurrency(totals.lucro_operacional_total || 0);
      if (elMargin) elMargin.textContent = `Margem média ponderada: ${formatNumber(totals.margem_operacional_ponderada_pct || 0, 1)}%`;
      if (elEmiss) elEmiss.textContent = `${(totals.emissoes_totais_brutas_tco2e || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tCO2e`;
      if (elScopes) elScopes.textContent = `Escopo 1: ${formatNumber(totals.emissoes_escopo_1_tco2e || 0, 1)} · Escopo 2: ${formatNumber(totals.emissoes_escopo_2_tco2e || 0, 1)} · Escopo 3: ${formatNumber(totals.emissoes_escopo_3_tco2e || 0, 1)}`;
      if (elInt) elInt.textContent = formatNumber(totals.intensidade_carbono_corporativa_tco2e_milhao || 0, 4);
      if (elCredits) elCredits.textContent = `${formatNumber(totals.creditos_carbono_segregados_tco2e || 0, 2)} tCO2e`;

      const lineage = overview.lineage_breakdown || {};
      if (elLineage) elLineage.textContent = `${lineage.real_validated_projects || 0} REAL / ${lineage.estimated_in_analysis_projects || 0} ESTIMADO`;

      // Renderiza ranking
      const rankingBody = document.getElementById("multiproject-ranking-table-body");
      if (rankingBody) {
        const ranking = rankingRes.ranking || [];
        if (!ranking.length) {
          rankingBody.innerHTML = `<tr><td colspan="8" class="empty-cell">Nenhum projeto com análises concluídas para o ranking.</td></tr>`;
        } else {
          rankingBody.innerHTML = ranking
            .map((item) => {
              const badgeClass = item.eco_badge === "LÍDER_VERDE" ? "badge-success" : (item.eco_badge === "CONFORME" ? "badge-info" : "badge-warning");
              return `
                <tr>
                  <td><strong>#${item.rank}</strong></td>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.sector)}</td>
                  <td>${formatCurrency(item.receita_bruta)}</td>
                  <td>${formatNumber(item.emissoes_totais_tco2e, 2)} tCO2e</td>
                  <td>${formatNumber(item.intensidade_carbono_tco2e_milhao, 4)}</td>
                  <td><span class="badge ${item.data_origin === "REAL" ? "badge-success" : "badge-secondary"}">${escapeHtml(item.data_origin)}</span></td>
                  <td><span class="badge ${badgeClass}">${escapeHtml(item.eco_badge)}</span></td>
                </tr>
              `;
            })
            .join("");
        }
      }
    } catch (err) {
      console.error("Falha ao carregar dashboard multiprojeto:", err);
      showToast(`Erro ao carregar dados multiprojeto: ${err.message}`, true);
    }
  }

  async function loadSchedulerData() {
    try {
      const [jobsRes, runsRes] = await Promise.all([
        apiRequest("/api/scheduler/jobs"),
        apiRequest("/api/scheduler/runs"),
      ]);

      const jobsBody = document.getElementById("scheduler-jobs-table-body");
      if (jobsBody) {
        const jobs = jobsRes.jobs || [];
        if (!jobs.length) {
          jobsBody.innerHTML = `<tr><td colspan="6" class="empty-cell"><div class="empty-state"><svg class="scheduler-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><strong>Nenhuma rotina ativa</strong><span>Crie uma rotina para automatizar sincronizações, auditorias ou backups.</span></div></td></tr>`;
        } else {
          jobsBody.innerHTML = jobs
            .map((j) => {
              const statusBadge = j.last_status === "SUCCESS" ? "badge-success" : (j.last_status === "FAILED" ? "badge-danger" : "badge-secondary");
              const nextRun = j.next_run_at ? new Date(j.next_run_at).toLocaleString("pt-BR") : "Aguardando";
              return `
                <tr>
                  <td><strong>${escapeHtml(j.name)}</strong></td>
                  <td><code>${escapeHtml(j.job_type)}</code></td>
                  <td>${j.interval_minutes} min</td>
                  <td>${nextRun}</td>
                  <td><span class="badge ${statusBadge}">${escapeHtml(j.last_status || "PENDENTE")}</span></td>
                  <td>
                    <button type="button" class="btn btn-sm btn-secondary btn-run-job-now" data-job-id="${j.id}">Executar Agora</button>
                    <button type="button" class="btn btn-sm btn-outline btn-toggle-job" data-job-id="${j.id}" data-active="${j.is_active}">${j.is_active ? "Pausar" : "Ativar"}</button>
                  </td>
                </tr>
              `;
            })
            .join("");

          // Eventos dos botões dinâmicos
          jobsBody.querySelectorAll(".btn-run-job-now").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
              const target = e.currentTarget;
              const jobId = target.getAttribute("data-job-id");
              if (!jobId) return;
              target.disabled = true;
              showToast("Disparando execução imediata do job...");
              try {
                const res = await apiRequest(`/api/scheduler/jobs/${jobId}/run-now`, { method: "POST" });
                showToast(`Job executado: ${res.status || "OK"}`);
                await loadSchedulerData();
              } catch (err) {
                showToast(`Erro na execução do job: ${err.message}`, true);
              } finally {
                target.disabled = false;
              }
            });
          });

          jobsBody.querySelectorAll(".btn-toggle-job").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
              const target = e.currentTarget;
              const jobId = target.getAttribute("data-job-id");
              const currentActive = target.getAttribute("data-active") === "true";
              if (!jobId) return;
              try {
                await apiRequest(`/api/scheduler/jobs/${jobId}/toggle`, {
                  method: "POST",
                  body: JSON.stringify({ is_active: !currentActive }),
                });
                showToast(`Rotina ${!currentActive ? "ativada" : "pausada"}.`);
                await loadSchedulerData();
              } catch (err) {
                showToast(`Erro ao alterar status: ${err.message}`, true);
              }
            });
          });
        }
      }

      // Renderiza logs
      const logsBody = document.getElementById("scheduler-logs-table-body");
      if (logsBody) {
        const runs = runsRes.runs || [];
        if (!runs.length) {
          logsBody.innerHTML = `<tr><td colspan="6" class="empty-cell"><div class="empty-state"><svg class="scheduler-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"></path><path d="M3 3v5h5m4-1v5l3 2"></path></svg><strong>Nenhuma execução registrada</strong><span>O histórico será preenchido após a primeira rotina ser executada.</span></div></td></tr>`;
        } else {
          logsBody.innerHTML = runs
            .map((r) => {
              const statusClass = r.status === "SUCCESS" ? "badge-success" : (r.status === "FAILED" ? "badge-danger" : "badge-secondary");
              const startTime = r.started_at ? new Date(r.started_at).toLocaleString("pt-BR") : "";
              const duration = r.duration_ms ? `${r.duration_ms} ms` : "-";
              return `
                <tr>
                  <td>${startTime}</td>
                  <td><code>${escapeHtml(r.job_type)}</code></td>
                  <td><span class="badge ${statusClass}">${escapeHtml(r.status)}</span></td>
                  <td>${duration}</td>
                  <td>${r.records_processed || 0}</td>
                  <td><small>${escapeHtml(JSON.stringify(r.summary || {}).substring(0, 90))}...</small></td>
                </tr>
              `;
            })
            .join("");
        }
      }
    } catch (err) {
      console.error("Falha ao carregar agendador:", err);
    }
  }

  async function initApp() {
    applyUiPreferences();
    updateSessionUI();
    bindEvents();
    updateWorkflowStates();
    await ensureLocalSession(true);
    await Promise.all([loadMemoryStatus(), loadModelSettings(), loadProjects()]);
    window.EcoBIOnboarding?.init({ switchView, currentView: state.currentView });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
