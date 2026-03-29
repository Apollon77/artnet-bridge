// @ts-nocheck
/* eslint-disable */

const $ = (sel) => document.querySelector(sel);

/** Currently loaded config from /api/config */
let config = null;

/** Active WebSocket connections per bridge detail panel */
const wsConnections = new Map();

/** Cached entity lists per bridge for live re-rendering */
const bridgeEntitiesCache = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || json.errors?.join(", ") || `${method} ${url} failed`);
  }
  return json;
}

function toast(el, kind, msg) {
  el.textContent = "";
  const div = document.createElement("div");
  div.className = "toast " + (kind === "ok" ? "ok" : "err");
  div.textContent = msg;
  el.appendChild(div);
}

function fmtAgo(ts) {
  if (!ts) return "never";
  const ms = Date.now() - ts;
  if (ms < 1000) return ms + "ms ago";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  return m + "m ago";
}

function entityValueToRgb(value) {
  if (!value) return null;
  if (value.type === "rgb") {
    return [Math.round(value.r / 257), Math.round(value.g / 257), Math.round(value.b / 257)];
  }
  if (value.type === "rgb-dimmable") {
    var d = value.dim / 65535;
    return [Math.round(value.r / 257 * d), Math.round(value.g / 257 * d), Math.round(value.b / 257 * d)];
  }
  if (value.type === "brightness") {
    var v = Math.round(value.value / 257);
    return [v, v, v];
  }
  return null;
}

/** Create an element with className and textContent */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Create a span.badge */
function badge(text, cls) {
  const span = document.createElement("span");
  span.className = "badge " + (cls || "");
  span.textContent = text;
  return span;
}

/** Create a span.pill */
function pill(text) {
  const span = document.createElement("span");
  span.className = "pill";
  span.textContent = text;
  return span;
}

/** Create a button */
function btn(text, cls, handler) {
  const button = document.createElement("button");
  button.className = "btn " + (cls || "");
  button.textContent = text;
  if (handler) button.addEventListener("click", handler);
  return button;
}

// ── Init ─────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  $("#btnConfig").addEventListener("click", toggleConfigPanel);
  $("#btnRefresh").addEventListener("click", refresh);
  $("#btnDiscover").addEventListener("click", discover);
  $("#btnPair").addEventListener("click", pair);
  $("#btnSaveConfig").addEventListener("click", saveConfig);

  await refresh();
  startStatusPolling();
});

async function refresh() {
  try {
    config = await api("GET", "/api/config");
    renderBridgeCards();
    renderConfigPanel();
    updateGlobalStatus(true);
  } catch {
    updateGlobalStatus(false);
  }
}

// ── Global status indicator ──────────────────────────────────────────────

function updateGlobalStatus(connected) {
  const dot = $("#statusDot");
  const label = $("#statusLabel");
  if (connected) {
    dot.className = "dot connected";
    label.textContent = "Connected";
  } else {
    dot.className = "dot disconnected";
    label.textContent = "Disconnected";
  }
}

// ── Bridge cards (compact view) ──────────────────────────────────────────

async function renderBridgeCards() {
  const root = $("#bridges");

  if (!config || !config.bridges.length) {
    root.textContent = "";
    root.appendChild(el("div", "muted", "No bridges configured. Open Config to add one."));
    return;
  }

  // Fetch runtime status for connection indicators
  let status = null;
  try {
    status = await api("GET", "/api/status");
  } catch {
    // Runtime may not be active
  }

  root.textContent = "";

  for (const bridge of config.bridges) {
    const bs = status?.bridges?.[bridge.id];
    const connected = bs?.connected ?? false;
    const streaming = bs?.streaming;
    const entityCount = bs?.entityCount ?? 0;
    const realtimeCount = bs?.realtimeCount ?? 0;
    const limitedCount = bs?.limitedCount ?? 0;

    const card = document.createElement("div");
    card.className = "bridge-card";
    card.dataset.bridgeId = bridge.id;

    // Header
    const header = el("div", "bridge-header");
    const summary = el("div", "bridge-summary");
    const dot = el("span", "dot " + (connected ? "connected" : "disconnected"));
    summary.appendChild(dot);
    summary.appendChild(el("strong", null, bridge.name || bridge.id));
    summary.appendChild(pill(bridge.protocol));
    if (streaming === true) summary.appendChild(pill("streaming"));
    else if (streaming === false) summary.appendChild(pill("idle"));

    header.appendChild(summary);

    const actions = el("div", "row");
    if (bridge.protocol === "hue") {
      const link = document.createElement("a");
      link.className = "btn small";
      link.href = "/protocol/hue/";
      // Opens in same tab — Hue config page has a "Back" link
      link.textContent = "Hue UI";
      actions.appendChild(link);
    }
    const toggleBtn = btn("Show Details", "small btn-toggle-detail");
    actions.appendChild(toggleBtn);
    header.appendChild(actions);
    card.appendChild(header);

    // Meta
    const meta = el("div", "bridge-meta",
      entityCount + " entities (" + realtimeCount + " realtime, " + limitedCount + " limited) \u00b7 Universe " + bridge.universe);
    card.appendChild(meta);

    // Detail container
    const detailDiv = el("div", "bridge-detail");
    detailDiv.id = "detail-" + bridge.id;
    card.appendChild(detailDiv);

    toggleBtn.addEventListener("click", () => {
      const isOpen = detailDiv.classList.contains("open");
      if (isOpen) {
        closeDetail(bridge.id, detailDiv, toggleBtn);
      } else {
        openDetail(bridge.id, detailDiv, toggleBtn);
      }
    });

    root.appendChild(card);
  }
}

