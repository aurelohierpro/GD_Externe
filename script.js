const { Deck, GeoJsonLayer, _GlobeView } = deck;

const DATA_URL = "./countries_external.geojson?v=3";

let scope = "all"; // "all" | "hydro" | "nexsom" | "urba"

let hoveredName = null;
let deckgl = null;
let autoRotate = true;
let resumeRotateTimeout = null;

let currentViewState = {
  longitude: -12,
  latitude: -5,
  zoom: 0.9
};

let geoFeatures = [];
let countriesFeatureCollection = null;
let geoMetadata = null;

const PALETTE_BLUE = [
  { label: "0", color: [232, 238, 244, 255] },
  { label: "1", color: [210, 225, 242, 255] },
  { label: "2–3", color: [166, 198, 232, 255] },
  { label: "4–5", color: [119, 168, 218, 255] },
  { label: "6–10", color: [66, 127, 194, 255] },
  { label: "10+", color: [10, 77, 156, 255] }
];

const PALETTE_ORANGE = [
  { label: "0", color: [242, 238, 232, 255] },
  { label: "1", color: [253, 224, 178, 255] },
  { label: "2–3", color: [253, 187, 99, 255] },
  { label: "4–5", color: [240, 134, 28, 255] },
  { label: "6–10", color: [210, 82, 8, 255] },
  { label: "10+", color: [155, 45, 2, 255] }
];

const PALETTE_GREEN = [
  { label: "0", color: [235, 242, 236, 255] },
  { label: "1", color: [198, 239, 210, 255] },
  { label: "2–3", color: [129, 204, 155, 255] },
  { label: "4–5", color: [65, 171, 103, 255] },
  { label: "6–10", color: [30, 130, 65, 255] },
  { label: "10+", color: [10, 85, 35, 255] }
];

function getActivePalette() {
  if (scope === "urba") return PALETTE_ORANGE;
  if (scope === "nexsom") return PALETTE_GREEN;
  return PALETTE_BLUE;
}

function numberFmt(n) {
  return Number(n || 0).toLocaleString("fr-FR");
}

function amountShort(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(".", ",") + " Md EUR";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + " M EUR";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + " k EUR";
  return numberFmt(v) + " EUR";
}

function getScopePresence(props) {
  if (scope === "all") return Number(props.has_any_project || 0);
  if (scope === "hydro") return Number(props.has_hydroconseil || 0);
  if (scope === "nexsom") return Number(props.has_nexsom || 0);
  if (scope === "urba") return Number(props.has_urbaconsulting || 0);
  return 0;
}

function getProjectValue(props) {
  if (scope === "all") {
    return Number(props.project_count || 0);
  }
  return getScopePresence(props) ? Number(props.project_count || 0) : 0;
}

function getProjectColor(v) {
  const palette = getActivePalette();
  if (!v || v <= 0) return palette[0].color;
  if (v <= 1) return palette[1].color;
  if (v <= 3) return palette[2].color;
  if (v <= 5) return palette[3].color;
  if (v <= 10) return palette[4].color;
  return palette[5].color;
}

function getFillColor(props) {
  const isHovered = hoveredName && props.country_name === hoveredName;
  const value = getProjectValue(props);
  const color = getProjectColor(value);

  if (isHovered) {
    return [
      Math.max(0, Math.min(255, color[0] - 10)),
      Math.max(0, Math.min(255, color[1] - 10)),
      Math.max(0, Math.min(255, color[2] - 10)),
      255
    ];
  }

  return color;
}

function makeEarthLayer() {
  return new GeoJsonLayer({
    id: "earth-bg",
    data: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-179.9, -89.9],
            [179.9, -89.9],
            [179.9, 89.9],
            [-179.9, 89.9],
            [-179.9, -89.9]
          ]]
        },
        properties: {}
      }]
    },
    filled: true,
    stroked: false,
    extruded: false,
    pickable: false,
    getFillColor: [255, 255, 255, 255],
    parameters: {
      depthTest: true,
      cullFace: "back"
    }
  });
}

