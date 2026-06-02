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
    partner_built_with: "Built by",
    tweaks_title: "Tweaks",
    tweaks_mood: "Mood",
    tweaks_mood_mission: "Mission",
    tweaks_mood_daylight: "Daylight",
    tweaks_mood_paper: "Paper",
    tweaks_mood_marine: "Marine",
    tweaks_chrome: "Chrome",
    tweaks_chrome_pillows: "Pillows",
    tweaks_chrome_sharp: "Sharp",
    tweaks_chrome_hairline: "Hairline",
    tweaks_palette: "Suitability palette",
    tweaks_palette_verdant: "Verdant",
    tweaks_palette_heatmap: "Heatmap",
    tweaks_palette_earthen: "Earthen",
    tweaks_palette_help: "Repaints the suitability raster, legend, and analysis chart.",
    tweaks_basemap: "Basemap",
    tweaks_layer_opacity: "Layer opacity",
    tweaks_layer_opacity_help: "Adjusts the active suitability layer.",
    lang_current: "EN",
    loader_title: "Loading Irrigation Viewer…",
    loader_subtitle: "Preparing map, layers and analysis tools.",
    country_title: "Country",
    country_help: "Zoom layers to a basin country.",
    layers_title: "Layers",
    layers_help:
      "Zimbabwe — suitability, administrative, and socio-economic layers. South Africa — monthly irrigation and selected boundary layers. Angola — coming soon.",
    layers_not_configured_title:
      "Layers not available",
    layers_not_configured:
      "Layers for {country} aren't configured yet — check back soon.",
    chart_empty:
      "Choose a country and map layer, then draw an area or click a boundary to run analysis.",
    group_suitability: "Suitability maps",
    group_admin: "Administrative boundaries",
    group_socio: "Socio-economic layers",
    status_active_label: "Active:",
    status_active_none: "Select a layer to begin",
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
      "The Irrigation Viewer helps explore irrigation suitability, existing schemes and socio-economic layers in the Country River Basin. Use the left panel to toggle suitability maps and boundaries, then draw polygons or click admin units to run area-based analysis. Results can support planning, targeting investments and monitoring change over time.",
    help_title: "How to use this app",
    help_body:
      "1) Select Zimbabwe in the Country dropdown. 2) Choose a suitability map in the left panel. 3) Draw a polygon or click an admin boundary on the map. 4) In the popup, click Run analysis to compute areas by class. 5) Use the Attributes button to inspect feature tables. South Africa and Angola are currently configured for navigation only; layers will be added later.",
    search_button: "Search",
    locate_button: "Use my location",
    popup_run_analysis: "Run analysis",
    popup_analysis_type_soil: "Irrigation suitability (area)",
    popup_analysis_type_socio: "Irrigation Investment suitability",
    socio_modal_cancel: "Cancel",
    socio_modal_save_score: "Save score",
    socio_modal_title: "Indicator scoring",

    // Layer labels (server-rendered + hardcoded socio layers)
    layer_asset_manicaland: "Manicaland — suitability",
    layer_asset_mat_north: "Matabeleland North — suitability",
    layer_asset_mat_south: "Matabeleland South — suitability",
    layer_asset_masvingo: "Masvingo — suitability",
    layer_zwe_l1: "Zimbabwe — Admin Level 1 (Provinces)",
    layer_zwe_l2: "Zimbabwe — Admin Level 2 (Districts)",
    layer_zwe_l3: "Zimbabwe — Admin Level 3 (Wards)",
    layer_zaf_l1: "South Africa — Admin Level 1 (Provinces)",
    layer_zaf_l2: "South Africa — Admin Level 2 (Districts)",
    layer_zaf_homelands: "South Africa — Homelands (pre-1994)",
    layer_zaf_irrigation_monthly: "South Africa — Irrigation (monthly)",
    group_irrigation: "Irrigation maps",
    picker_period: "Period",
    picker_band: "Band",
    picker_loading: "Loading…",
    picker_band_filtered: "Filtered",
    picker_band_raw: "Raw",
    picker_band_probability: "Probability",
    layer_socio_masvingo: "Masvingo irrigation schemes",
    layer_socio_solar_pumps: "Solar pump providers",
    layer_socio_mat_south: "Matabeleland South — irrigation schemes",
    layer_socio_mash_central: "Mashonaland Central — irrigation schemes",

    // Status / progress / error messages (set via setStatus)
    status_select_suit: "Select a suitability map first.",
    status_draw_polygon_first: "Draw a polygon first.",
    status_click_boundary_first: "Click a boundary polygon first.",
    status_running_analysis: "Running analysis…",
    status_analysis_complete: "Analysis complete.",
    status_analysis_failed: "Analysis failed.",
    status_running_boundary_analysis: "Running boundary analysis…",
    status_boundary_analysis_complete: "Boundary analysis complete.",
    status_boundary_analysis_failed: "Boundary analysis failed.",
    status_socio_scores_cleared: "Socio-economic scores cleared.",
    status_loading_boundaries: "Loading boundary polygons…",
    status_boundaries_error: "Error loading boundary polygons.",
    status_loading_socio: "Loading socio-economic features…",
    status_socio_error: "Error loading socio-economic features.",
    status_loading_tiles: "Loading map tiles…",
    status_map_loaded: "Map loaded.",
    status_tiles_failed: "Failed to load tiles from Earth Engine.",
    status_pan_or_select: "Pan the map or select existing shapes.",
    status_shapes_cleared: "All drawn shapes cleared.",
    status_search_failed: "Location search failed.",
    status_search_no_results: "No results for that place.",
    status_search_error: "Search error.",
    status_geo_unsupported: "Geolocation not supported in this browser.",
    status_locating: "Locating…",
    status_centered_on_loc: "Centered on your location.",
    status_geo_denied: "Location permission denied.",
    status_geo_unavailable: "Could not get your location.",
    status_draw_unavailable: "Drawing tools unavailable (Draw plugin not loaded).",
    status_map_ready: "Map ready. Choose a suitability layer to begin."
  },
  pt: {
    nav_home: "Início",
    nav_about: "Sobre",
    nav_help: "Ajuda",
    partner_built_with: "Por",
    tweaks_title: "Ajustes",
    tweaks_mood: "Estilo",
    tweaks_mood_mission: "Missão",
    tweaks_mood_daylight: "Claro",
    tweaks_mood_paper: "Papel",
    tweaks_mood_marine: "Marinho",
    tweaks_chrome: "Acabamento",
    tweaks_chrome_pillows: "Almofadado",
    tweaks_chrome_sharp: "Vincado",
    tweaks_chrome_hairline: "Linha fina",
    tweaks_palette: "Paleta de aptidão",
    tweaks_palette_verdant: "Verdejante",
    tweaks_palette_heatmap: "Calor",
    tweaks_palette_earthen: "Terra",
    tweaks_palette_help: "Repinta o raster de aptidão, a legenda e o gráfico.",
    tweaks_basemap: "Mapa base",
    tweaks_layer_opacity: "Opacidade da camada",
    tweaks_layer_opacity_help: "Ajusta a camada de aptidão ativa.",
    lang_current: "PT",
    loader_title: "A carregar o Irrigation Viewer…",
    loader_subtitle: "A preparar o mapa, as camadas e as ferramentas de análise.",
    country_title: "País",
    country_help: "Fazer zoom das camadas para um país da bacia.",
    layers_title: "Camadas",
    layers_help:
      "Zimbabué — mapas de aptidão, limites administrativos e camadas socioeconómicas. África do Sul — irrigação mensal e limites selecionados. Angola — em breve.",
    layers_not_configured_title:
      "Camadas indisponíveis",
    layers_not_configured:
      "As camadas para {country} ainda não estão configuradas — volte em breve.",
    chart_empty:
      "Escolha um país e uma camada do mapa, depois desenhe uma área ou clique num limite para executar a análise.",
    group_suitability: "Mapas de aptidão",
    group_admin: "Limites administrativos",
    group_socio: "Camadas socioeconómicas",
    status_active_label: "Ativo:",
    status_active_none: "Selecione uma camada para começar",
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
      "O Irrigation Viewer ajuda a explorar a aptidão para irrigação, os esquemas existentes e as camadas socioeconómicas na Bacia do País. Utilize o painel à esquerda para ativar mapas de aptidão e limites e, em seguida, desenhe polígonos ou clique nas unidades administrativas para executar análises de área. Os resultados podem apoiar o planeamento, o direcionamento de investimentos e o acompanhamento das mudanças ao longo do tempo.",
    help_title: "Como utilizar esta aplicação",
    help_body:
      "1) Selecione o Zimbabué na lista País. 2) Escolha um mapa de aptidão no painel à esquerda. 3) Desenhe um polígono ou clique num limite administrativo no mapa. 4) Na janela, clique em Executar análise para calcular as áreas por classe. 5) Use o botão Atributos para inspecionar as tabelas de atributos. África do Sul e Angola estão, por enquanto, apenas configuradas para navegação; as camadas serão adicionadas mais tarde.",
    search_button: "Pesquisar",
    locate_button: "Usar minha localização",
    popup_run_analysis: "Executar análise",
    popup_analysis_type_soil: "Aptidão para irrigação (área)",
    popup_analysis_type_socio: "Aptidão para investimento em irrigação",
    socio_modal_cancel: "Cancelar",
    socio_modal_save_score: "Guardar pontuação",
    socio_modal_title: "Pontuação dos indicadores",

    // Layer labels
    layer_asset_manicaland: "Manicaland — aptidão",
    layer_asset_mat_north: "Matabeleland Norte — aptidão",
    layer_asset_mat_south: "Matabeleland Sul — aptidão",
    layer_asset_masvingo: "Masvingo — aptidão",
    layer_zwe_l1: "Zimbabué — Nível administrativo 1 (Províncias)",
    layer_zwe_l2: "Zimbabué — Nível administrativo 2 (Distritos)",
    layer_zwe_l3: "Zimbabué — Nível administrativo 3 (Wards)",
    layer_zaf_l1: "África do Sul — Nível administrativo 1 (Províncias)",
    layer_zaf_l2: "África do Sul — Nível administrativo 2 (Distritos)",
    layer_zaf_homelands: "África do Sul — Bantustões (antes de 1994)",
    layer_zaf_irrigation_monthly: "África do Sul — Irrigação (mensal)",
    group_irrigation: "Mapas de irrigação",
    picker_period: "Período",
    picker_band: "Banda",
    picker_loading: "A carregar…",
    picker_band_filtered: "Filtrada",
    picker_band_raw: "Bruta",
    picker_band_probability: "Probabilidade",
    layer_socio_masvingo: "Esquemas de irrigação de Masvingo",
    layer_socio_solar_pumps: "Fornecedores de bombas solares",
    layer_socio_mat_south: "Matabeleland Sul — esquemas de irrigação",
    layer_socio_mash_central: "Mashonaland Central — esquemas de irrigação",

    // Status / progress / error messages
    status_select_suit: "Selecione primeiro um mapa de aptidão.",
    status_draw_polygon_first: "Desenhe primeiro um polígono.",
    status_click_boundary_first: "Clique primeiro num limite administrativo.",
    status_running_analysis: "A executar análise…",
    status_analysis_complete: "Análise concluída.",
    status_analysis_failed: "A análise falhou.",
    status_running_boundary_analysis: "A executar análise de limite…",
    status_boundary_analysis_complete: "Análise de limite concluída.",
    status_boundary_analysis_failed: "A análise de limite falhou.",
    status_socio_scores_cleared: "Pontuações socioeconómicas limpas.",
    status_loading_boundaries: "A carregar polígonos de limites…",
    status_boundaries_error: "Erro ao carregar os polígonos de limites.",
    status_loading_socio: "A carregar elementos socioeconómicos…",
    status_socio_error: "Erro ao carregar elementos socioeconómicos.",
    status_loading_tiles: "A carregar mosaicos do mapa…",
    status_map_loaded: "Mapa carregado.",
    status_tiles_failed: "Falha ao carregar mosaicos do Earth Engine.",
    status_pan_or_select: "Mova o mapa ou selecione formas existentes.",
    status_shapes_cleared: "Todas as formas desenhadas foram limpas.",
    status_search_failed: "A pesquisa de localização falhou.",
    status_search_no_results: "Sem resultados para esse local.",
    status_search_error: "Erro de pesquisa.",
    status_geo_unsupported: "Geolocalização não suportada neste navegador.",
    status_locating: "A localizar…",
    status_centered_on_loc: "Centrado na sua localização.",
    status_geo_denied: "Permissão de localização recusada.",
    status_geo_unavailable: "Não foi possível obter a sua localização.",
    status_draw_unavailable: "Ferramentas de desenho indisponíveis (plugin não carregado).",
    status_map_ready: "Mapa pronto. Escolha uma camada de aptidão para começar."
  }
};

