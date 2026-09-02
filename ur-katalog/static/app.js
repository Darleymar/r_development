/* UR-Katalog -- Oberflaeche. Vanilla JS, kein Build-Step.
 *
 * Liste kommt gesammelt vom Server (der Katalog ist ein paar hundert Zeilen
 * gross, das haelt der Browser locker aus), Detaildaten je Release erst beim
 * Aufklappen.
 */

const STATUS_LABEL = {
  ungehoert: "ungehört",
  gehoert: "gehört",
  favorit: "Favorit",
  nochmal: "nochmal",
};

const state = {
  meta: null,
  items: [],
  expanded: null,   // Release-ID
  cursor: -1,       // Index in state.items
  details: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const listEl = $("#list");

/* ------------------------------------------------------------- Helfer -- */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

/* Discogs schreibt unvollstaendige Daten als "1992-00-00". */
function releaseDate(value) {
  if (!value) return "";
  return value.replace(/-00-00$/, "").replace(/-00$/, "");
}

function seconds(total) {
  if (!total) return "";
  const min = Math.floor(total / 60);
  return `${min}:${String(total % 60).padStart(2, "0")}`;
}

function filterParams() {
  const params = new URLSearchParams();
  const add = (key, value) => { if (value !== "" && value != null) params.set(key, value); };
  add("label_id", $("#f-label").value);
  add("era", $("#f-era").value);
  add("year_from", $("#f-year-from").value);
  add("year_to", $("#f-year-to").value);
  add("status", $("#f-status").value);
  add("sort", $("#f-sort").value);
  add("q", $("#f-q").value.trim());
  if ($("#f-video").checked) params.set("has_video", "true");
  return params;
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function saveFilters() {
  const values = {};
  ["f-label", "f-era", "f-year-from", "f-year-to", "f-status", "f-sort", "f-q"]
    .forEach((id) => { values[id] = document.getElementById(id).value; });
  values["f-video"] = $("#f-video").checked;
  values["f-group"] = $("#f-group").checked;
  localStorage.setItem("ur-filters", JSON.stringify(values));
}

function restoreFilters() {
  let values;
  try { values = JSON.parse(localStorage.getItem("ur-filters") || "{}"); }
  catch { return; }
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = value; else el.value = value;
  });
}

/* --------------------------------------------------------------- Laden -- */
async function loadMeta() {
  state.meta = await api("/api/meta");
  const { labels, eras, counts, db } = state.meta;

  $("#db-hint").textContent =
    `${counts.primary} Releases · ${counts.variants} Varianten · ${counts.with_videos} mit Video · ${db.split("/").pop()}`;

  const labelSelect = $("#f-label");
  labels.forEach((label) => {
    const option = document.createElement("option");
    option.value = label.id;
    option.textContent = `${label.is_sublabel ? "— " : ""}${label.name} (${label.count})`;
    labelSelect.append(option);
  });

  const eraSelect = $("#f-era");
  eras.forEach((era) => {
    const option = document.createElement("option");
    option.value = era.id;
    const range = era.to ? `${era.from}–${era.to}` : `ab ${era.from}`;
    option.textContent = `${range} · ${era.label}`;
    eraSelect.append(option);
  });

  if (counts.releases === 0) {
    listEl.innerHTML =
      `<p class="empty">Noch keine Daten. Erst den Fetcher laufen lassen:
       <code>./ur find-label</code>, dann <code>./ur fetch</code>.</p>`;
  }
}

async function loadList(keepExpanded = false) {
  const params = filterParams();
  const data = await api(`/api/releases?${params}`);
  state.items = data.items;
  if (!keepExpanded) state.expanded = null;
  renderList();
  loadStats();
  saveFilters();
}

