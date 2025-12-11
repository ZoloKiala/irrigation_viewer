/* global bootstrap, MAPVIEWER */

// ================= LOADER HIDE =================
(function () {
  const MIN_LOADER_MS = 2600;
  const startTime = Date.now();

  function reallyHide() {
    const el = document.getElementById("appLoader");
    if (!el || el.classList.contains("app-loader-hidden")) return;

    el.classList.add("app-loader-hidden");
    setTimeout(() => {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 400);
  }

  function hideAppLoader() {
    const elapsed = Date.now() - startTime;
    const remaining = MIN_LOADER_MS - elapsed;
    if (remaining > 0) {
      setTimeout(reallyHide, remaining);
    } else {
      reallyHide();
    }
  }

  window.addEventListener("load", hideAppLoader);
  setTimeout(hideAppLoader, MIN_LOADER_MS + 1000);
})();

// ================= TRANSLATION DICT =================
const IV_TRANSLATIONS = {
  en: {
    nav_home: "Home",
    nav_about: "About",
    nav_help: "Help",
    lang_current: "EN",
    loader_title: "Loading Irrigation Viewer…",
    loader_subtitle: "Preparing map, layers and analysis tools.",
    country_title: "Country",
    country_help: "Zoom layers to a basin country.",
    layers_title: "Layers",
    layers_help:
      "Currently configured for Zimbabwe only. Select Zimbabwe to view suitability, administrative and socio-economic layers.",
    group_suitability: "Suitability maps",
    group_admin: "Administrative boundaries",
    group_socio: "Socio-economic layers",
    status_active_label: "Active:",
    search_placeholder: "Search location…",
    basemap_gallery: "Basemap gallery",
    basemap_streets: "Streets",
    basemap_terrain: "Terrain",
    basemap_satellite: "Satellite",
    analysis_title: "Analysis",
    analysis_help:
      "Pick a suitability map, then draw a polygon or click a boundary and use “Run analysis” in the popup.",
    attr_panel_title: "Attributes",
    attr_toggle: "Attributes",
    layer_info_title: "Layer info",
    about_title: "About Irrigation Viewer",
    about_body:
      "The Irrigation Viewer helps explore irrigation suitability, existing schemes and socio-economic layers in the Limpopo River Basin. Use the left panel to toggle suitability maps and boundaries, then draw polygons or click admin units to run area-based analysis. Results can support planning, targeting investments and monitoring change over time.",
    help_title: "How to use this app",
    help_body:
      "1) Select Zimbabwe in the Country dropdown. 2) Choose a suitability map in the left panel. 3) Draw a polygon or click an admin boundary on the map. 4) In the popup, click Run analysis to compute areas by class. 5) Use the Attributes button to inspect feature tables. South Africa and Angola are currently configured for navigation only; layers will be added later.",
    search_button: "Search",
    locate_button: "Use my location"
  },
  pt: {
    nav_home: "Início",
    nav_about: "Sobre",
    nav_help: "Ajuda",
    lang_current: "PT",
    loader_title: "A carregar o Irrigation Viewer…",
    loader_subtitle: "A preparar o mapa, as camadas e as ferramentas de análise.",
    country_title: "País",
    country_help: "Fazer zoom das camadas para um país da bacia.",
    layers_title: "Camadas",
    layers_help:
      "Atualmente configurado apenas para o Zimbabué. Selecione o Zimbabué para ver mapas de aptidão, limites administrativos e camadas socioeconómicas.",
    group_suitability: "Mapas de aptidão",
    group_admin: "Limites administrativos",
    group_socio: "Camadas socioeconómicas",
    status_active_label: "Ativo:",
    search_placeholder: "Pesquisar local…",
    basemap_gallery: "Galeria de mapas base",
    basemap_streets: "Ruas",
    basemap_terrain: "Terreno",
    basemap_satellite: "Satélite",
    analysis_title: "Análise",
    analysis_help:
      'Escolha um mapa de aptidão, depois desenhe um polígono ou clique num limite e use "Executar análise" na janela.',
    attr_panel_title: "Atributos",
    attr_toggle: "Atributos",
    layer_info_title: "Informação da camada",
    about_title: "Sobre o Irrigation Viewer",
    about_body:
      "O Irrigation Viewer ajuda a explorar a aptidão para irrigação, os esquemas existentes e as camadas socioeconómicas na Bacia do Limpopo. Utilize o painel à esquerda para ativar mapas de aptidão e limites e, em seguida, desenhe polígonos ou clique nas unidades administrativas para executar análises de área. Os resultados podem apoiar o planeamento, o direcionamento de investimentos e o acompanhamento das mudanças ao longo do tempo.",
    help_title: "Como utilizar esta aplicação",
    help_body:
      "1) Selecione o Zimbabué na lista País. 2) Escolha um mapa de aptidão no painel à esquerda. 3) Desenhe um polígono ou clique num limite administrativo no mapa. 4) Na janela, clique em Executar análise para calcular as áreas por classe. 5) Use o botão Atributos para inspecionar as tabelas de atributos. África do Sul e Angola estão, por enquanto, apenas configuradas para navegação; as camadas serão adicionadas mais tarde.",
    search_button: "Pesquisar",
    locate_button: "Usar minha localização"
  }
};

function ivApplyTranslations(lang) {
  const dict = IV_TRANSLATIONS[lang] || IV_TRANSLATIONS.en;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (dict[key]) el.setAttribute("placeholder", dict[key]);
  });

  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn && dict.search_button) {
    searchBtn.setAttribute("title", dict.search_button);
  }
  const locateBtn = document.getElementById("locateBtn");
  if (locateBtn && dict.locate_button) {
    locateBtn.setAttribute("title", dict.locate_button);
  }

  const basemapToggle = document.getElementById("basemapToggle");
  if (basemapToggle && dict.basemap_gallery) {
    basemapToggle.setAttribute("title", dict.basemap_gallery);
  }
}

