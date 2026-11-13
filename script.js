const svg = d3.select("#map");
const tooltip = document.querySelector("#tooltip");
const yearSlider = document.querySelector("#year");
const yearOut = document.querySelector("#yearOut");
const yearChip = document.querySelector("#yearChip");
const buttonWrap = document.querySelector("#scenario-buttons");
const legendEl = document.querySelector("#legend");

const BANDS = [
    { id: "arctic", short: "Arctic", label: "Arctic (60\u201390\u00B0N)", y0: 60, y1: 90, source: "Arctic (60-90 N)" },
    { id: "ntemp", short: "N. Temperate", label: "N. Temperate (23.5\u201360\u00B0N)", y0: 23.5, y1: 60, interp: ["arctic", "tropics"] },
    { id: "tropics", short: "Tropics", label: "Tropics (23.5\u00B0S\u201323.5\u00B0N)", y0: -23.5, y1: 23.5, source: "Tropics (23.5 S-23.5 N)" },
    { id: "stemp", short: "S. Temperate", label: "S. Temperate (23.5\u201360\u00B0S)", y0: -60, y1: -23.5, interp: ["tropics", "antarctic"] },
    { id: "antarctic", short: "Antarctic", label: "Antarctic (60\u201390\u00B0S)", y0: -90, y1: -60, source: "Antarctic (60-90 S)" }
];

const SCENARIO_LABELS = {
    ssp126: "SSP1-2.6",
    ssp245: "SSP2-4.5",
    ssp585: "SSP5-8.5"
};

const SCENARIO_ACCENT = {
    ssp126: "#187d75",
    ssp245: "#a76200",
    ssp585: "#bc4052"
};

const KEY_YEARS = [2025, 2050, 2075, 2100];

const WIDTH = 900;
const HEIGHT = 420;
const SIDEBAR_W = 130;
const MAP_PAD = 10;

let byRegion;
let colorScale;
let projection;
let path;
let zoom;
let g;
let sidebarG;
let calloutG;
let bandHighlights = {};
let hoveredBand = null;
let focusedBand = null;
let currentScenario = "ssp245";
let currentYear = 2050;

function getBandValue(band, scenario, year) {
    if (band.source) {
        const rows = byRegion.get(band.source)?.get(scenario) || [];
        const row = rows.find((d) => d.year === year);
        return row ? row.anomaly_c : null;
    }
    const vals = band.interp
        .map((id) => getBandValue(BANDS.find((b) => b.id === id), scenario, year))
        .filter((v) => v != null);
    return vals.length ? d3.mean(vals) : null;
}

function getGlobalValue(scenario, year) {
    const rows = byRegion.get("Global")?.get(scenario) || [];
    const row = rows.find((d) => d.year === year);
    return row ? row.anomaly_c : null;
}

function bandAtLat(lat) {
    for (const band of BANDS) {
        const lo = Math.min(band.y0, band.y1);
        const hi = Math.max(band.y0, band.y1);
        if (lat >= lo && lat <= hi) return band;
    }
    return null;
}

function gradientStops() {
    return [
        { lat: 90, band: "arctic" },
        { lat: 62, band: "arctic" },
        { lat: 58, band: "ntemp" },
        { lat: 25.5, band: "ntemp" },
        { lat: 21.5, band: "tropics" },
        { lat: 0, band: "tropics" },
        { lat: -21.5, band: "tropics" },
        { lat: -25.5, band: "stemp" },
        { lat: -58, band: "stemp" },
        { lat: -62, band: "antarctic" },
        { lat: -90, band: "antarctic" }
    ];
}

function updateGradient() {
    const grad = svg.select("#latGrad");
    grad.selectAll("stop").remove();
    const yTop = projection([0, 90])[1];
    const yBot = projection([0, -90])[1];
    const total = yBot - yTop;
    for (const s of gradientStops()) {
        const y = projection([0, s.lat])[1];
        const offset = (y - yTop) / total;
        const band = BANDS.find((b) => b.id === s.band);
        const val = getBandValue(band, currentScenario, currentYear);
        grad.append("stop")
            .attr("offset", offset.toFixed(4))
            .attr("stop-color", val != null ? colorScale(val) : "#cccccc");
    }
}

