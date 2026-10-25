"use strict";

// ---------- Settings ----------
// Bounding boxes: [south, west, north, east]
var AREAS = {
  islamabad:  { bbox: [33.48, 72.82, 33.82, 73.30], center: [33.684, 73.048], zoom: 11 },
  rawalpindi: { bbox: [33.50, 72.95, 33.72, 73.15], center: [33.598, 73.045], zoom: 12 }
};

// Green space categories (key is used by the type filter)
var CATS = {
  park:       { label: "Park",              color: "#2a9d5c" },
  garden:     { label: "Garden",            color: "#8e44ad" },
  playground: { label: "Playground",        color: "#e67e22" },
  recreation: { label: "Recreation ground", color: "#1f6feb" },
  reserve:    { label: "Nature reserve",    color: "#00838f" }
};

var ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

// ---------- Page elements ----------
var cityEl = document.getElementById("city");
var typeEl = document.getElementById("type");
var searchEl = document.getElementById("search");
var namedEl = document.getElementById("named");
var statusEl = document.getElementById("status");
var listEl = document.getElementById("list");

// ---------- Map ----------
var map = L.map("map").setView(AREAS.islamabad.center, AREAS.islamabad.zoom);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

var legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  var d = L.DomUtil.create("div", "legend");
  d.innerHTML = Object.keys(CATS).map(function (k) {
    return '<div><i style="background:' + CATS[k].color + '"></i>' + CATS[k].label + "</div>";
  }).join("");
  return d;
};
legend.addTo(map);

var layer = L.layerGroup().addTo(map);
var features = [];
var requestId = 0;

// ---------- Helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function setStatus(msg, isError, retry) {
  statusEl.className = isError ? "error" : "";
  statusEl.textContent = msg;
  if (retry) {
    var b = document.createElement("button");
    b.textContent = "Retry";
    b.onclick = loadData;
    statusEl.appendChild(b);
  }
}

// Decide which category an OSM feature belongs to
function catOf(tags) {
  if (tags.leisure === "park") return "park";
  if (tags.leisure === "garden") return "garden";
  if (tags.leisure === "playground") return "playground";
  if (tags.leisure === "nature_reserve") return "reserve";
  if (tags.landuse === "recreation_ground") return "recreation";
  return null;
}

// ---------- API ----------
function buildQuery(b) {
  var bb = b.join(",");
  return "[out:json][timeout:40];(" +
    'nwr["leisure"="park"](' + bb + ");" +
    'nwr["leisure"="garden"](' + bb + ");" +
    'nwr["leisure"="playground"](' + bb + ");" +
    'nwr["leisure"="nature_reserve"](' + bb + ");" +
    'nwr["landuse"="recreation_ground"](' + bb + ");" +
    ");out center tags;";
}

function fetchOverpass(query) {
  // Try each server in turn; throw if all fail
  var i = 0;
  function attempt() {
    return fetch(ENDPOINTS[i], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query)
    }).then(function (res) {
      if (!res.ok) throw new Error("Server responded with status " + res.status);
      return res.json();
    }).catch(function (err) {
      i++;
      if (i < ENDPOINTS.length) return attempt();
      throw err;
    });
  }
  return attempt();
}

// Turn the JSON response into a simple list of green spaces
function parse(json) {
  return (json.elements || []).map(function (el) {
    var lat = el.lat !== undefined ? el.lat : (el.center && el.center.lat);
    var lon = el.lon !== undefined ? el.lon : (el.center && el.center.lon);
    var tags = el.tags || {};
    var cat = catOf(tags);
    if (lat === undefined || lon === undefined || !cat) return null;
    var name = tags.name || tags["name:en"];
    return {
      id: el.type + "/" + el.id,
      lat: lat, lon: lon,
      cat: cat,
      named: !!name,
      name: name || "Unnamed " + CATS[cat].label.toLowerCase(),
      tags: tags
    };
  }).filter(Boolean);
}

