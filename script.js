const { Deck, GeoJsonLayer, _GlobeView } = deck;

const DATA_URL = "./countries_external.geojson?v=1";

let mode = "projects"; // "projects" | "amount"
let scope = "all";     // "all" | "hydro" | "nexsom" | "urba"

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
let amountBreaks = [0, 0, 0, 0, 0];

const PALETTE_BLUE = {
  project: [
    { label: "0", color: [232, 238, 244, 255] },
    { label: "1", color: [210, 225, 242, 255] },
    { label: "2–3", color: [166, 198, 232, 255] },
    { label: "4–5", color: [119, 168, 218, 255] },
    { label: "6–10", color: [66, 127, 194, 255] },
    { label: "10+", color: [10, 77, 156, 255] }
  ],
  amount: [
    [232, 238, 244, 255],
    [210, 225, 242, 255],
    [166, 198, 232, 255],
    [119, 168, 218, 255],
    [66, 127, 194, 255],
    [10, 77, 156, 255]
  ],
  presence: {
    no: [232, 238, 244, 255],
    yes: [31, 111, 191, 255]
  }
};

const PALETTE_ORANGE = {
  project: [
    { label: "0", color: [242, 238, 232, 255] },
    { label: "1", color: [253, 224, 178, 255] },
    { label: "2–3", color: [253, 187, 99, 255] },
    { label: "4–5", color: [240, 134, 28, 255] },
    { label: "6–10", color: [210, 82, 8, 255] },
    { label: "10+", color: [155, 45, 2, 255] }
  ],
  amount: [
    [242, 238, 232, 255],
    [253, 224, 178, 255],
    [253, 187, 99, 255],
    [240, 134, 28, 255],
    [210, 82, 8, 255],
    [155, 45, 2, 255]
  ],
  presence: {
    no: [242, 238, 232, 255],
    yes: [214, 106, 18, 255]
  }
};

const PALETTE_GREEN = {
  project: [
    { label: "0", color: [235, 242, 236, 255] },
    { label: "1", color: [198, 239, 210, 255] },
    { label: "2–3", color: [129, 204, 155, 255] },
    { label: "4–5", color: [65, 171, 103, 255] },
    { label: "6–10", color: [30, 130, 65, 255] },
    { label: "10+", color: [10, 85, 35, 255] }
  ],
  amount: [
    [235, 242, 236, 255],
    [198, 239, 210, 255],
    [129, 204, 155, 255],
    [65, 171, 103, 255],
    [30, 130, 65, 255],
    [10, 85, 35, 255]
  ],
  presence: {
    no: [235, 242, 236, 255],
    yes: [25, 133, 67, 255]
  }
};

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

function computeAmountBreaks(values) {
  const arr = values.filter(v => v > 0).sort((a, b) => a - b);
  if (!arr.length) return [0, 0, 0, 0, 0];
  const q = p => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return [q(0.2), q(0.4), q(0.6), q(0.8), q(0.95)];
}

function getScopePresence(props) {
  if (scope === "all") return Number(props.has_any_project || 0);
  if (scope === "hydro") return Number(props.has_hydroconseil || 0);
  if (scope === "nexsom") return Number(props.has_nexsom || 0);
  if (scope === "urba") return Number(props.has_urbaconsulting || 0);
  return 0;
}

function getScopeProjectValue(props) {
  if (scope === "all") {
    return Number(props.project_count || 0);
  }

  return getScopePresence(props) ? Number(props.project_count || 0) : 0;
}

function getScopeAmountValue(props) {
  if (scope === "all") {
    return Number(props.amount_total || 0);
  }

  return getScopePresence(props) ? Number(props.amount_total || 0) : 0;
}

function getProjectColor(v) {
  const palette = getActivePalette().project;
  if (!v || v <= 0) return palette[0].color;
  if (v <= 1) return palette[1].color;
  if (v <= 3) return palette[2].color;
  if (v <= 5) return palette[3].color;
  if (v <= 10) return palette[4].color;
  return palette[5].color;
}

function getAmountColor(v) {
  const palette = getActivePalette().amount;
  if (!v || v <= 0) return palette[0];
  if (v <= amountBreaks[0]) return palette[1];
  if (v <= amountBreaks[1]) return palette[2];
  if (v <= amountBreaks[2]) return palette[3];
  if (v <= amountBreaks[3]) return palette[4];
  return palette[5];
}