// ── Detail panel (per bridge) ────────────────────────────────────────────

function openDetail(bridgeId, detailDiv, toggleBtn) {
  detailDiv.classList.add("open");
  toggleBtn.textContent = "Hide Details";

  detailDiv.textContent = "";

  const wsStatusEl = el("div", "muted", "Connecting to live updates...");
  wsStatusEl.id = "ws-status-" + bridgeId;
  detailDiv.appendChild(wsStatusEl);
  detailDiv.appendChild(el("div", "divider"));

  const entitiesContainer = el("div", "muted", "Loading entities...");
  entitiesContainer.id = "entities-" + bridgeId;
  detailDiv.appendChild(entitiesContainer);

  detailDiv.appendChild(el("div", "divider"));

  // Channel mapping editor
  const mappingSection = document.createElement("div");
  mappingSection.id = "mapping-" + bridgeId;
  detailDiv.appendChild(mappingSection);

  detailDiv.appendChild(el("div", "divider"));

  const budgetsContainer = el("div");
  budgetsContainer.id = "budgets-" + bridgeId;
  detailDiv.appendChild(budgetsContainer);

  detailDiv.appendChild(el("div", "divider"));

  // Test controls
  const testSection = document.createElement("div");
  testSection.appendChild(el("strong", null, "Test controls"));
  const testRow = el("div", "row");
  testRow.style.marginTop = "8px";

  const testStatusEl = el("div", "muted");
  testStatusEl.id = "test-status-" + bridgeId;
  testStatusEl.style.marginTop = "6px";

  const colors = [
    ["Red", 255, 0, 0],
    ["Green", 0, 255, 0],
    ["Blue", 0, 0, 255],
    ["Off", 0, 0, 0],
  ];
  for (const [label, r, g, b] of colors) {
    testRow.appendChild(
      btn(label, "small", async () => {
        try {
          var entityIds = getCheckedEntityIds(bridgeId);
          var payload = { color: [r, g, b] };
          if (entityIds.length > 0) {
            payload.entityIds = entityIds;
          }
          await api("POST", "/api/bridges/" + encodeURIComponent(bridgeId) + "/test", payload);
          toast(testStatusEl, "ok", "Sent (" + r + ", " + g + ", " + b + ") to " + (entityIds.length || "all") + " entities");
        } catch (e) {
          toast(testStatusEl, "err", e.message);
        }
      }),
    );
  }
  testSection.appendChild(testRow);
  testSection.appendChild(testStatusEl);
  detailDiv.appendChild(testSection);

  // Load entities via REST first, then render mapping editor
  loadEntities(bridgeId).then(function () {
    renderMappingEditor(bridgeId);
  });

  // Open WebSocket for live status
  connectWs(bridgeId);
}

function closeDetail(bridgeId, detailDiv, toggleBtn) {
  detailDiv.classList.remove("open");
  toggleBtn.textContent = "Show Details";
  detailDiv.textContent = "";
  disconnectWs(bridgeId);
}

async function loadEntities(bridgeId) {
  const root = document.getElementById("entities-" + bridgeId);
  if (!root) return;
  try {
    const entities = await api(
      "GET",
      "/api/bridges/" + encodeURIComponent(bridgeId) + "/resources",
    );
    bridgeEntitiesCache.set(bridgeId, entities);
    renderEntities(bridgeId, entities, null);
  } catch {
    root.textContent = "Could not load entities.";
    root.className = "muted";
  }
}

/** Track which entity checkboxes are checked for test controls */
const testSelections = new Map();

function isTestableEntity(entity) {
  var cat = entity.category || "";
  var mode = entity.channelLayout?.type || "";
  return cat !== "scene-selector" && mode !== "scene-selector";
}

function getCheckedEntityIds(bridgeId) {
  var sel = testSelections.get(bridgeId);
  if (!sel) return [];
  var ids = [];
  sel.forEach(function (checked, eid) {
    if (checked) ids.push(eid);
  });
  return ids;
}