function makeCountriesFillLayer() {
  return new GeoJsonLayer({
    id: "countries-fill",
    data: countriesFeatureCollection,
    filled: true,
    stroked: false,
    extruded: false,
    wireframe: false,
    pickable: true,
    autoHighlight: false,
    getFillColor: f => getFillColor(f.properties),
    parameters: {
      depthTest: true,
      cullFace: "back"
    },
    updateTriggers: {
      getFillColor: [scope, hoveredName]
    },
    onHover: info => {
      const newHovered = info.object ? info.object.properties.country_name : null;
      if (newHovered !== hoveredName) {
        hoveredName = newHovered;
        refreshMap();
      }
      updateTooltip(info);
    }
  });
}

function makeCountriesBorderLayer() {
  return new GeoJsonLayer({
    id: "countries-border",
    data: countriesFeatureCollection,
    filled: false,
    stroked: true,
    extruded: false,
    pickable: false,
    getLineColor: f => {
      const isHovered = hoveredName && f.properties.country_name === hoveredName;
      return isHovered ? [30, 40, 50, 255] : [160, 170, 180, 180];
    },
    getLineWidth: f => {
      const isHovered = hoveredName && f.properties.country_name === hoveredName;
      return isHovered ? 1.2 : 0.45;
    },
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 0.45,
    parameters: {
      depthTest: false,
      cullFace: "back"
    },
    updateTriggers: {
      getLineColor: [hoveredName],
      getLineWidth: [hoveredName]
    }
  });
}

function getLayers() {
  return [
    makeEarthLayer(),
    makeCountriesFillLayer(),
    makeCountriesBorderLayer()
  ];
}

function updateLegend() {
  const title = document.getElementById("legendTitle");
  const box = document.getElementById("legendItems");
  if (!title || !box) return;

  box.innerHTML = "";
  title.textContent = "Nombre de projets";

  const palette = getActivePalette();

  palette.forEach(c => {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `
      <div class="legend-swatch" style="background:rgba(${c.color[0]},${c.color[1]},${c.color[2]},${c.color[3] / 255});"></div>
      <div>${c.label}</div>
    `;
    box.appendChild(row);
  });
}

function updateStatsCards() {
  let coveredCountries = 0;

  geoFeatures.forEach(f => {
    const props = f.properties;
    const presence = getScopePresence(props);
    if (presence > 0) coveredCountries += 1;
  });

  let totalProjects = 0;
  let totalAmount = 0;

  const totals = geoMetadata?.totals_unique || null;

  if (totals) {
    if (scope === "all") {
      totalProjects = Number(totals.projects_all || 0);
      totalAmount = Number(totals.amount_all || 0);
    } else if (scope === "hydro") {
      totalProjects = Number(totals.projects_hydroconseil || 0);
      totalAmount = Number(totals.amount_hydroconseil || 0);
    } else if (scope === "nexsom") {
      totalProjects = Number(totals.projects_nexsom || 0);
      totalAmount = Number(totals.amount_nexsom || 0);
    } else if (scope === "urba") {
      totalProjects = Number(totals.projects_urbaconsulting || 0);
      totalAmount = Number(totals.amount_urbaconsulting || 0);
    }
  } else {
    geoFeatures.forEach(f => {
      const props = f.properties;
      const presence = getScopePresence(props);

      if (presence > 0) {
        totalProjects += Number(props.project_count || 0);
        totalAmount += Number(props.amount_total || 0);
      }
    });
  }

  const countriesEl = document.getElementById("stat-countries");
  const projectsEl = document.getElementById("stat-projects");
  const amountEl = document.getElementById("stat-amount");

  if (countriesEl) countriesEl.textContent = numberFmt(coveredCountries);
  if (projectsEl) projectsEl.textContent = numberFmt(totalProjects);
  if (amountEl) amountEl.textContent = amountShort(totalAmount).replace(" EUR", " €");
}