function updateSidebar() {
    sidebarG.selectAll(".sidebar-value").each(function () {
        const id = this.getAttribute("data-id");
        const band = BANDS.find((b) => b.id === id);
        const val = getBandValue(band, currentScenario, currentYear);
        d3.select(this).text(val != null ? (val >= 0 ? "+" : "") + val.toFixed(2) + "\u00B0C" : "\u2014");
    });
    sidebarG.selectAll(".sidebar-swatch").each(function () {
        const id = this.getAttribute("data-id");
        const band = BANDS.find((b) => b.id === id);
        const val = getBandValue(band, currentScenario, currentYear);
        d3.select(this).attr("fill", val != null ? colorScale(val) : "#cccccc");
    });
}

function updateBandStyles() {
    const activeId = hoveredBand || focusedBand;
    for (const id of Object.keys(bandHighlights)) {
        bandHighlights[id].style("opacity", id === activeId ? 1 : 0);
    }
    sidebarG.selectAll(".sidebar-label").each(function () {
        const id = this.getAttribute("data-id");
        d3.select(this).attr("font-weight", id === activeId ? 800 : 600);
    });
    sidebarG.selectAll(".sidebar-bg").each(function () {
        const id = this.getAttribute("data-id");
        d3.select(this).attr("fill", id === focusedBand ? "rgba(45, 111, 131, 0.08)" : "transparent");
    });
}

function updateSliderColor() {
    const avg = getGlobalValue(currentScenario, currentYear);
    if (avg == null) return;
    const c = colorScale(avg);
    yearSlider.style.accentColor = c;
    yearChip.style.background = c;
}

function renderCallout(band) {
    calloutG.selectAll("*").remove();
    if (!band) {
        calloutG.transition().duration(250).style("opacity", 0);
        return;
    }
    const W = 380;
    const H = 132;
    const X = WIDTH - W - 20;
    const Y = 15;
    const colX = [X + 135, X + 210, X + 285, X + 360];

    calloutG.append("rect")
        .attr("x", X).attr("y", Y)
        .attr("width", W).attr("height", H)
        .attr("rx", 8)
        .attr("fill", "rgba(255,255,255,0.96)")
        .attr("stroke", "#1f3540")
        .attr("stroke-width", 1);

    calloutG.append("text")
        .attr("x", X + 14).attr("y", Y + 22)
        .attr("font-size", 12).attr("font-weight", 700)
        .attr("fill", "#173342")
        .text(band.label);

    KEY_YEARS.forEach((yr, i) => {
        calloutG.append("text")
            .attr("x", colX[i]).attr("y", Y + 46)
            .attr("font-size", 10).attr("fill", "#52616a")
            .attr("text-anchor", "end")
            .text(yr);
    });

    const rowY = [Y + 70, Y + 93, Y + 116];
    ["ssp126", "ssp245", "ssp585"].forEach((s, i) => {
        calloutG.append("circle")
            .attr("cx", X + 16).attr("cy", rowY[i] - 4)
            .attr("r", 4)
            .attr("fill", SCENARIO_ACCENT[s]);
        calloutG.append("text")
            .attr("x", X + 26).attr("y", rowY[i])
            .attr("font-size", 11).attr("fill", "#22313b")
            .text(SCENARIO_LABELS[s]);
        KEY_YEARS.forEach((yr, j) => {
            const v = getBandValue(band, s, yr);
            const text = v != null ? (v >= 0 ? "+" : "") + v.toFixed(2) : "\u2014";
            calloutG.append("text")
                .attr("x", colX[j]).attr("y", rowY[i])
                .attr("font-size", 11).attr("fill", "#22313b")
                .attr("text-anchor", "end")
                .attr("font-variant-numeric", "tabular-nums")
                .text(text);
        });
    });

    calloutG.transition().duration(250).style("opacity", 1);
}

