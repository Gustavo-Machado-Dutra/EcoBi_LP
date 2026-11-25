/* ==========================================================================
   EcoBI Intelligence — Interações Funcionais e Discretas
   ========================================================================== */

(function () {
  "use strict";

  const THEME_STORAGE_KEY = "ecobi_lp_theme";
  const GITHUB_REPO_URL = "https://github.com/Gustavo-Machado-Dutra/EcoBi";

  /* 1. Tema (Preferência do sistema + localStorage) */
  const themeToggleBtn = document.getElementById("theme-toggle");
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const systemDarkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function applyTheme(theme, persist) {
    const resolved = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolved);

    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", resolved === "dark" ? "#101522" : "#396D3C");
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, resolved);
      } catch (_) {}
    }

    if (themeToggleBtn) {
      const isDark = resolved === "dark";
      themeToggleBtn.setAttribute("aria-pressed", String(isDark));
      themeToggleBtn.setAttribute("aria-label", isDark ? "Ativar modo claro" : "Ativar modo escuro");
      themeToggleBtn.setAttribute("title", isDark ? "Mudar para modo claro" : "Mudar para modo escuro");
    }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (_) {}

    if (saved === "dark" || saved === "light") {
      applyTheme(saved, false);
    } else {
      applyTheme(systemDarkQuery && systemDarkQuery.matches ? "dark" : "light", false);
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme");
        applyTheme(current === "dark" ? "light" : "dark", true);
      });
    }

    if (systemDarkQuery && typeof systemDarkQuery.addEventListener === "function") {
      systemDarkQuery.addEventListener("change", (event) => {
        let hasSaved = false;
        try {
          hasSaved = Boolean(localStorage.getItem(THEME_STORAGE_KEY));
        } catch (_) {}
        if (!hasSaved) applyTheme(event.matches ? "dark" : "light", false);
      });
    }
  }

  /* 2. Navegação ativa (ScrollSpy discreto) */
  function initScrollSpy() {
    const navLinks = Array.from(document.querySelectorAll(".main-nav .nav-link"));
    if (!("IntersectionObserver" in window) || !navLinks.length) return;

    const linkByHref = new Map();
    navLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (href) linkByHref.set(href, link);
    });

    const sectionTargets = {
      inicio: "#inicio",
      "quem-somos": "#quem-somos",
      "nossa-historia": "#quem-somos",
      problemas: "#quem-somos",
      solucoes: "#solucoes",
      metodologia: "#metodologia",
      plataforma: "#plataforma",
      resultados: "#plataforma",
      compromisso: "#compromisso",
      institucional: null,
      contato: null,
      faq: null
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const targetHref = sectionTargets[entry.target.id];
          navLinks.forEach((item) => item.classList.remove("is-active"));
          if (targetHref && linkByHref.has(targetHref)) {
            linkByHref.get(targetHref).classList.add("is-active");
          }
        });
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: 0.02 }
    );

    Object.keys(sectionTargets).forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }

  /* 3. Menu Mobile */
  function initMobileMenu() {
    const toggleBtn = document.getElementById("mobile-menu-toggle");
    const drawer = document.getElementById("mobile-drawer");
    if (!toggleBtn || !drawer) return;

    const closeDrawer = (restoreFocus = false) => {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.setAttribute("aria-label", "Abrir menu de navegação");
      if (restoreFocus) toggleBtn.focus();
    };

    const openDrawer = () => {
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.setAttribute("aria-label", "Fechar menu de navegação");
    };

    toggleBtn.addEventListener("click", () => {
      if (drawer.classList.contains("is-open")) closeDrawer(false);
      else openDrawer();
    });

    drawer.addEventListener("click", (event) => {
      if (event.target === drawer) closeDrawer(true);
    });

    drawer.querySelectorAll("a, button").forEach((el) => {
      el.addEventListener("click", () => closeDrawer(false));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawer.classList.contains("is-open")) {
        closeDrawer(true);
      }
    });
  }

  /* 4. Alternância na Vitrine do Sistema (Hero) */
  function initHeroShowcase() {
    const switchBtns = Array.from(document.querySelectorAll("[data-showcase-target]"));
    const views = Array.from(document.querySelectorAll(".showcase-view"));
    if (!switchBtns.length || !views.length) return;

    switchBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.showcaseTarget;
        switchBtns.forEach((item) => {
          item.setAttribute("aria-selected", String(item.dataset.showcaseTarget === targetId));
        });
        views.forEach((view) => {
          view.hidden = view.id !== targetId;
        });
      });
    });
  }

  /* 5. Explorador dos 8 Módulos + Simulador What-If */
  function initPlatformExplorer() {
    const tabs = Array.from(document.querySelectorAll(".module-tab"));
    const panels = Array.from(document.querySelectorAll(".module-panel"));
    if (!tabs.length || !panels.length) return;

    const activateTab = (tab, moveFocus = false) => {
      const targetId = tab.getAttribute("aria-controls");
      tabs.forEach((item) => {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.id !== targetId;
      });
      if (moveFocus) tab.focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab, false));
      tab.addEventListener("keydown", (event) => {
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        if (next !== null) {
          event.preventDefault();
          activateTab(tabs[next], true);
        }
      });
    });

    const energyInput = document.getElementById("sim-energy-slider");
    const wasteInput = document.getElementById("sim-waste-slider");
    const logisticsInput = document.getElementById("sim-logistics-slider");
    const energyOut = document.getElementById("sim-energy-value");
    const wasteOut = document.getElementById("sim-waste-value");
    const logisticsOut = document.getElementById("sim-logistics-value");
    const resultEmissions = document.getElementById("sim-result-emissions");
    const resultMargin = document.getElementById("sim-result-margin");
    const resultWater = document.getElementById("sim-result-water");

    const updateWhatIf = () => {
      if (!energyInput || !wasteInput || !logisticsInput) return;
      const e = Number(energyInput.value);
      const w = Number(wasteInput.value);
      const l = Number(logisticsInput.value);

      if (energyOut) energyOut.textContent = `-${e}%`;
      if (wasteOut) wasteOut.textContent = `-${w}%`;
      if (logisticsOut) logisticsOut.textContent = `-${l}%`;

      if (resultEmissions) resultEmissions.textContent = `-${(e * 0.45 + l * 0.72 + w * 0.21).toFixed(1)}% tCO₂e`;
      if (resultMargin) resultMargin.textContent = `+${(e * 0.18 + w * 0.14 + l * 0.12).toFixed(1)} p.p.`;
      if (resultWater) resultWater.textContent = `-${(e * 0.55 + w * 0.48).toFixed(1)}% desperdício`;
    };

    [energyInput, wasteInput, logisticsInput].forEach((el) => {
      if (el) el.addEventListener("input", updateWhatIf);
    });
    updateWhatIf();
  }

  /* 6. Filtros do Estudo de Caso Simulado */
  function initCaseStudyFilters() {
    const filterBtns = Array.from(document.querySelectorAll(".case-filter-group [data-case-filter]"));
    const barRows = Array.from(document.querySelectorAll(".case-bar-row"));
    const tableRows = Array.from(document.querySelectorAll(".comparison-table tbody tr"));
    if (!filterBtns.length) return;

    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.caseFilter || "all";
        filterBtns.forEach((item) => item.setAttribute("aria-pressed", String(item === btn)));
        barRows.forEach((row) => { row.hidden = cat !== "all" && row.dataset.category !== cat; });
        tableRows.forEach((row) => { row.hidden = cat !== "all" && row.dataset.category !== cat; });
      });
    });
  }

  /* 7. Accordion FAQ */
  function initFaqAccordion() {
    const items = Array.from(document.querySelectorAll(".faq-item"));
    if (!items.length) return;

    items.forEach((item) => {
      const trigger = item.querySelector(".faq-trigger");
      const panel = item.querySelector(".faq-panel");
      if (!trigger || !panel) return;

      trigger.addEventListener("click", () => {
        const isOpen = trigger.getAttribute("aria-expanded") === "true";
        items.forEach((other) => {
          const b = other.querySelector(".faq-trigger");
          const p = other.querySelector(".faq-panel");
          const s = other.querySelector(".faq-symbol");
          if (b && p) {
            b.setAttribute("aria-expanded", "false");
            p.hidden = true;
            other.classList.remove("is-open");
            if (s) s.textContent = "+";
          }
        });

        if (!isOpen) {
          const sym = item.querySelector(".faq-symbol");
          trigger.setAttribute("aria-expanded", "true");
          panel.hidden = false;
          item.classList.add("is-open");
          if (sym) sym.textContent = "−";
        }
      });
    });
  }

  /* 8. Modal de Contato */
  function initContactModal() {
    const modal = document.getElementById("contact-modal");
    const openBtns = Array.from(document.querySelectorAll("[data-open-contact]"));
    const closeBtns = Array.from(document.querySelectorAll("[data-close-contact]"));
    const form = document.getElementById("contact-form");
    const summaryBox = document.getElementById("contact-summary-box");
    const feedbackEl = document.getElementById("contact-feedback");
    const copyBtn = document.getElementById("btn-copy-summary");
    if (!modal || !openBtns.length) return;

    let lastFocused = null;

    const openModal = () => {
      lastFocused = document.activeElement;
      modal.hidden = false;
      document.body.style.overflow = "hidden";
      document.getElementById("contact-company")?.focus();
    };

    const closeModal = () => {
      modal.hidden = true;
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };

    openBtns.forEach((btn) => btn.addEventListener("click", openModal));
    closeBtns.forEach((btn) => btn.addEventListener("click", closeModal));

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", (event) => {
      if (modal.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    });

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const company = document.getElementById("contact-company")?.value.trim() || "Não informado";
        const stage = document.getElementById("contact-stage")?.value || "Pequena empresa";
        const focus = document.getElementById("contact-focus")?.value || "Organização de dados e indicadores";
        const notes = document.getElementById("contact-notes")?.value.trim() || "Sem observações adicionais.";

        const summary = [
          "Solicitação de Diagnóstico — EcoBI Intelligence",
          `Empresa / Startup: ${company}`,
          `Momento: ${stage}`,
          `Foco: ${focus}`,
          `Contexto: ${notes}`,
          `Repositório oficial: ${GITHUB_REPO_URL}`
        ].join("\n");

        if (summaryBox) {
          summaryBox.textContent = summary;
          summaryBox.hidden = false;
        }
        if (copyBtn) copyBtn.hidden = false;
        if (feedbackEl) feedbackEl.textContent = "Resumo preparado localmente.";
      });
    }

    if (copyBtn && summaryBox) {
      copyBtn.addEventListener("click", async () => {
        const text = summaryBox.textContent || "";
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          if (feedbackEl) feedbackEl.textContent = "Resumo copiado para a área de transferência.";
        } catch (_) {
          if (feedbackEl) feedbackEl.textContent = "Selecione e copie o resumo exibido acima.";
        }
      });
    }
  }

  initTheme();
  initScrollSpy();
  initMobileMenu();
  initHeroShowcase();
  initPlatformExplorer();
  initCaseStudyFilters();
  initFaqAccordion();
  initContactModal();
})();