function fmtDmxMapping(mapping) {
  if (!mapping) return null;
  var range = mapping.dmxStart === mapping.dmxEnd
    ? String(mapping.dmxStart)
    : mapping.dmxStart + "-" + mapping.dmxEnd;
  return range + " (" + mapping.channelMode + ")";
}

function renderEntities(bridgeId, entities, liveData) {
  const root = document.getElementById("entities-" + bridgeId);
  if (!root) return;

  root.textContent = "";

  if (!entities || !entities.length) {
    root.className = "muted";
    root.textContent = "No entities found on this bridge.";
    return;
  }

  root.className = "";

  // Split into mapped and unmapped
  var mapped = entities.filter(function (e) { return e.dmxMapping; });
  var unmapped = entities.filter(function (e) { return !e.dmxMapping; });

  // If no mapped entities, show a prompt instead of an empty table
  if (mapped.length === 0) {
    var hint = el("div", "muted");
    hint.style.marginBottom = "8px";
    hint.textContent = "No entities mapped to DMX channels yet. ";
    var mapLink = document.createElement("a");
    mapLink.href = "#";
    mapLink.textContent = "Use the Channel Mapping editor below";
    mapLink.style.color = "var(--accent)";
    mapLink.addEventListener("click", function (ev) {
      ev.preventDefault();
      var mappingSection = document.getElementById("mapping-" + bridgeId);
      if (mappingSection) mappingSection.scrollIntoView({ behavior: "smooth" });
    });
    hint.appendChild(mapLink);
    hint.appendChild(document.createTextNode(" to assign DMX addresses."));
    root.appendChild(hint);

    // Also show unmapped count
    if (unmapped.length > 0) {
      root.appendChild(el("div", "muted", unmapped.length + " entities available for mapping."));
    }
    return;
  }

  // Initialise test selections for this bridge if not yet done
  if (!testSelections.has(bridgeId)) {
    var sel = new Map();
    for (var i = 0; i < entities.length; i++) {
      sel.set(entities[i].id, isTestableEntity(entities[i]));
    }
    testSelections.set(bridgeId, sel);
  }
  var selections = testSelections.get(bridgeId);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const h of ["", "Entity", "Type", "Mode", "DMX", "Color", "Last update"]) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const e of mapped) {
    const tr = document.createElement("tr");

    // Checkbox for test selection
    const tdCheck = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selections.get(e.id) ?? isTestableEntity(e);
    cb.addEventListener("change", (function (eid) {
      return function () {
        selections.set(eid, this.checked);
      };
    })(e.id));
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // Name
    const tdName = document.createElement("td");
    tdName.textContent = e.metadata?.name || e.id;
    tr.appendChild(tdName);

    // Type badge
    const tdType = document.createElement("td");
    tdType.appendChild(badge(e.metadata?.type || "unknown", "type"));
    tr.appendChild(tdType);

    // Mode badge
    const tdMode = document.createElement("td");
    const modeClass = e.controlMode === "realtime" ? "realtime" : "limited";
    tdMode.appendChild(badge(e.controlMode, modeClass));
    tr.appendChild(tdMode);

    // DMX address
    const tdDmx = document.createElement("td");
    var dmxText = fmtDmxMapping(e.dmxMapping);
    if (dmxText) {
      tdDmx.textContent = dmxText;
    } else {
      var unmapped = document.createElement("span");
      unmapped.className = "muted";
      unmapped.textContent = "(unmapped)";
      tdDmx.appendChild(unmapped);
    }
    tr.appendChild(tdDmx);

    // Color swatch
    const tdColor = document.createElement("td");
    const live = liveData?.entities?.[e.id];
    const rgb = live?.rgb;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    if (rgb) {
      swatch.style.background = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
    }
    tdColor.appendChild(swatch);
    const rgbLabel = document.createElement("span");
    rgbLabel.className = "muted";
    rgbLabel.textContent = rgb ? rgb[0] + ", " + rgb[1] + ", " + rgb[2] : "--";
    tdColor.appendChild(rgbLabel);
    tr.appendChild(tdColor);

    // Last update
    const tdUpdate = document.createElement("td");
    tdUpdate.className = "muted";
    tdUpdate.textContent = live?.lastUpdate ? fmtAgo(live.lastUpdate) : "--";
    tr.appendChild(tdUpdate);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  // Show unmapped entity count if any
  if (unmapped.length > 0) {
    var unmappedHint = el("div", "muted");
    unmappedHint.style.marginTop = "8px";
    unmappedHint.style.fontSize = "0.8rem";
    unmappedHint.textContent = unmapped.length + " additional entit" +
      (unmapped.length === 1 ? "y" : "ies") + " available — assign DMX addresses in the Channel Mapping section below.";
    root.appendChild(unmappedHint);
  }
}