function buildMap(land) {
    projection = d3.geoNaturalEarth1()
        .fitExtent(
            [[SIDEBAR_W + MAP_PAD, MAP_PAD], [WIDTH - MAP_PAD, HEIGHT - MAP_PAD]],
            { type: "Sphere" }
        );
    path = d3.geoPath(projection);

    svg.attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    svg.selectAll("*").remove();

    const yTop = projection([0, 90])[1];
    const yBot = projection([0, -90])[1];

    const defs = svg.append("defs");
    defs.append("linearGradient")
        .attr("id", "latGrad")
        .attr("gradientUnits", "userSpaceOnUse")
        .attr("x1", 0).attr("x2", 0)
        .attr("y1", yTop).attr("y2", yBot);

    g = svg.append("g");

    g.append("path")
        .datum({ type: "Sphere" })
        .attr("d", path)
        .attr("fill", "url(#latGrad)")
        .attr("stroke", "#9db4c0")
        .attr("stroke-width", 1);

    g.append("path")
        .datum(d3.geoGraticule10())
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 0.5)
        .attr("opacity", 0.35)
        .style("pointer-events", "none");

    if (land) {
        g.append("path")
            .datum(land)
            .attr("d", path)
            .attr("fill", "none")
            .attr("stroke", "#1f3540")
            .attr("stroke-width", 0.7)
            .attr("opacity", 0.55)
            .style("pointer-events", "none");
    }

    const xLeft = projection([-180, 0])[0];
    const xRight = projection([180, 0])[0];
    for (const band of BANDS) {
        const bTop = projection([0, Math.min(band.y1, 89.9)])[1];
        const bBot = projection([0, Math.max(band.y0, -89.9)])[1];
        bandHighlights[band.id] = g.append("rect")
            .attr("x", xLeft)
            .attr("y", bTop)
            .attr("width", xRight - xLeft)
            .attr("height", bBot - bTop)
            .attr("fill", "rgba(255,255,255,0.12)")
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 1.5)
            .attr("stroke-dasharray", "5,3")
            .attr("vector-effect", "non-scaling-stroke")
            .style("pointer-events", "none")
            .style("opacity", 0)
            .style("transition", "opacity 0.15s");
    }

    zoom = d3.zoom()
        .scaleExtent([1, 12])
        .filter(() => false)
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            const zoomed = event.transform.k > 1.05;
            sidebarG.style("opacity", zoomed ? 0 : 1);
            sidebarG.style("pointer-events", zoomed ? "none" : "auto");
        });
    svg.call(zoom);

    const overlay = g.append("rect")
        .attr("class", "overlay")
        .attr("x", 0).attr("y", 0)
        .attr("width", WIDTH).attr("height", HEIGHT)
        .attr("fill", "transparent");

    overlay.on("pointermove", (event) => {
        const [px, py] = d3.pointer(event, g.node());
        const geo = projection.invert([px, py]);
        if (!geo || !Number.isFinite(geo[1])) {
            hoveredBand = null;
            updateBandStyles();
            hideTooltip();
            return;
        }
        const band = bandAtLat(geo[1]);
        hoveredBand = band ? band.id : null;
        updateBandStyles();
        if (band) showTooltip(event, band);
        else hideTooltip();
    });

    overlay.on("pointerleave", () => {
        hoveredBand = null;
        updateBandStyles();
        hideTooltip();
    });

    overlay.on("click", (event) => {
        const [px, py] = d3.pointer(event, g.node());
        const geo = projection.invert([px, py]);
        if (!geo) return;
        const band = bandAtLat(geo[1]);
        if (!band) return;
        toggleBandFocus(band);
    });

    sidebarG = svg.append("g").attr("class", "sidebar");
    for (const band of BANDS) {
        const bTop = projection([0, Math.min(band.y1, 89.9)])[1];
        const bBot = projection([0, Math.max(band.y0, -89.9)])[1];
        const yMid = (bTop + bBot) / 2;

        const row = sidebarG.append("g")
            .attr("class", "sidebar-row")
            .attr("data-id", band.id)
            .style("cursor", "pointer");

        row.append("rect")
            .attr("class", "sidebar-bg")
            .attr("data-id", band.id)
            .attr("x", 0).attr("y", bTop)
            .attr("width", SIDEBAR_W).attr("height", bBot - bTop)
            .attr("fill", "transparent");

        row.append("rect")
            .attr("class", "sidebar-swatch")
            .attr("data-id", band.id)
            .attr("x", 6).attr("y", yMid - 7)
            .attr("width", 10).attr("height", 14)
            .attr("rx", 2)
            .attr("fill", "#cccccc")
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 1);

        row.append("text")
            .attr("class", "sidebar-label")
            .attr("data-id", band.id)
            .attr("x", 22).attr("y", yMid - 1)
            .attr("font-size", 11.5)
            .attr("font-weight", 600)
            .attr("fill", "#22313b")
            .text(band.short);

        row.append("text")
            .attr("class", "sidebar-value")
            .attr("data-id", band.id)
            .attr("x", 22).attr("y", yMid + 13)
            .attr("font-size", 11)
            .attr("fill", "#52616a")
            .attr("font-variant-numeric", "tabular-nums")
            .text("\u2014");

        row.on("mouseenter", () => {
            hoveredBand = band.id;
            updateBandStyles();
        });
        row.on("mouseleave", () => {
            hoveredBand = null;
            updateBandStyles();
        });
        row.on("click", () => toggleBandFocus(band));
    }

    calloutG = svg.append("g").attr("class", "callout").style("opacity", 0);
}