// Public translation helper for other JS modules to look up the active language.
window.ivCurrentLang = "en";
window.ivT = function (key, fallback) {
  const dict =
    IV_TRANSLATIONS[window.ivCurrentLang] || IV_TRANSLATIONS.en;
  return Object.prototype.hasOwnProperty.call(dict, key)
    ? dict[key]
    : (fallback != null ? fallback : key);
};

function ivApplyTranslations(lang) {
  const dict = IV_TRANSLATIONS[lang] || IV_TRANSLATIONS.en;
  window.ivCurrentLang = IV_TRANSLATIONS[lang] ? lang : "en";

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

  // Let other modules know the language changed so they can re-render
  // dynamically-built content (open popups, etc.).
  document.dispatchEvent(
    new CustomEvent("iv:languagechange", {
      detail: { lang: window.ivCurrentLang, dict }
    })
  );
}

// Expose so analysis-manager etc. can re-translate freshly inserted DOM.
window.ivApplyTranslations = ivApplyTranslations;

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
    function syncAttrToggle() {
      if (!attrToggleBtn) return;
      const open = !attrPanel.classList.contains("d-none");
      attrToggleBtn.setAttribute("aria-pressed", open ? "true" : "false");
    }

    if (attrToggleBtn) {
      attrToggleBtn.addEventListener("click", function () {
        attrPanel.classList.toggle("d-none");
        syncAttrToggle();
      });
    }

    if (attrClose) {
      attrClose.addEventListener("click", function () {
        attrPanel.classList.add("d-none");
        syncAttrToggle();
      });
    }

    syncAttrToggle();

    // Pointer Events unify mouse + touch + pen. Use pointer capture so the drag
    // keeps tracking even when the pointer leaves the header element.
    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerMove = (e) => {
      if (e.pointerId !== activePointerId) return;

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

    const endDrag = (e) => {
      if (e.pointerId !== activePointerId) return;
      try { attrHeader.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
      attrHeader.removeEventListener("pointermove", onPointerMove);
      attrHeader.removeEventListener("pointerup", endDrag);
      attrHeader.removeEventListener("pointercancel", endDrag);
    };

    attrHeader.addEventListener("pointerdown", (e) => {
      // Primary button only for mouse; touch/pen always allowed.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Don't start a drag if the pointer is over an interactive child
      // (close button, etc.) — let the click bubble through normally.
      if (e.target.closest("button, a, input, select, textarea")) return;
      e.preventDefault();

      activePointerId = e.pointerId;
      try { attrHeader.setPointerCapture(activePointerId); } catch (_) {}

      const panelRect = attrPanel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = panelRect.left;
      startTop = panelRect.top;

      attrHeader.addEventListener("pointermove", onPointerMove);
      attrHeader.addEventListener("pointerup", endDrag);
      attrHeader.addEventListener("pointercancel", endDrag);
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

  // ----- Tweaks panel (layer opacity for now) -----
  // The global "Layer opacity" slider used to iterate EVERY raster on the
  // map and dim it -- which also dimmed the BASEMAP. It now drives only the
  // overlay rasters (everything that isn't a basemap/decoration layer),
  // routed through map-core's guarded setter so the basemap is never
  // touched. Each move also keeps the per-layer sidebar sliders in sync.
  const GLOBAL_OPACITY_KEY = "iv:global-layer-opacity";
  (function wireTweaksPanel() {
    const toggleBtn = document.getElementById("tweaksToggle");
    const panel = document.getElementById("tweaksPanel");
    const closeBtn = document.getElementById("tweaksClose");
    const slider = document.getElementById("tweakLayerOpacity");
    const sliderValue = document.getElementById("tweakLayerOpacityValue");
    if (!toggleBtn || !panel || !slider) return;

    // Ids of raster overlays currently on the map -- i.e. everything the
    // user added, excluding the basemap and map-decoration layers. Falls
    // back to an empty list until the map/style is ready.
    const overlayRasterIds = () => {
      const map = (window.MAPVIEWER || {}).map;
      if (!map || typeof map.getStyle !== "function") return [];
      let layers;
      try { layers = (map.getStyle().layers || []); } catch (_) { return []; }
      return layers
        .filter((l) => l.type === "raster" && !l.id.startsWith("basemap")
          && l.id !== "boundary-highlight"
          && l.id !== "boundary-highlight-line"
          && l.id !== "boundary-highlight-point")
        .map((l) => l.id);
    };

    const applyGlobalOpacity = (pct) => {
      const API = window.MAPVIEWER || {};
      const v = Math.max(10, Math.min(100, Math.round(pct)));
      overlayRasterIds().forEach((id) => {
        if (typeof API.setLayerOpacityPct === "function") {
          API.setLayerOpacityPct(id, v);      // guarded: never dims basemap
        }
      });
      // Keep the basemap pinned to full opacity defensively.
      if (typeof API.restoreBasemapOpacity === "function") API.restoreBasemapOpacity();
    };

    // Restore the last chosen global opacity.
    const storedPct = parseInt(localStorage.getItem(GLOBAL_OPACITY_KEY), 10);
    if (Number.isFinite(storedPct)) {
      slider.value = String(Math.max(10, Math.min(100, storedPct)));
      if (sliderValue) sliderValue.textContent = slider.value + "%";
    }

    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10) || 100;
      if (sliderValue) sliderValue.textContent = v + "%";
      localStorage.setItem(GLOBAL_OPACITY_KEY, String(v));
      applyGlobalOpacity(v);
    });

    // When a new overlay raster is added, bring it to the current slider value.
    document.addEventListener("iv:layer-added", (e) => {
      if (e.detail && e.detail.type === "raster") {
        applyGlobalOpacity(parseInt(slider.value, 10) || 100);
      }
    });

    // ----- Look toggles: Mood / Chrome / Palette -----
    // Each one writes a data-iv-* attribute on <html>; CSS in map.css
    // re-binds the design tokens so everything that uses them follows.
    function wireTileGroup(gridId, attrName, storageKey, defaultValue) {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      const tiles = grid.querySelectorAll(".tweaks-tile");
      const root = document.documentElement;

      const apply = (value, persist) => {
        if (!value) return;
        root.setAttribute("data-iv-" + attrName, value);
        tiles.forEach((t) => {
          const isActive = t.dataset[attrName] === value;
          t.classList.toggle("is-active", isActive);
          t.setAttribute("aria-checked", isActive ? "true" : "false");
        });
        if (persist) localStorage.setItem(storageKey, value);
        document.dispatchEvent(
          new CustomEvent("iv:tweak-" + attrName + "-changed", { detail: { value } })
        );
      };

      const saved = localStorage.getItem(storageKey) || defaultValue;
      apply(saved, false);

      grid.addEventListener("click", (e) => {
        const tile = e.target.closest(".tweaks-tile[data-" + attrName + "]");
        if (!tile) return;
        apply(tile.dataset[attrName], true);
      });
    }

    wireTileGroup("tweakMood",    "mood",    "iv:mood",    "mission");
    wireTileGroup("tweakChrome",  "chrome",  "iv:chrome",  "pillows");
    wireTileGroup("tweakPalette", "palette", "iv:palette", "verdant");

    // Repaint legend + analysis chart when the palette changes — both
    // hard-code the suitability hex values, so we re-render to pick up
    // the new --iv-suit-* tokens.
    const PALETTES = {
      verdant: { N: "#f1e5cd", S1: "#166534", S2: "#22c55e", S3: "#fde047" },
      heatmap: { N: "#1e3a8a", S1: "#b91c1c", S2: "#f97316", S3: "#facc15" },
      earthen: { N: "#c4b59c", S1: "#134e4a", S2: "#0f766e", S3: "#d97706" },
    };
    document.addEventListener("iv:tweak-palette-changed", (e) => {
      const name = (e.detail && e.detail.value) || "verdant";
      const p = PALETTES[name] || PALETTES.verdant;
      // Patch the static CLASS_COLORS map used by chart.js + legend renderer
      // by exposing it on window; chart re-renders next analysis run.
      window.IV_SUIT_PALETTE = p;
      // Stash the name too so addRasterLayer's fetch picks it up next time.
      window.IV_SUIT_PALETTE_NAME = name;
      const API = window.MAPVIEWER || {};
      // Force-refresh legend if it's currently showing.
      const legend = document.getElementById("legend");
      if (legend && legend.style.display !== "none") {
        if (typeof API.showLegend === "function") API.showLegend();
      }
      // Repaint the active suitability raster on the map by re-fetching its
      // tile from EE with the new palette.
      if (typeof API.refreshActiveSuitability === "function") {
        API.refreshActiveSuitability();
      }
    });

    // ----- Basemap tile picker (in this same panel) -----
    const basemapGrid = document.getElementById("tweakBasemap");
    if (basemapGrid) {
      const tiles = basemapGrid.querySelectorAll(".tweaks-tile[data-basemap]");

      const syncTilesTo = (id) => {
        tiles.forEach((t) => {
          const isActive = t.dataset.basemap === id;
          t.classList.toggle("is-active", isActive);
          t.setAttribute("aria-checked", isActive ? "true" : "false");
        });
      };

      // Initial state: ask map-core for the current basemap id.
      const API = window.MAPVIEWER || {};
      const initialId =
        (typeof API.getCurrentBasemapId === "function" && API.getCurrentBasemapId()) ||
        "osm";
      syncTilesTo(initialId);

      // Tile click → call shared setBasemap. Visual state syncs through
      // the iv:basemap-changed event below.
      basemapGrid.addEventListener("click", (e) => {
        const tile = e.target.closest(".tweaks-tile[data-basemap]");
        if (!tile) return;
        const id = tile.dataset.basemap;
        if (typeof API.setBasemap === "function") API.setBasemap(id);
      });

      // Stay in sync if the user uses the standalone basemap switcher.
      document.addEventListener("iv:basemap-changed", (e) => {
        if (e.detail && e.detail.id) syncTilesTo(e.detail.id);
      });
    }

    function openPanel() {
      panel.classList.remove("d-none");
      toggleBtn.classList.add("is-open");
      toggleBtn.setAttribute("aria-expanded", "true");
    }
    function closePanel() {
      panel.classList.add("d-none");
      toggleBtn.classList.remove("is-open");
      toggleBtn.setAttribute("aria-expanded", "false");
    }

    toggleBtn.addEventListener("click", () => {
      if (panel.classList.contains("d-none")) openPanel();
      else closePanel();
    });
    if (closeBtn) closeBtn.addEventListener("click", closePanel);

    // Close on Esc when the panel is open
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!panel.classList.contains("d-none")) closePanel();
    });
  })();

  // ----- Irrigation date / band picker (per-layer) -----
  // For any .layer-leaf-with-picker[data-ic-kind="irrigation"]:
  //  - fetches /api/gee/irrigation-periods/ on first interaction
  //  - rebuilds the dataset string "IRR_SA_<iso>?<band>" on every change
  //  - if the layer is checked, removes the existing tile and re-adds it
  //    so the new date/band paints immediately.
  (function wireIrrigationPicker() {
    const leaves = document.querySelectorAll(
      '.layer-leaf-with-picker[data-ic-kind="irrigation"]'
    );
    if (!leaves.length) return;

    let periodsPromise = null;
    function fetchPeriods() {
      if (!periodsPromise) {
        periodsPromise = fetch("/api/gee/irrigation-periods/")
          .then((r) => r.json())
          .then((d) => Array.isArray(d.periods) ? d.periods : []);
      }
      return periodsPromise;
    }

    leaves.forEach((leaf) => {
      const cb       = leaf.querySelector('input[name="layer"]');
      const periodEl = leaf.querySelector(".layer-picker-period");
      const bandEl   = leaf.querySelector(".layer-picker-band");
      if (!cb || !periodEl || !bandEl) return;

      const seedDataset = cb.value || "";
      const [seedIso, seedBand] = (() => {
        const m = seedDataset.match(/^IRR_SA_([^?]+)\?(.+)$/);
        return m ? [m[1], m[2]] : ["", "filtered"];
      })();
      bandEl.value = seedBand;

      let periodsLoaded = false;
      async function ensurePeriods() {
        if (periodsLoaded) return;
        const periods = await fetchPeriods();
        periodEl.innerHTML = "";
        if (!periods.length) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "(none yet)";
          periodEl.appendChild(opt);
          periodEl.disabled = true;
        } else {
          periods.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.iso_period;
            opt.textContent = p.month_label || p.iso_period;
            periodEl.appendChild(opt);
          });
          if (seedIso) periodEl.value = seedIso;
          if (!periodEl.value && periods.length) {
            periodEl.value = periods[periods.length - 1].iso_period;
          }
          periodEl.disabled = false;
        }
        periodsLoaded = true;
      }

      // Lazy-load periods the first time the user interacts with this row.
      const lazyLoad = () => { ensurePeriods(); };
      cb.addEventListener("change", lazyLoad, { once: true });
      periodEl.addEventListener("focus", lazyLoad, { once: true });
      bandEl.addEventListener("focus", lazyLoad, { once: true });

      function rebuildDataset() {
        const iso = periodEl.value || seedIso;
        const band = bandEl.value || "filtered";
        if (!iso) return;
        const newValue = `IRR_SA_${iso}?${band}`;
        if (cb.value === newValue) return;
        cb.value = newValue;
        // If the layer is currently on, swap out the rendered tile.
        if (cb.checked) {
          const wasChecked = cb.checked;
          cb.checked = false;
          cb.dispatchEvent(new Event("change"));
          // Re-check on the next tick so the change handler picks up the
          // new value cleanly.
          setTimeout(() => {
            cb.checked = wasChecked;
            cb.dispatchEvent(new Event("change"));
          }, 0);
        }
      }

      periodEl.addEventListener("change", rebuildDataset);
      bandEl.addEventListener("change", rebuildDataset);
    });
  })();

  // ----- WaPOR dekad picker (per-layer) -----
  // Mirrors the irrigation picker but for ``WAPOR_SA_<iso>?<dekad>``.
  // The Band selector in the template is rendered as a Dekad selector
  // (D1/D2/D3) for ic_kind="wapor".
  (function wireWaporPicker() {
    const leaves = document.querySelectorAll(
      '.layer-leaf-with-picker[data-ic-kind="wapor"]'
    );
    if (!leaves.length) return;

    let periodsPromise = null;
    function fetchPeriods() {
      if (!periodsPromise) {
        periodsPromise = fetch("/api/gee/wapor-periods/")
          .then((r) => r.json())
          .then((d) => Array.isArray(d.periods) ? d.periods : []);
      }
      return periodsPromise;
    }

    leaves.forEach((leaf) => {
      const cb       = leaf.querySelector('input[name="layer"]');
      const periodEl = leaf.querySelector(".layer-picker-period");
      const dekadEl  = leaf.querySelector(".layer-picker-band");
      if (!cb || !periodEl || !dekadEl) return;

      const seedDataset = cb.value || "";
      const [seedIso, seedDekad] = (() => {
        const m = seedDataset.match(/^WAPOR_SA_([^?]+)\?(.+)$/);
        return m ? [m[1], m[2]] : ["", "D2"];
      })();
      dekadEl.value = seedDekad;

      let periodsLoaded = false;
      async function ensurePeriods() {
        if (periodsLoaded) return;
        const periods = await fetchPeriods();
        // Deduplicate by iso_period — same month appears multiple times,
        // one per dekad. Keep months only.
        const months = [];
        const seen = new Set();
        periods.forEach((p) => {
          if (seen.has(p.iso_period)) return;
          seen.add(p.iso_period);
          months.push({ iso_period: p.iso_period, month_label: p.month_label });
        });

        periodEl.innerHTML = "";
        if (!months.length) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "(none yet)";
          periodEl.appendChild(opt);
          periodEl.disabled = true;
        } else {
          months.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.iso_period;
            opt.textContent = p.month_label || p.iso_period;
            periodEl.appendChild(opt);
          });
          if (seedIso) periodEl.value = seedIso;
          if (!periodEl.value && months.length) {
            periodEl.value = months[months.length - 1].iso_period;
          }
          periodEl.disabled = false;
        }
        periodsLoaded = true;
      }

      const lazyLoad = () => { ensurePeriods(); };
      cb.addEventListener("change", lazyLoad, { once: true });
      periodEl.addEventListener("focus", lazyLoad, { once: true });
      dekadEl.addEventListener("focus", lazyLoad, { once: true });

      function rebuildDataset() {
        const iso = periodEl.value || seedIso;
        const dekad = dekadEl.value || "D2";
        if (!iso) return;
        const newValue = `WAPOR_SA_${iso}?${dekad}`;
        if (cb.value === newValue) return;
        cb.value = newValue;
        if (cb.checked) {
          const wasChecked = cb.checked;
          cb.checked = false;
          cb.dispatchEvent(new Event("change"));
          setTimeout(() => {
            cb.checked = wasChecked;
            cb.dispatchEvent(new Event("change"));
          }, 0);
        }
      }

      periodEl.addEventListener("change", rebuildDataset);
      dekadEl.addEventListener("change", rebuildDataset);
    });
  })();

  // ----- Sidebar resizer (drag to resize) -----
  // Width is stored in --sidebar-w on :root and persisted to localStorage.
  // Honored only on md+ screens; CSS falls back to Bootstrap's responsive
  // behaviour below 768px.
  (function wireSidebarResizer() {
    const resizer = document.getElementById("sidebarResizer");
    const sidebar = document.getElementById("sidebarPanel");
    if (!resizer || !sidebar) return;

    const STORAGE_KEY = "iv:sidebar-w";
    const MIN_W = 240;
    const MAX_W_RATIO = 0.5; // up to 50% of viewport
    const DEFAULT_W = 320;

    const clamp = (w) => {
      const max = Math.max(MIN_W + 1, Math.floor(window.innerWidth * MAX_W_RATIO));
      return Math.max(MIN_W, Math.min(max, w));
    };

    const applyWidth = (w) => {
      const clamped = clamp(w);
      document.documentElement.style.setProperty("--sidebar-w", clamped + "px");
      // Let MapLibre re-fit the canvas to the new column width.
      window.dispatchEvent(new Event("resize"));
      return clamped;
    };

    // Restore from localStorage on first run.
    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (Number.isFinite(saved)) {
      applyWidth(saved);
    } else {
      applyWidth(DEFAULT_W);
    }

    let activePointerId = null;
    let startX = 0;
    let startW = 0;

    const onMove = (e) => {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      applyWidth(startW + dx);
    };

    const endDrag = (e) => {
      if (e.pointerId !== activePointerId) return;
      try { resizer.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-resizing");
      // Move/up are attached to document — clear there.
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      // Persist final width
      const cur = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
        10
      );
      if (Number.isFinite(cur)) {
        localStorage.setItem(STORAGE_KEY, String(cur));
      }
    };

    resizer.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Disabled below md
      if (window.innerWidth < 768) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      try { resizer.setPointerCapture(activePointerId); } catch (_) {}
      startX = e.clientX;
      startW = sidebar.getBoundingClientRect().width;
      resizer.classList.add("is-dragging");
      document.body.classList.add("sidebar-resizing");
      // Move/up on document so the drag survives the cursor leaving the
      // narrow 8px strip — the standard pattern for draggable splitters.
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", endDrag);
      document.addEventListener("pointercancel", endDrag);
    });

    // Keyboard: left/right arrows nudge by 16px; shift = 64px.
    resizer.addEventListener("keydown", (e) => {
      if (window.innerWidth < 768) return;
      const step = e.shiftKey ? 64 : 16;
      const cur = sidebar.getBoundingClientRect().width;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const next = applyWidth(cur - step);
        localStorage.setItem(STORAGE_KEY, String(next));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = applyWidth(cur + step);
        localStorage.setItem(STORAGE_KEY, String(next));
      } else if (e.key === "Home") {
        e.preventDefault();
        const next = applyWidth(DEFAULT_W);
        localStorage.setItem(STORAGE_KEY, String(next));
      }
    });

    // Re-clamp on window resize so sidebar doesn't exceed 50% of viewport
    // after the user shrinks the browser.
    window.addEventListener("resize", () => {
      const cur = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
        10
      );
      if (Number.isFinite(cur)) {
        const clamped = clamp(cur);
        if (clamped !== cur) applyWidth(clamped);
      }
    });
  })();

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