function renderBudgets(bridgeId, rateLimitUsage) {
  const root = document.getElementById("budgets-" + bridgeId);
  if (!root || !rateLimitUsage) return;

  const entries = Object.entries(rateLimitUsage);
  root.textContent = "";
  if (!entries.length) return;

  root.appendChild(el("strong", null, "Rate limits"));

  for (const [category, { current, max }] of entries) {
    const pct = max > 0 ? Math.round((current / max) * 100) : 0;

    const wrap = el("div", "budget-bar-wrap");
    const label = el("div", "budget-bar-label", category + ": " + current + "/" + max + " req/s (" + pct + "%)");
    wrap.appendChild(label);

    const bar = el("div", "budget-bar");
    const fill = el("div", "budget-bar-fill");
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);

    root.appendChild(wrap);
  }
}

// ── WebSocket per bridge ─────────────────────────────────────────────────

function connectWs(bridgeId) {
  disconnectWs(bridgeId);

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws");

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", bridgeId: bridgeId }));
    const wsStatusEl = document.getElementById("ws-status-" + bridgeId);
    if (wsStatusEl) {
      wsStatusEl.textContent = "";
      const dot = el("span", "dot connected");
      dot.style.display = "inline-block";
      dot.style.marginRight = "6px";
      wsStatusEl.appendChild(dot);
      wsStatusEl.appendChild(document.createTextNode("Live"));
    }
    // Re-enable detail panel if it was greyed out from a previous disconnect
    const card = document.querySelector(
      ".bridge-card[data-bridge-id='" + CSS.escape(bridgeId) + "']",
    );
    if (card) {
      const detail = card.querySelector(".bridge-detail");
      if (detail) {
        detail.style.opacity = "";
        detail.style.pointerEvents = "";
      }
    }
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "status" && msg.bridgeId === bridgeId && msg.data) {
      // Update connection dot on bridge card
      const card = document.querySelector(".bridge-card[data-bridge-id='" + CSS.escape(bridgeId) + "']");
      if (card) {
        const dot = card.querySelector(".dot");
        if (dot) {
          dot.className = "dot " + (msg.data.connected ? "connected" : "disconnected");
        }
      }

      // Update budget bars
      renderBudgets(bridgeId, msg.data.rateLimitUsage);

      // Build live data from entity statuses
      var liveData = { entities: {} };
      if (msg.data.entities) {
        for (var _a = 0, _b = Object.entries(msg.data.entities); _a < _b.length; _a++) {
          var pair = _b[_a];
          var eid = pair[0];
          var estat = pair[1];
          liveData.entities[eid] = {
            rgb: entityValueToRgb(estat.lastValue),
            lastUpdate: estat.lastUpdate,
          };
        }
      }

      // Re-render entities with live data
      var cachedEntities = bridgeEntitiesCache.get(bridgeId);
      if (cachedEntities) {
        renderEntities(bridgeId, cachedEntities, liveData);
      }
    }
  });

  ws.addEventListener("close", () => {
    wsConnections.delete(bridgeId);
    // Grey out the detail panel to indicate stale data
    const statusEl = document.getElementById("ws-status-" + bridgeId);
    if (statusEl) {
      statusEl.textContent = "";
      const dot = document.createElement("span");
      dot.className = "dot disconnected";
      statusEl.appendChild(dot);
      statusEl.appendChild(document.createTextNode(" Disconnected"));
    }
    // Disable test buttons and checkboxes
    const card = document.querySelector(
      ".bridge-card[data-bridge-id='" + CSS.escape(bridgeId) + "']",
    );
    if (card) {
      const detail = card.querySelector(".bridge-detail");
      if (detail) {
        detail.style.opacity = "0.5";
        detail.style.pointerEvents = "none";
      }
    }
  });

  wsConnections.set(bridgeId, ws);
}

function disconnectWs(bridgeId) {
  const ws = wsConnections.get(bridgeId);
  if (ws) {
    try {
      ws.send(JSON.stringify({ type: "unsubscribe", bridgeId: bridgeId }));
    } catch {
      // ws may already be closed
    }
    ws.close();
    wsConnections.delete(bridgeId);
  }
}

// ── ArtNet status polling ────────────────────────────────────────────────

function startStatusPolling() {
  const tick = async () => {
    try {
      const status = await api("GET", "/api/status");
      updateGlobalStatus(true);
      renderArtnetStatus(status.artnet);
    } catch {
      updateGlobalStatus(false);
      renderArtnetStatus(null);
    }
  };
  tick();
  setInterval(tick, 2000);
}