// ================= DOMContentLoaded WIRING =================
document.addEventListener("DOMContentLoaded", function () {
  // ----- Basemap gallery -----
  const basemapToggle = document.getElementById("basemapToggle");
  const basemapPopup = document.getElementById("basemapSwitcher");
  const basemapClose = document.getElementById("basemapClose");

  if (basemapToggle && basemapPopup) {
    basemapToggle.addEventListener("click", () => {
      basemapPopup.classList.add("open");
    });
  }
  if (basemapClose && basemapPopup) {
    basemapClose.addEventListener("click", () => {
      basemapPopup.classList.remove("open");
    });
  }

  // ----- Attribute panel drag + toggle -----
  const attrPanel = document.getElementById("attributePanel");
  const attrHeader = document.getElementById("attributePanelHeader");
  const attrClose = document.getElementById("attributePanelCloseBtn");
  const mapCol = document.querySelector(".map-col");
  const attrToggleBtn = document.getElementById("attributeToggleBtn");

  if (attrPanel && attrHeader && mapCol) {
    if (attrToggleBtn) {
      attrToggleBtn.addEventListener("click", function () {
        attrPanel.classList.toggle("d-none");
      });
    }

    if (attrClose) {
      attrClose.addEventListener("click", function () {
        attrPanel.classList.add("d-none");
      });
    }

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseMove = (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const rect = mapCol.getBoundingClientRect();
      const panelRect = attrPanel.getBoundingClientRect();

      const minLeft = rect.left + 8;
      const maxLeft = rect.right - panelRect.width - 8;
      const minTop = rect.top + 8;
      const maxTop = rect.bottom - 40;

      newLeft = Math.min(Math.max(newLeft, minLeft), maxLeft);
      newTop = Math.min(Math.max(newTop, minTop), maxTop);

      attrPanel.style.left = newLeft - rect.left + "px";
      attrPanel.style.top = newTop - rect.top + "px";
      attrPanel.style.bottom = "auto";
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    attrHeader.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();

      isDragging = true;

      const panelRect = attrPanel.getBoundingClientRect();

      startX = e.clientX;
      startY = e.clientY;
      startLeft = panelRect.left;
      startTop = panelRect.top;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // ----- Sidebar hide/show -----
  const sidebarToggle = document.getElementById("sidebarToggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", function () {
      const body = document.body;
      const collapsed = body.classList.toggle("sidebar-collapsed");
      const icon = this.querySelector("i");

      if (collapsed) {
        this.setAttribute("title", "Show sidebar");
        if (icon) icon.className = "bi bi-layout-sidebar";
      } else {
        this.setAttribute("title", "Hide sidebar");
        if (icon) icon.className = "bi bi-layout-sidebar-inset";
      }

      // force MapLibre to resize
      window.dispatchEvent(new Event("resize"));
    });
  }

  // ----- Replace "(asset)" with ? icon & modal wiring -----
  document.querySelectorAll(".layer-label").forEach(function (el) {
    const original = (el.textContent || "").trim();
    const suffix = " (asset)";
    if (!original.endsWith(suffix)) return;

    const baseLabel = original.slice(0, -suffix.length);
    el.textContent = baseLabel;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layer-asset-info-btn";
    btn.innerHTML = '<i class="bi bi-question-circle-fill"></i>';
    btn.dataset.layerLabel = baseLabel;
    el.after(btn);
  });

  const modalEl = document.getElementById("layerInfoModal");
  const titleEl = document.getElementById("layerInfoModalLabel");
  const bodyEl = document.getElementById("layerInfoModalBody");

  let infoModal = null;
  if (modalEl && window.bootstrap) {
    infoModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  if (infoModal && titleEl && bodyEl) {
    document.addEventListener("click", function (e) {
      const btn = e.target.closest(".layer-asset-info-btn");
      if (!btn) return;

      const label = btn.dataset.layerLabel || "Layer";
      const lower = label.toLowerCase();

      titleEl.textContent = label + " layer";

      if (lower.includes("manicaland")) {
        bodyEl.innerHTML = `
          <p><strong>Suitability snapshot – Manicaland</strong></p>
          <ul class="mb-2">
            <li>Highly suitable: <strong>3.4%</strong> (Buhera &amp; Makoni)</li>
            <li>Moderately suitable: <strong>42.9%</strong></li>
          </ul>
          <p class="mb-1">
            <strong>Challenges</strong> – mountainous terrain, despite abundant seasonal streams.
          </p>
          <p class="mb-0">
            <strong>Recommendation</strong> – infrastructure for water transfer from mountain areas.
          </p>
        `;
      } else if (lower.includes("matabeleland north")) {
        bodyEl.innerHTML = `
          <p><strong>Suitability snapshot – Matabeleland North</strong></p>
          <ul class="mb-2">
            <li>Highly suitable: <strong>6.1%</strong></li>
            <li>Moderately suitable: <strong>34.6%</strong></li>
          </ul>
          <p class="mb-1">
            <strong>Major constraints</strong> – aridity, low soil fertility,
            high wildlife activity, and flooding in specific districts (e.g. Tsholotsho).
          </p>
          <p class="mb-0">
            <strong>Recommendation</strong> – revitalize existing irrigation schemes and address water scarcity issues.
          </p>
        `;
      } else if (lower.includes("matabeleland south")) {
        bodyEl.innerHTML = `
          <p><strong>Suitability snapshot – Matabeleland South</strong></p>
          <ul class="mb-2">
            <li>Highly suitable: <strong>9.3%</strong> (Insiza district)</li>
            <li>Moderately suitable: <strong>53.6%</strong></li>
          </ul>
          <p class="mb-1">
            <strong>Challenges</strong> – competition for water resources with artisanal mining and recurrent drought.
          </p>
          <p class="mb-0">
            <strong>Recommendation</strong> – promote groundwater harvesting from ephemeral rivers and
            expand solar-powered water abstraction technologies.
          </p>
        `;
      } else if (lower.includes("masvingo")) {
        bodyEl.innerHTML = `
          <p><strong>Suitability snapshot – Masvingo</strong></p>
          <ul class="mb-2">
            <li>Highly suitable: <strong>9.5%</strong> (Chivi, Gutu, Masvingo, Zaka)</li>
            <li>Moderately suitable: <strong>48.5%</strong></li>
          </ul>
          <p class="mb-1">
            <strong>Context</strong> – high potential area due to numerous dams under the Runde Catchment Authority.
          </p>
          <p class="mb-0">
            <strong>Recommendation</strong> – scale up appropriate water abstraction infrastructure
            investments to unlock this potential.
          </p>
        `;
      } else {
        bodyEl.innerHTML = `
          <p>This layer is loaded from a Google Earth Engine asset.</p>
          <p class="mb-0">
            You can use it to explore irrigation schemes and overlay it with suitability maps.
          </p>
        `;
      }

      infoModal.show();
    });
  }

  // ----- Home / About / Help nav pills -----
  const homeBtn = document.getElementById("navHomeBtn");
  const aboutBtn = document.getElementById("navAboutBtn");
  const helpBtn = document.getElementById("navHelpBtn");

  const aboutModalEl = document.getElementById("aboutModal");
  const helpModalEl = document.getElementById("helpModal");

  const aboutInstance = aboutModalEl
    ? bootstrap.Modal.getOrCreateInstance(aboutModalEl)
    : null;
  const helpInstance = helpModalEl
    ? bootstrap.Modal.getOrCreateInstance(helpModalEl)
    : null;

  function setActive(btn) {
    document
      .querySelectorAll(".nav-pill-item")
      .forEach((b) => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
  }

  if (homeBtn) {
    homeBtn.addEventListener("click", function () {
      setActive(homeBtn);

      if (aboutInstance) aboutInstance.hide();
      if (helpInstance) helpInstance.hide();

      const mapEl = document.getElementById("map");
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      if (
        window.MAPVIEWER &&
        typeof window.MAPVIEWER.resetView === "function"
      ) {
        window.MAPVIEWER.resetView();
      }
    });
  }

  if (aboutBtn) {
    aboutBtn.addEventListener("click", function () {
      setActive(aboutBtn);
    });
  }

  if (helpBtn) {
    helpBtn.addEventListener("click", function () {
      setActive(helpBtn);
    });
  }

  if (aboutModalEl) {
    aboutModalEl.addEventListener("hidden.bs.modal", function () {
      setActive(homeBtn);
    });
  }
  if (helpModalEl) {
    helpModalEl.addEventListener("hidden.bs.modal", function () {
      setActive(homeBtn);
    });
  }

  // ----- Language switch -----
  document.querySelectorAll("[data-lang-select]").forEach((btn) => {
    btn.addEventListener("click", function () {
      const lang = this.getAttribute("data-lang-select");
      const dict = IV_TRANSLATIONS[lang] || IV_TRANSLATIONS.en;

      ivApplyTranslations(lang);

      const langCurrentSpan = document.querySelector(
        "[data-i18n='lang_current']"
      );
      if (langCurrentSpan && dict.lang_current) {
        langCurrentSpan.textContent = dict.lang_current;
      }
    });
  });

  // initial language
  ivApplyTranslations("en");
});