function loadData() {
  var area = AREAS[cityEl.value];
  var myId = ++requestId;
  layer.clearLayers();
  listEl.innerHTML = "";
  features = [];
  map.setView(area.center, area.zoom);
  setStatus("Loading green spaces for " + cityEl.options[cityEl.selectedIndex].text + "…");

  fetchOverpass(buildQuery(area.bbox)).then(function (json) {
    if (myId !== requestId) return; // a newer request replaced this one
    features = parse(json);
    render();
  }).catch(function (err) {
    if (myId !== requestId) return;
    setStatus("Could not load data (" + err.message + "). Check your internet connection.", true, true);
  });
}

// ---------- Popup ----------
function popupHtml(f) {
  var t = f.tags;
  var rows = [["Type", CATS[f.cat].label]];
  if (t.leisure) rows.push(["OSM tag", "leisure = " + esc(t.leisure)]);
  else if (t.landuse) rows.push(["OSM tag", "landuse = " + esc(t.landuse)]);
  if (t.access) rows.push(["Access", esc(t.access)]);
  if (t.opening_hours) rows.push(["Hours", esc(t.opening_hours)]);
  if (t.operator) rows.push(["Operator", esc(t.operator)]);
  if (t.surface) rows.push(["Surface", esc(t.surface)]);
  var addr = [t["addr:street"], t["addr:suburb"], t["addr:city"]].filter(Boolean).join(", ");
  if (addr) rows.push(["Address", esc(addr)]);
  var site = t.website || t["contact:website"];
  if (site && /^https?:\/\//i.test(site)) rows.push(["Website", '<a href="' + esc(site) + '" target="_blank" rel="noopener">Open</a>']);
  rows.push(["Source", '<a href="https://www.openstreetmap.org/' + f.id + '" target="_blank" rel="noopener">OSM record</a>']);
  return '<div class="popup"><h3>' + esc(f.name) + "</h3><table>" +
    rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") +
    "</table></div>";
}

// ---------- Draw markers + list (applies filter, search and named-only) ----------
function render() {
  var type = typeEl.value;
  var q = searchEl.value.trim().toLowerCase();
  var namedOnly = namedEl.checked;
  layer.clearLayers();
  listEl.innerHTML = "";

  var shown = features.filter(function (f) {
    return (type === "all" || f.cat === type) &&
           (!namedOnly || f.named) &&
           (!q || f.name.toLowerCase().indexOf(q) !== -1);
  });
  shown.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var frag = document.createDocumentFragment();
  shown.forEach(function (f) {
    var marker = L.circleMarker([f.lat, f.lon], {
      radius: 7, color: "#fff", weight: 1.5, fillColor: CATS[f.cat].color, fillOpacity: 0.9
    }).bindPopup(popupHtml(f));
    marker.addTo(layer);

    var li = document.createElement("li");
    li.className = "item";
    li.tabIndex = 0;
    var dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = CATS[f.cat].color;
    var txt = document.createElement("span");
    txt.textContent = f.name;
    var small = document.createElement("small");
    small.textContent = CATS[f.cat].label;
    txt.appendChild(small);
    li.appendChild(dot);
    li.appendChild(txt);
    function go() { map.setView([f.lat, f.lon], 17); marker.openPopup(); }
    li.addEventListener("click", go);
    li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    frag.appendChild(li);
  });
  listEl.appendChild(frag);

  if (features.length === 0) {
    setStatus("No green spaces were returned for this area.");
  } else if (shown.length === 0) {
    setStatus("No matches. Try a different name or type.");
  } else {
    setStatus("Showing " + shown.length + " of " + features.length + " green spaces.");
  }
}

// ---------- Events ----------
cityEl.addEventListener("change", loadData);
typeEl.addEventListener("change", render);
searchEl.addEventListener("input", render);
namedEl.addEventListener("change", render);

loadData();