function renderArtnetStatus(artnet) {
  const root = $("#artnetStatus");
  root.textContent = "";

  if (!artnet) {
    root.className = "muted";
    root.textContent = "Runtime not active.";
    return;
  }

  root.className = "";

  const stats = el("div", "artnet-stats");

  const addStat = (label, value) => {
    const span = el("span", "artnet-stat");
    span.textContent = label + " ";
    const strong = document.createElement("strong");
    strong.textContent = value;
    span.appendChild(strong);
    stats.appendChild(span);
  };

  addStat("Status:", artnet.running ? "Running" : "Stopped");
  addStat("Total frames:", String(artnet.frameCount));
  addStat("Last frame:", fmtAgo(artnet.lastFrameTime));

  const unis = artnet.frameCounts || {};
  const uniKeys = Object.keys(unis);
  if (uniKeys.length) {
    for (const u of uniKeys) {
      addStat("U" + u + ":", String(unis[u]));
    }
  } else {
    stats.appendChild(el("span", "artnet-stat muted", "No universe data"));
  }

  root.appendChild(stats);
}

// ── Config panel ─────────────────────────────────────────────────────────

function toggleConfigPanel() {
  const panel = $("#configPanel");
  panel.hidden = !panel.hidden;
  $("#btnConfig").textContent = panel.hidden ? "Config" : "Close Config";
}

function renderConfigPanel() {
  if (!config) return;
  $("#cfgArtnetBind").value = config.artnet?.bindAddress || "0.0.0.0";
  $("#cfgArtnetPort").value = config.artnet?.port || 6454;
  renderBridgeConfigList();
}

function renderBridgeConfigList() {
  const root = $("#bridgeConfigs");
  root.textContent = "";

  if (!config || !config.bridges.length) {
    root.appendChild(el("div", "muted", "No bridges configured."));
    return;
  }

  for (const bridge of config.bridges) {
    const item = el("div", "item");

    // Title row
    const titleRow = el("div", "item-title");
    const titleLeft = document.createElement("div");
    titleLeft.appendChild(el("strong", null, bridge.name || bridge.id));
    titleLeft.appendChild(document.createTextNode(" "));
    titleLeft.appendChild(pill(bridge.protocol));
    titleLeft.appendChild(document.createTextNode(" "));
    titleLeft.appendChild(pill("U" + bridge.universe));
    titleRow.appendChild(titleLeft);
    item.appendChild(titleRow);

    // Mapping count
    const meta = el("div", "muted", (bridge.channelMappings?.length || 0) + " channel mappings");
    meta.style.marginTop = "6px";
    item.appendChild(meta);

    // Mappings table
    if (bridge.channelMappings?.length) {
      const tableWrap = document.createElement("div");
      tableWrap.style.marginTop = "8px";

      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const h of ["Entity", "DMX start", "Width"]) {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const m of bridge.channelMappings) {
        const tr = document.createElement("tr");

        const tdEntity = document.createElement("td");
        tdEntity.appendChild(pill(m.entityId));
        tr.appendChild(tdEntity);

        const tdStart = document.createElement("td");
        tdStart.textContent = String(m.dmxStart);
        tr.appendChild(tdStart);

        const tdWidth = document.createElement("td");
        tdWidth.textContent = String(m.channelWidth || "--");
        tr.appendChild(tdWidth);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      item.appendChild(tableWrap);
    }

    root.appendChild(item);
  }
}

// ── Discover ─────────────────────────────────────────────────────────────

async function discover() {
  const status = $("#discoverStatus");
  status.textContent = "Searching...";
  try {
    const bridges = await api("GET", "/api/bridges/discover");
    status.textContent = "Found " + bridges.length + ".";
    renderDiscoverList(bridges);
  } catch (e) {
    status.textContent = e.message;
  }
}

function renderDiscoverList(items) {
  const root = $("#discoverList");
  root.textContent = "";

  if (!items.length) {
    root.appendChild(el("div", "muted", "No bridges found."));
    return;
  }
  for (const b of items) {
    const item = el("div", "item");
    const titleRow = el("div", "item-title");

    const left = document.createElement("div");
    left.appendChild(el("strong", null, b.name || b.id));
    left.appendChild(document.createTextNode(" "));
    left.appendChild(pill(b.host));
    left.appendChild(document.createTextNode(" "));
    left.appendChild(pill(b.protocol));
    titleRow.appendChild(left);

    titleRow.appendChild(
      btn("Use", "small", () => {
        $("#pairProtocol").value = b.protocol;
        $("#pairId").value = b.id;
        $("#pairHost").value = b.host;
      }),
    );

    item.appendChild(titleRow);
    root.appendChild(item);
  }
}

// ── Pair ──────────────────────────────────────────────────────────────────