function getFillColor(props) {
  const isHovered = hoveredName && props.country_name === hoveredName;
  let color;

  if (mode === "projects") {
    color = getProjectColor(getScopeProjectValue(props));
  } else {
    color = getAmountColor(getScopeAmountValue(props));
  }

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
    parameters: { depthTest: true, cullFace: "back" }
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
    parameters: { depthTest: true, cullFace: "back" },
    updateTriggers: {
      getFillColor: [mode, scope, hoveredName, amountBreaks.join("-")]
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
    parameters: { depthTest: false, cullFace: "back" },
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

  const palette = getActivePalette();

  if (mode === "projects") {
    title.textContent = "Nombre de projets";

    palette.project.forEach(c => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <div class="legend-swatch" style="background:rgba(${c.color[0]},${c.color[1]},${c.color[2]},${c.color[3] / 255});"></div>
        <div>${c.label}</div>
      `;
      box.appendChild(row);
    });
  } else {
    title.textContent = "Montant cumulé";

    const labels = [
      "0",
      `≤ ${amountShort(amountBreaks[0])}`,
      `≤ ${amountShort(amountBreaks[1])}`,
      `≤ ${amountShort(amountBreaks[2])}`,
      `≤ ${amountShort(amountBreaks[3])}`,
      `> ${amountShort(amountBreaks[3])}`
    ];

    palette.amount.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `
        <div class="legend-swatch" style="background:rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255});"></div>
        <div>${labels[i]}</div>
      `;
      box.appendChild(row);
    });
  }
}

function updateStatsCards() {
  let coveredCountries = 0;
  let totalProjects = 0;
  let totalAmount = 0;

  geoFeatures.forEach(f => {
    const props = f.properties;
    const presence = getScopePresence(props);
    const projVal = getScopeProjectValue(props);
    const amountVal = getScopeAmountValue(props);

    if (presence > 0) coveredCountries += 1;
    totalProjects += projVal;
    totalAmount += amountVal;
  });

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
      <span style="color:#5f7283;">Nombre de projets :</span>
      <b>${numberFmt(getScopeProjectValue(props))}</b><br/>
      <span style="color:#5f7283;">Montant cumulé :</span>
      <b>${numberFmt(Math.round(getScopeAmountValue(props)))} EUR</b>
    </div>
  `;

  tooltip.style.left = `${info.x + 16}px`;
  tooltip.style.top = `${info.y + 16}px`;
  tooltip.style.display = "block";
}

function updateDerivedValues() {
  amountBreaks = computeAmountBreaks(
    geoFeatures.map(f => getScopeAmountValue(f.properties))
  );
}

function refreshMap() {
  if (!deckgl) return;

  updateDerivedValues();
  updateStatsCards();
  updateLegend();

  deckgl.setProps({ layers: getLayers() });

  const btnProjects = document.getElementById("btnProjects");
  const btnAmount = document.getElementById("btnAmount");
  const btnScopeAll = document.getElementById("btnScopeAll");
  const btnScopeHydro = document.getElementById("btnScopeHydro");
  const btnScopeNexsom = document.getElementById("btnScopeNexsom");
  const btnScopeUrba = document.getElementById("btnScopeUrba");

  if (btnProjects) btnProjects.classList.toggle("active", mode === "projects");
  if (btnAmount) btnAmount.classList.toggle("active", mode === "amount");

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
  const btnProjects = document.getElementById("btnProjects");
  const btnAmount = document.getElementById("btnAmount");
  const btnScopeAll = document.getElementById("btnScopeAll");
  const btnScopeHydro = document.getElementById("btnScopeHydro");
  const btnScopeNexsom = document.getElementById("btnScopeNexsom");
  const btnScopeUrba = document.getElementById("btnScopeUrba");

  if (btnProjects) {
    btnProjects.addEventListener("click", () => {
      mode = "projects";
      refreshMap();
      pauseAutoRotate();
    });
  }

  if (btnAmount) {
    btnAmount.addEventListener("click", () => {
      mode = "amount";
      refreshMap();
      pauseAutoRotate();
    });
  }

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
      geoFeatures = Array.isArray(geojson?.features) ? geojson.features : [];
      countriesFeatureCollection = {
        type: "FeatureCollection",
        features: geoFeatures
      };

      updateDerivedValues();

      deckgl = new Deck({
        parent: document.getElementById("container"),
        views: [new _GlobeView()],
        controller: true,
        viewState: currentViewState,
        layers: getLayers(),
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