function updateTooltip(info) {
  const tooltip = document.getElementById("tooltip");
  if (!tooltip) return;

  if (!info.object) {
    tooltip.style.display = "none";
    return;
  }

  const props = info.object.properties;
  const presence = getScopePresence(props);

  const presenceLabel =
    scope === "all" ? "Groupe" :
    scope === "hydro" ? "Hydroconseil" :
    scope === "nexsom" ? "Nexsom" :
    "Urbaconsulting";

  tooltip.innerHTML = `
    <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#101820;">
      ${props.country_name || "Pays"}
    </div>
    <div style="font-size:12px;line-height:1.55;color:#31424f;">
      <span style="color:#5f7283;">Présence ${presenceLabel} :</span>
      <b>${presence ? "Oui" : "Non"}</b><br/>
      <span style="color:#5f7283;">Nombre total de projets :</span>
      <b>${numberFmt(props.project_count || 0)}</b><br/>
      <span style="color:#5f7283;">Montant total :</span>
      <b>${numberFmt(Math.round(props.amount_total || 0))} EUR</b>
    </div>
  `;

  tooltip.style.left = `${info.x + 16}px`;
  tooltip.style.top = `${info.y + 16}px`;
  tooltip.style.display = "block";
}

function refreshMap() {
  if (!deckgl) return;

  updateStatsCards();
  updateLegend();

  deckgl.setProps({ layers: getLayers() });

  const btnScopeAll = document.getElementById("btnScopeAll");
  const btnScopeHydro = document.getElementById("btnScopeHydro");
  const btnScopeNexsom = document.getElementById("btnScopeNexsom");
  const btnScopeUrba = document.getElementById("btnScopeUrba");

  if (btnScopeAll) btnScopeAll.classList.toggle("active", scope === "all");
  if (btnScopeHydro) btnScopeHydro.classList.toggle("active", scope === "hydro");
  if (btnScopeNexsom) btnScopeNexsom.classList.toggle("active", scope === "nexsom");
  if (btnScopeUrba) btnScopeUrba.classList.toggle("active", scope === "urba");
}

function pauseAutoRotate() {
  autoRotate = false;
  if (resumeRotateTimeout) clearTimeout(resumeRotateTimeout);
  resumeRotateTimeout = setTimeout(() => {
    autoRotate = true;
  }, 1600);
}

function animateRotation() {
  if (!deckgl) return;

  if (autoRotate) {
    currentViewState = {
      ...currentViewState,
      longitude: currentViewState.longitude + 0.02
    };

    deckgl.setProps({ viewState: currentViewState });
  }

  requestAnimationFrame(animateRotation);
}

document.addEventListener("DOMContentLoaded", () => {
  const btnScopeAll = document.getElementById("btnScopeAll");
  const btnScopeHydro = document.getElementById("btnScopeHydro");
  const btnScopeNexsom = document.getElementById("btnScopeNexsom");
  const btnScopeUrba = document.getElementById("btnScopeUrba");

  if (btnScopeAll) {
    btnScopeAll.addEventListener("click", () => {
      scope = "all";
      hoveredName = null;
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (btnScopeHydro) {
    btnScopeHydro.addEventListener("click", () => {
      scope = "hydro";
      hoveredName = null;
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (btnScopeNexsom) {
    btnScopeNexsom.addEventListener("click", () => {
      scope = "nexsom";
      hoveredName = null;
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (btnScopeUrba) {
    btnScopeUrba.addEventListener("click", () => {
      scope = "urba";
      hoveredName = null;
      refreshMap();
      pauseAutoRotate();
    });
  }

  fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error(`countries_external.geojson introuvable (${r.status})`);
      return r.json();
    })
    .then(geojson => {
      geoMetadata = geojson?.metadata || null;

      geoFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
      countriesFeatureCollection = {
        type: "FeatureCollection",
        features: geoFeatures
      };

      deckgl = new Deck({
        parent: document.getElementById("container"),
        views: [new _GlobeView()],
        controller: true,
        viewState: currentViewState,
        layers: getLayers(),
        parameters: {
          clearColor: [1, 1, 1, 1]
        },
        onViewStateChange: ({ viewState, interactionState }) => {
          currentViewState = { ...viewState };

          if (
            interactionState.isDragging ||
            interactionState.isZooming ||
            interactionState.isRotating
          ) {
            pauseAutoRotate();
          }

          if (deckgl) {
            deckgl.setProps({ viewState: currentViewState });
          }
        }
      });

      refreshMap();
      animateRotation();

      window.addEventListener("resize", () => {
        if (deckgl) deckgl.setProps({ viewState: currentViewState });
      });
    })
    .catch(err => {
      console.error("Erreur chargement données :", err);

      ["stat-projects", "stat-countries", "stat-amount"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
      });
    });
});