async function loadStats() {
  const data = await api(`/api/stats?${filterParams()}`);
  const percent = data.total ? Math.round((data.heard / data.total) * 100) : 0;
  $("#progress-text").textContent = `${data.heard} von ${data.total} gehört (${percent} %)`;
  $("#progress-bar").style.width = `${percent}%`;
  $("#status-breakdown").textContent = Object.entries(data.by_status)
    .filter(([, count]) => count)
    .map(([status, count]) => `${STATUS_LABEL[status]}: ${count}`)
    .join(" · ");

  $("#era-stats").innerHTML = data.by_era.map((era) => {
    const share = era.total ? Math.round((era.heard / era.total) * 100) : 0;
    return `<div class="era-card">
      <div class="name">${escapeHtml(era.label)}</div>
      <div class="num">${era.heard} / ${era.total}</div>
      <div class="bar"><div class="bar-fill" style="width:${share}%"></div></div>
    </div>`;
  }).join("");
}

/* ------------------------------------------------------------ Rendern -- */
function rowHtml(item, index) {
  const status = item.status;
  const badge = status === "ungehoert"
    ? ""
    : `<span class="badge ${status}">${STATUS_LABEL[status]}</span>`;
  const icons = [
    item.video_count ? `<span title="${item.video_count} Videos">▶</span>` : "",
    item.has_notes ? `<span title="Notiz">✎</span>` : "",
    item.spotify_uri ? `<span title="auf Spotify">♫</span>` : "",
    item.variant_count ? `<span title="${item.variant_count} weitere Versionen">⧉</span>` : "",
    item.is_related ? `<span title="${escapeHtml(item.related_note || "verwandtes Release")}">✧</span>` : "",
  ].join("");

  return `<div class="row${state.expanded === item.id ? " open" : ""}${state.cursor === index ? " cursor" : ""}"
       data-id="${item.id}" data-index="${index}">
    <div class="catno">${escapeHtml(item.catno_raw || "—")}</div>
    <div class="year">${item.year || "—"}</div>
    <div class="name"><span class="artist">${escapeHtml(item.artist || "?")}</span> – ${escapeHtml(item.title || "?")}</div>
    <div class="icons">${icons}</div>
    <div>${badge}</div>
  </div>`;
}

function renderList() {
  if (!state.items.length) {
    listEl.innerHTML = `<p class="empty">Keine Treffer für diese Filter.</p>`;
    return;
  }

  const grouped = $("#f-group").checked;
  const parts = [];
  let currentEra = Symbol("start");

  state.items.forEach((item, index) => {
    if (grouped && item.era_label !== currentEra) {
      currentEra = item.era_label;
      const count = state.items.filter((other) => other.era_label === currentEra).length;
      parts.push(`<h3 class="group-head">${escapeHtml(currentEra)} <span>· ${count} Releases</span></h3>`);
    }
    parts.push(rowHtml(item, index));
    if (state.expanded === item.id) {
      parts.push(`<div class="detail" id="detail-${item.id}">lädt …</div>`);
    }
  });

  listEl.innerHTML = parts.join("");
  if (state.expanded != null) renderDetail(state.expanded);
}