async function pair() {
  const protocol = $("#pairProtocol").value.trim();
  const id = $("#pairId").value.trim();
  const host = $("#pairHost").value.trim();
  const status = $("#pairStatus");

  if (!protocol || !id || !host) {
    status.textContent = "Fill in all fields.";
    return;
  }
  status.textContent = "Press the link button on your bridge now... waiting up to 30 seconds.";
  status.className = "muted";
  try {
    const res = await api("POST", "/api/bridges/pair", { protocol, id, host });
    if (res.success) {
      toast(status, "ok", "Paired successfully! Bridge saved to config. Reload to see it.");
    } else {
      toast(status, "err", res.error || "Pairing failed.");
    }
  } catch (e) {
    toast(status, "err", e.message);
  }
}

// ── Save config ──────────────────────────────────────────────────────────

async function saveConfig() {
  const status = $("#saveStatus");
  try {
    config.artnet.bindAddress = $("#cfgArtnetBind").value || "0.0.0.0";
    config.artnet.port = Number($("#cfgArtnetPort").value) || 6454;
    await api("PUT", "/api/config", config);
    toast(status, "ok", "Saved.");
  } catch (e) {
    toast(status, "err", e.message);
  }
}

// ── Channel Mapping Editor ──────────────────────────────────────────────

function mappingChannelWidth(mode) {
  switch (mode) {
    case "8bit": return 3;
    case "8bit-dimmable": return 4;
    case "16bit": return 6;
    case "scene-selector": return 1;
    case "brightness": return 1;
    default: return 0;
  }
}

function mappingCompatibleModes(layoutType) {
  switch (layoutType) {
    case "rgb": return ["8bit", "8bit-dimmable", "16bit"];
    case "rgb-dimmable": return ["8bit-dimmable"];
    case "brightness": return ["brightness"];
    case "scene-selector": return ["scene-selector"];
    default: return [];
  }
}

function mappingDefaultMode(layoutType) {
  var modes = mappingCompatibleModes(layoutType);
  return modes.length > 0 ? modes[0] : "";
}