function toggleBandFocus(band) {
    if (focusedBand === band.id) {
        focusedBand = null;
        renderCallout(null);
        svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);
    } else {
        focusedBand = band.id;
        renderCallout(band);
        zoomToBand(band);
    }
    updateBandStyles();
}

function zoomToBand(band) {
    const yHi = Math.min(band.y1, 89.9);
    const yLo = Math.max(band.y0, -89.9);
    const corners = [];
    for (const lat of [yLo, yHi]) {
        for (const lon of [-180, 0, 180]) {
            const p = projection([lon, lat]);
            if (p) corners.push(p);
        }
    }
    const x0 = d3.min(corners, (c) => c[0]);
    const x1 = d3.max(corners, (c) => c[0]);
    const y0 = d3.min(corners, (c) => c[1]);
    const y1 = d3.max(corners, (c) => c[1]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const scale = Math.min(12, 0.9 / Math.max(dx / WIDTH, dy / HEIGHT));
    const tx = WIDTH / 2 - scale * (x0 + x1) / 2;
    const ty = HEIGHT / 2 - scale * (y0 + y1) / 2;
    svg.transition().duration(700).call(
        zoom.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
}

function showTooltip(event, band) {
    const val = getBandValue(band, currentScenario, currentYear);
    const valText = val != null
        ? `${val >= 0 ? "+" : ""}${val.toFixed(2)} \u00B0C`
        : "No data";
    tooltip.innerHTML =
        `<strong>${band.label}</strong><br>` +
        `${SCENARIO_LABELS[currentScenario]} \u00B7 ${currentYear}<br>` +
        `<span style="font-size:1.15em;font-weight:bold">${valText}</span><br>` +
        `<span style="opacity:0.65;font-size:0.85em">Click to focus &middot; click again to reset</span>`;
    tooltip.style.display = "block";
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
}

function hideTooltip() {
    tooltip.style.display = "none";
}

function updateAll() {
    updateGradient();
    updateSidebar();
    updateSliderColor();
}

function buildLegend() {
    legendEl.innerHTML = "";
    const domain = colorScale.domain();
    const stops = d3.range(11).map((i) => colorScale(domain[0] + (i / 10) * (domain[1] - domain[0])));
    const bar = document.createElement("div");
    bar.className = "legend-bar";
    bar.innerHTML =
        `<span>${domain[0].toFixed(1)}\u00B0C</span>` +
        `<div class="legend-gradient" style="background:linear-gradient(to right,${stops.join(",")})"></div>` +
        `<span>${domain[1].toFixed(1)}\u00B0C</span>`;
    legendEl.appendChild(bar);
}

function syncButtons() {
    buttonWrap.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b.dataset.id === currentScenario);
    });
}

Promise.all([
    d3.csv("temperature_projection.csv", d3.autoType),
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json")
        .then((r) => r.json())
        .catch(() => null)
]).then(([rows, topo]) => {
    byRegion = d3.group(rows, (d) => d.region, (d) => d.scenario);
    const land = topo ? topojson.feature(topo, topo.objects.land) : null;

    const allAnomalies = [];
    for (const band of BANDS) {
        if (!band.source) continue;
        for (const scenario of ["ssp126", "ssp245", "ssp585"]) {
            const vals = byRegion.get(band.source)?.get(scenario) || [];
            for (const row of vals) {
                if (row.anomaly_c != null) allAnomalies.push(row.anomaly_c);
            }
        }
    }
    const maxA = (d3.max(allAnomalies) || 10) * 1.05;
    colorScale = d3.scaleSequential(d3.interpolateOrRd)
        .domain([0, maxA])
        .clamp(true);

    buildMap(land);
    buildLegend();
    syncButtons();
    updateAll();

    yearSlider.addEventListener("input", () => {
        currentYear = Number(yearSlider.value);
        yearOut.textContent = currentYear;
        updateAll();
    });

    buttonWrap.addEventListener("click", (event) => {
        const btn = event.target.closest("button");
        if (!btn) return;
        currentScenario = btn.dataset.id;
        syncButtons();
        updateAll();
    });
}).catch((err) => {
    console.error(err);
    const p = document.createElement("p");
    p.className = "source";
    p.textContent =
        "Could not load temperature_projection.csv. If you opened this page from disk (file://), " +
        "serve the folder over HTTP (e.g. python3 -m http.server) or view the deployed version.";
    document.querySelector("main").appendChild(p);
});