function detailHtml(data) {
  const meta = [
    data.label,
    data.formats.join(", "),
    data.country,
    releaseDate(data.released) || data.year,
    data.styles.join(", "),
  ].filter(Boolean).map(escapeHtml).join(" · ");

  const tracks = data.tracks.length
    ? `<ul class="tracklist">${data.tracks.map((track) => {
        const play = track.video
          ? `<a class="play" href="${escapeHtml(track.video.uri)}" target="_blank" rel="noreferrer"
                title="${escapeHtml(track.video.title || "")}">▶ abspielen</a>`
          : `<span class="nomatch">–</span>`;
        return `<li>
          <span class="pos">${escapeHtml(track.position || "")}</span>
          <span>${escapeHtml(track.title || "")}${
            track.artists ? ` <span class="artist">(${escapeHtml(track.artists)})</span>` : ""}</span>
          <span class="dur">${escapeHtml(track.duration || "")}</span>
          ${play}
        </li>`;
      }).join("")}</ul>`
    : `<p class="variants">Keine Tracklist${data.detail_fetched_at ? "" : " – Detaildaten fehlen noch (python fetch.py details)"}.</p>`;

  const leftovers = data.unmatched_videos.length
    ? `<h4>Videos ohne Trackzuordnung</h4><ul class="videos">${data.unmatched_videos.map((video) =>
        `<li><a href="${escapeHtml(video.uri)}" target="_blank" rel="noreferrer">▶ ${
          escapeHtml(video.title || video.uri)}</a> <span class="dur">${seconds(video.duration)}</span></li>`
      ).join("")}</ul>`
    : "";

  const variants = data.variants.length
    ? `<h4>Weitere Versionen (${data.variants.length})</h4><ul class="variants">${data.variants.map((variant) =>
        `<li>${escapeHtml(variant.catno_raw || "—")} · ${variant.year || "?"} · ${
          escapeHtml(variant.country || "?")} · ${escapeHtml(variant.formats.join(", "))}
          <a href="${escapeHtml(variant.discogs_url || `https://www.discogs.com/release/${variant.id}`)}"
             target="_blank" rel="noreferrer">Discogs</a></li>`
      ).join("")}</ul>`
    : "";

  const listening = data.listening;
  const buttons = ["gehoert", "favorit", "nochmal", "ungehoert"].map((status) =>
    `<button data-status="${status}" class="${listening.status === status ? "active" : ""}">${
      STATUS_LABEL[status]}</button>`).join("");
  const stars = [1, 2, 3, 4, 5].map((value) =>
    `<span data-rating="${value}" class="${listening.rating >= value ? "on" : ""}">★</span>`).join("");

  return `
    <div class="meta">${meta}
      · <a href="${escapeHtml(data.discogs_url)}" target="_blank" rel="noreferrer">Discogs</a>
      ${data.spotify_url ? `· <a href="${escapeHtml(data.spotify_url)}" target="_blank" rel="noreferrer">Spotify</a>` : ""}
      ${data.related_note ? `· ${escapeHtml(data.related_note)}` : ""}
    </div>
    ${tracks}
    ${leftovers}
    ${variants}
    <div class="actions">${buttons}
      <span class="stars" title="Bewertung">${stars}</span>
      <span class="saved" hidden>gespeichert</span>
    </div>
    <textarea class="notes" placeholder="Notiz …">${escapeHtml(listening.notes)}</textarea>
    ${data.notes ? `<h4>Discogs-Notizen</h4><div class="variants">${escapeHtml(data.notes)}</div>` : ""}
  `;
}

async function renderDetail(id) {
  const container = document.getElementById(`detail-${id}`);
  if (!container) return;

  let data = state.details.get(id);
  if (!data) {
    data = await api(`/api/releases/${id}`);
    state.details.set(id, data);
  }
  container.innerHTML = detailHtml(data);

  container.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setStatus(id, button.dataset.status);
    });
  });
  container.querySelectorAll("[data-rating]").forEach((star) => {
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      const value = Number(star.dataset.rating);
      const current = state.details.get(id).listening.rating;
      save(id, value === current ? { clear_rating: true } : { rating: value });
    });
  });

  const notes = container.querySelector(".notes");
  let timer;
  notes.addEventListener("click", (event) => event.stopPropagation());
  notes.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => save(id, { notes: notes.value }), 600);
  });
  notes.addEventListener("blur", () => {
    clearTimeout(timer);
    save(id, { notes: notes.value });
  });
}