function renderMappingEditor(bridgeId) {
  var root = document.getElementById("mapping-" + bridgeId);
  if (!root) return;

  var entities = bridgeEntitiesCache.get(bridgeId);
  if (!entities || !entities.length) {
    root.textContent = "";
    root.appendChild(el("strong", null, "Channel Mapping"));
    root.appendChild(el("div", "muted", "No entities available for mapping."));
    return;
  }

  // Find the bridge config to get existing mappings
  var bridgeCfg = null;
  if (config && config.bridges) {
    for (var i = 0; i < config.bridges.length; i++) {
      if (config.bridges[i].id === bridgeId) {
        bridgeCfg = config.bridges[i];
        break;
      }
    }
  }

  var existingMappings = {};
  if (bridgeCfg && bridgeCfg.channelMappings) {
    for (var i = 0; i < bridgeCfg.channelMappings.length; i++) {
      var m = bridgeCfg.channelMappings[i];
      existingMappings[m.entityId] = m;
    }
  }

  // Local mapping state: array of { entityId, entityName, layoutType, dmxStart, mode }
  var mappingState = [];
  for (var i = 0; i < entities.length; i++) {
    var ent = entities[i];
    var layoutType = ent.channelLayout?.type || "";
    var modes = mappingCompatibleModes(layoutType);
    if (modes.length === 0) continue; // skip entities with no compatible modes

    var existing = existingMappings[ent.id];
    var dmxStart = existing ? existing.dmxStart : null;
    var mode = existing ? existing.channelMode : modes[0];
    // Validate that existing mode is compatible
    if (modes.indexOf(mode) === -1) mode = modes[0];

    mappingState.push({
      entityId: ent.id,
      entityName: ent.metadata?.name || ent.id,
      entityType: ent.metadata?.type || "unknown",
      controlMode: ent.controlMode || "limited",
      layoutType: layoutType,
      compatibleModes: modes,
      dmxStart: dmxStart,
      mode: mode
    });
  }

  // Build the UI
  root.textContent = "";
  root.appendChild(el("strong", null, "Channel Mapping"));

  // Selection state for each entity (for map-selected / clear-selected)
  var mappingSelected = new Map();
  for (var s = 0; s < mappingState.length; s++) {
    // Default: select entities that are already mapped
    mappingSelected.set(mappingState[s].entityId, mappingState[s].dmxStart != null);
  }

  var actionsDiv = el("div", "mapping-actions");
  actionsDiv.style.marginTop = "8px";

  actionsDiv.appendChild(btn("Map Selected", "small primary", function () {
    // Find the highest currently used address to continue from
    var next = 1;
    for (var i = 0; i < mappingState.length; i++) {
      if (mappingState[i].dmxStart != null) {
        var end = mappingState[i].dmxStart + mappingChannelWidth(mappingState[i].mode);
        if (end > next) next = end;
      }
    }
    // Map only selected, unmapped entities
    for (var i = 0; i < mappingState.length; i++) {
      if (mappingSelected.get(mappingState[i].entityId) && mappingState[i].dmxStart == null) {
        mappingState[i].dmxStart = next;
        mappingState[i].mode = mappingDefaultMode(mappingState[i].layoutType);
        next += mappingChannelWidth(mappingState[i].mode);
      }
    }
    rebuildTable();
  }));

  actionsDiv.appendChild(btn("Clear Selected", "small danger", function () {
    for (var i = 0; i < mappingState.length; i++) {
      if (mappingSelected.get(mappingState[i].entityId)) {
        mappingState[i].dmxStart = null;
        mappingState[i].mode = mappingState[i].compatibleModes[0];
      }
    }
    rebuildTable();
  }));

  actionsDiv.appendChild(btn("Clear All", "small danger", function () {
    for (var i = 0; i < mappingState.length; i++) {
      mappingState[i].dmxStart = null;
      mappingState[i].mode = mappingState[i].compatibleModes[0];
    }
    rebuildTable();
  }));

  root.appendChild(actionsDiv);

  var tableContainer = document.createElement("div");
  root.appendChild(tableContainer);

  var errorContainer = document.createElement("div");
  root.appendChild(errorContainer);

  var saveRow = el("div", "row");
  saveRow.style.marginTop = "8px";

  var saveStatusEl = document.createElement("span");
  saveStatusEl.className = "mapping-success";

  saveRow.appendChild(btn("Save Mappings", "small primary", async function () {
    saveStatusEl.textContent = "";
    saveStatusEl.className = "mapping-success";
    try {
      // Re-read config to avoid stale data
      var freshConfig = await api("GET", "/api/config");
      var bridgeIdx = -1;
      for (var i = 0; i < freshConfig.bridges.length; i++) {
        if (freshConfig.bridges[i].id === bridgeId) {
          bridgeIdx = i;
          break;
        }
      }
      if (bridgeIdx === -1) {
        saveStatusEl.className = "mapping-error";
        saveStatusEl.textContent = "Bridge not found in config.";
        return;
      }

      // Build channelMappings from state
      var newMappings = [];
      for (var i = 0; i < mappingState.length; i++) {
        var ms = mappingState[i];
        if (ms.dmxStart != null && ms.dmxStart > 0) {
          newMappings.push({
            entityId: ms.entityId,
            dmxStart: ms.dmxStart,
            channelMode: ms.mode,
            channelWidth: mappingChannelWidth(ms.mode)
          });
        }
      }

      freshConfig.bridges[bridgeIdx].channelMappings = newMappings;
      await api("PUT", "/api/config", freshConfig);
      config = freshConfig; // update local cache
      saveStatusEl.textContent = "Saved \u2713";

      // Reload entities to update DMX column
      await loadEntities(bridgeId);
    } catch (e) {
      saveStatusEl.className = "mapping-error";
      saveStatusEl.textContent = e.message;
    }
  }));
  saveRow.appendChild(saveStatusEl);
  root.appendChild(saveRow);

  function validate() {
    var errors = [];
    // Check bounds and overlaps
    for (var i = 0; i < mappingState.length; i++) {
      var ms = mappingState[i];
      if (ms.dmxStart == null) continue;
      var width = mappingChannelWidth(ms.mode);
      var end = ms.dmxStart + width - 1;
      if (ms.dmxStart < 1 || ms.dmxStart > 512) {
        errors.push({ index: i, msg: ms.entityName + ": DMX start out of range (1-512)" });
      }
      if (end > 512) {
        errors.push({ index: i, msg: ms.entityName + ": DMX range exceeds 512 (ends at " + end + ")" });
      }

      // Check overlaps with other mapped entities
      for (var j = i + 1; j < mappingState.length; j++) {
        var other = mappingState[j];
        if (other.dmxStart == null) continue;
        var otherWidth = mappingChannelWidth(other.mode);
        var otherEnd = other.dmxStart + otherWidth - 1;
        // Overlap if ranges intersect
        if (ms.dmxStart <= otherEnd && other.dmxStart <= end) {
          errors.push({
            index: i,
            indexB: j,
            msg: ms.entityName + " (" + ms.dmxStart + "-" + end + ") overlaps with " + other.entityName + " (" + other.dmxStart + "-" + otherEnd + ")"
          });
        }
      }
    }
    return errors;
  }

  function rebuildTable() {
    tableContainer.textContent = "";
    errorContainer.textContent = "";

    var table = document.createElement("table");
    table.className = "mapping-table";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");

    // Select-all checkbox header
    var thCheck = document.createElement("th");
    var selectAllCb = document.createElement("input");
    selectAllCb.type = "checkbox";
    // Check if all are selected
    var allSelected = mappingState.every(function (ms) { return mappingSelected.get(ms.entityId); });
    selectAllCb.checked = allSelected;
    selectAllCb.addEventListener("change", function () {
      for (var i = 0; i < mappingState.length; i++) {
        mappingSelected.set(mappingState[i].entityId, this.checked);
      }
      rebuildTable();
    });
    thCheck.appendChild(selectAllCb);
    headRow.appendChild(thCheck);

    var headers = ["Entity Name", "Type", "Control", "DMX Start", "Channel Mode", "DMX End", ""];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement("th");
      th.textContent = headers[h];
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    var errors = validate();
    var errorIndices = new Set();
    for (var e = 0; e < errors.length; e++) {
      errorIndices.add(errors[e].index);
      if (errors[e].indexB != null) errorIndices.add(errors[e].indexB);
    }

    var tbody = document.createElement("tbody");
    for (var i = 0; i < mappingState.length; i++) {
      (function (idx) {
        var ms = mappingState[idx];
        var tr = document.createElement("tr");

        // Checkbox
        var tdCheck = document.createElement("td");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = mappingSelected.get(ms.entityId) || false;
        cb.addEventListener("change", function () {
          mappingSelected.set(ms.entityId, this.checked);
          // Update select-all state
          var allCb = table.querySelector("thead input[type='checkbox']");
          if (allCb) {
            allCb.checked = mappingState.every(function (m) { return mappingSelected.get(m.entityId); });
          }
        });
        tdCheck.appendChild(cb);
        tr.appendChild(tdCheck);

        // Entity name
        var tdName = document.createElement("td");
        tdName.textContent = ms.entityName;
        tr.appendChild(tdName);

        // Type badge
        var tdType = document.createElement("td");
        tdType.appendChild(badge(ms.entityType, "type"));
        tr.appendChild(tdType);

        // Control mode badge
        var tdCtrl = document.createElement("td");
        var ctrlClass = ms.controlMode === "realtime" ? "realtime" : "limited";
        tdCtrl.appendChild(badge(ms.controlMode, ctrlClass));
        tr.appendChild(tdCtrl);

        // DMX Start input
        var tdStart = document.createElement("td");
        var startInput = document.createElement("input");
        startInput.type = "number";
        startInput.min = "1";
        startInput.max = "512";
        if (ms.dmxStart != null) startInput.value = String(ms.dmxStart);
        else startInput.value = "";
        startInput.placeholder = "--";
        if (errorIndices.has(idx)) startInput.className = "error";
        startInput.addEventListener("change", function () {
          var val = parseInt(this.value, 10);
          mappingState[idx].dmxStart = isNaN(val) ? null : val;
          rebuildTable();
        });
        tdStart.appendChild(startInput);
        tr.appendChild(tdStart);

        // Mode select
        var tdMode = document.createElement("td");
        var modeSelect = document.createElement("select");
        for (var m = 0; m < ms.compatibleModes.length; m++) {
          var opt = document.createElement("option");
          opt.value = ms.compatibleModes[m];
          opt.textContent = ms.compatibleModes[m];
          if (ms.compatibleModes[m] === ms.mode) opt.selected = true;
          modeSelect.appendChild(opt);
        }
        modeSelect.addEventListener("change", function () {
          mappingState[idx].mode = this.value;
          rebuildTable();
        });
        tdMode.appendChild(modeSelect);
        tr.appendChild(tdMode);

        // DMX End (computed)
        var tdEnd = document.createElement("td");
        if (ms.dmxStart != null) {
          var width = mappingChannelWidth(ms.mode);
          tdEnd.textContent = String(ms.dmxStart + width - 1);
        } else {
          tdEnd.textContent = "--";
          tdEnd.className = "muted";
        }
        tr.appendChild(tdEnd);

        // Clear button (per row)
        var tdClear = document.createElement("td");
        if (ms.dmxStart != null) {
          var clearBtn = document.createElement("button");
          clearBtn.className = "small danger";
          clearBtn.textContent = "\u00d7"; // × symbol
          clearBtn.title = "Remove DMX mapping";
          clearBtn.style.padding = "2px 8px";
          clearBtn.style.cursor = "pointer";
          clearBtn.style.background = "transparent";
          clearBtn.style.border = "1px solid var(--danger)";
          clearBtn.style.color = "var(--danger)";
          clearBtn.style.borderRadius = "4px";
          clearBtn.addEventListener("click", function () {
            mappingState[idx].dmxStart = null;
            rebuildTable();
          });
          tdClear.appendChild(clearBtn);
        }
        tr.appendChild(tdClear);

        tbody.appendChild(tr);
      })(i);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);

    // Show errors
    if (errors.length > 0) {
      for (var e = 0; e < errors.length; e++) {
        var errDiv = el("div", "mapping-error", "\u26A0 " + errors[e].msg);
        errorContainer.appendChild(errDiv);
      }
    }
  }

  rebuildTable();
}