/* --------------------------------------------------------- Schreiben -- */
async function save(id, payload) {
  const result = await api(`/api/listening/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const detail = state.details.get(id);
  if (detail) detail.listening = { ...detail.listening, ...result };

  const item = state.items.find((entry) => entry.id === id);
  if (item) {
    item.status = result.status;
    item.rating = result.rating;
    item.has_notes = result.notes ? 1 : 0;
  }

  const flash = document.querySelector(`#detail-${id} .saved`);
  if (flash) {
    flash.hidden = false;
    setTimeout(() => { flash.hidden = true; }, 900);
  }
  return result;
}

async function setStatus(id, status) {
  await save(id, { status });
  const detail = state.details.get(id);
  const notes = document.querySelector(`#detail-${id} .notes`);
  const keepNotes = notes ? notes.value : null;
  renderList();
  if (detail && keepNotes != null) {
    const field = document.querySelector(`#detail-${id} .notes`);
    if (field) field.value = keepNotes;
  }
  loadStats();
}

/* ------------------------------------------------------- Interaktion -- */
function moveCursor(delta) {
  if (!state.items.length) return;
  state.cursor = Math.max(0, Math.min(state.items.length - 1, state.cursor + delta));
  renderList();
  const row = listEl.querySelector(".row.cursor");
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function toggle(id, index) {
  state.expanded = state.expanded === id ? null : id;
  if (index != null) state.cursor = index;
  renderList();
  const row = listEl.querySelector(".row.cursor") || listEl.querySelector(".row.open");
  if (row && state.expanded) row.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function nextUnheard() {
  const params = filterParams();
  const current = state.expanded ?? state.items[state.cursor]?.id;
  if (current) params.set("after", current);
  const data = await api(`/api/next-unheard?${params}`);
  if (!data.id) {
    // Kurz Bescheid geben, danach wieder die normale Fortschrittsanzeige.
    $("#status-breakdown").textContent = "nichts mehr offen – alles durchgehört 🎉";
    setTimeout(loadStats, 2500);
    return;
  }
  let index = state.items.findIndex((item) => item.id === data.id);
  if (index === -1) {
    await loadList(true);
    index = state.items.findIndex((item) => item.id === data.id);
  }
  state.cursor = index;
  state.expanded = data.id;
  renderList();
  const row = listEl.querySelector(".row.open");
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* Die Zeile, auf die sich g/f/n/u beziehen: der Cursor gewinnt, sonst das,
 * was gerade aufgeklappt ist. */
function currentId() {
  return state.items[state.cursor]?.id ?? state.expanded ?? null;
}

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const id = currentId();
  switch (event.key) {
    case "j": moveCursor(1); break;
    case "k": moveCursor(-1); break;
    case "Enter":
    case "o":
      if (state.cursor >= 0) toggle(state.items[state.cursor].id, state.cursor);
      break;
    case "g": if (id) setStatus(id, "gehoert"); break;
    case "f": if (id) setStatus(id, "favorit"); break;
    case "n": if (id) setStatus(id, "nochmal"); break;
    case "u": if (id) setStatus(id, "ungehoert"); break;
    case ".": nextUnheard(); break;
    case "/": event.preventDefault(); toggleFilters(true); $("#f-q").focus(); break;
    default: return;
  }
  if (["j", "k", "g", "f", "n", "u", ".", "o", "Enter"].includes(event.key)) {
    event.preventDefault();
  }
});

listEl.addEventListener("click", (event) => {
  const row = event.target.closest(".row");
  if (!row) return;
  toggle(Number(row.dataset.id), Number(row.dataset.index));
});

function toggleFilters(force) {
  const panel = $("#filters");
  const open = force ?? !panel.classList.contains("open");
  panel.classList.toggle("open", open);
  $("#btn-filters").classList.toggle("active", open);
  return open;
}

$("#btn-next").addEventListener("click", nextUnheard);
$("#btn-next-mobile").addEventListener("click", nextUnheard);
$("#btn-filters").addEventListener("click", () => toggleFilters());
$("#btn-reset").addEventListener("click", () => {
  ["f-label", "f-era", "f-year-from", "f-year-to", "f-status", "f-q"]
    .forEach((id) => { document.getElementById(id).value = ""; });
  $("#f-video").checked = false;
  $("#f-sort").value = "catno";
  loadList();
});

let searchTimer;
["f-label", "f-era", "f-year-from", "f-year-to", "f-status", "f-sort", "f-video"]
  .forEach((id) => document.getElementById(id).addEventListener("change", () => loadList()));
$("#f-group").addEventListener("change", () => { saveFilters(); renderList(); });
$("#f-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadList(), 250);
});

/* Service Worker: macht die Seite auf dem Handy installierbar und laedt die
 * Oberflaeche auch dann, wenn der Server gerade nicht laeuft. API-Antworten
 * werden bewusst nicht gecacht -- der Hoerstatus soll immer aktuell sein. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/static/sw.js").catch(() => {
      /* z. B. wenn die Seite nicht ueber localhost laeuft -- kein Beinbruch */
    });
  });
}

(async function start() {
  restoreFilters();
  await loadMeta();
  if (state.meta.counts.releases) await loadList();
})();
