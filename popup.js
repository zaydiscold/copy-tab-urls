// Copy Tab URLs — popup logic.
//
// State model: we keep the raw tab list, a Set of selected tab ids, and the
// user's saved settings (scope / format / dedupe). The Set is the source of
// truth for selection, so filtering the visible list never loses what you
// picked. Rendering is a pure function of (tabs, filter, selected).

const $ = (id) => document.getElementById(id);
const tabListEl = $("tab-list");
const emptyEl = $("empty");
const searchEl = $("search");
const countEl = $("count");
const copyBtn = $("copy-btn");
const dedupeEl = $("dedupe");
const toast = $("toast");

const state = {
  tabs: [],
  selected: new Set(),          // tab ids
  scope: "window",              // "window" | "all"
  fmt: "plain",                 // plain | numbered | markdown | titleUrl
  dedupe: false,
  filter: "",
};

// ── How selected tabs become text you paste into an AI ──────────────────
// This is the whole point of the tool. Each entry is (tab, index) -> string;
// the lines are joined with "\n". Tweak these templates to taste.
const FORMATS = {
  plain:    (t)     => t.url,
  numbered: (t, i)  => `${i + 1}. ${t.url}`,
  markdown: (t)     => `[${t.title || t.url}](${t.url})`,
  titleUrl: (t)     => `${t.title || "(untitled)"} — ${t.url}`,
};

function buildText() {
  // Selected tabs, in tab order (not click order), optionally de-duplicated.
  let picked = state.tabs.filter((t) => state.selected.has(t.id));
  if (state.dedupe) {
    const seen = new Set();
    picked = picked.filter((t) => (seen.has(t.url) ? false : seen.add(t.url)));
  }
  const fmt = FORMATS[state.fmt] || FORMATS.plain;
  return picked.map((t, i) => fmt(t, i)).join("\n");
}

// ── Rendering ───────────────────────────────────────────────────────────
function shortUrl(url) {
  try { const u = new URL(url); return u.hostname + (u.pathname === "/" ? "" : u.pathname); }
  catch { return url || ""; }
}

function render() {
  const f = state.filter.toLowerCase();
  tabListEl.replaceChildren();   // clear without innerHTML
  let shown = 0;

  for (const tab of state.tabs) {
    if (f && !(`${tab.title} ${tab.url}`.toLowerCase().includes(f))) continue;
    shown++;

    const li = document.createElement("li");
    if (state.selected.has(tab.id)) li.classList.add("selected");

    const check = document.createElement("span");
    check.className = "checkbox";

    const fav = document.createElement("img");
    fav.className = "favicon";
    fav.alt = "";
    if (tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)) fav.src = tab.favIconUrl;
    else fav.replaceWith(globe());
    fav.addEventListener("error", () => fav.replaceWith(globe()));

    const info = document.createElement("div");
    info.className = "tab-info";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "Untitled";
    const url = document.createElement("span");
    url.className = "tab-url";
    url.textContent = shortUrl(tab.url);
    info.append(title, url);

    li.append(check, fav, info);
    li.addEventListener("click", () => toggle(tab.id, li));
    tabListEl.appendChild(li);
  }

  emptyEl.classList.toggle("hidden", shown > 0);
  updateFooter();
}

function globe() {
  const s = document.createElement("span");
  s.className = "favicon globe";
  s.textContent = "🌐";
  return s;
}

function toggle(id, li) {
  if (state.selected.has(id)) { state.selected.delete(id); li.classList.remove("selected"); }
  else { state.selected.add(id); li.classList.add("selected"); }
  updateFooter();
}

function updateFooter() {
  const n = state.selected.size;
  countEl.textContent = `${n} selected`;
  copyBtn.textContent = n ? `Copy ${n}` : "Copy";
  copyBtn.disabled = n === 0;
}

// ── Data loading ────────────────────────────────────────────────────────
async function load() {
  const q = state.scope === "all" ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(q);
  state.tabs = tabs;

  // Pre-select Chrome's native multi-highlight: if you ⌘/⇧-click several tabs
  // before opening the popup, those come in highlighted — honor that. A single
  // highlighted tab is just the active one, so ignore that case.
  const highlighted = tabs.filter((t) => t.highlighted);
  state.selected = new Set(highlighted.length > 1 ? highlighted.map((t) => t.id) : []);

  render();
}

// ── Settings persistence ────────────────────────────────────────────────
async function loadSettings() {
  const s = await chrome.storage.local.get(["scope", "fmt", "dedupe"]);
  if (s.scope) state.scope = s.scope;
  if (s.fmt) state.fmt = s.fmt;
  state.dedupe = !!s.dedupe;
}
function saveSettings() {
  chrome.storage.local.set({ scope: state.scope, fmt: state.fmt, dedupe: state.dedupe });
}

function syncControls() {
  document.querySelectorAll("#scope button").forEach((b) => b.classList.toggle("active", b.dataset.scope === state.scope));
  document.querySelectorAll("#fmt button").forEach((b) => b.classList.toggle("active", b.dataset.fmt === state.fmt));
  dedupeEl.checked = state.dedupe;
}

// ── Copy ────────────────────────────────────────────────────────────────
async function copy() {
  const text = buildText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  showToast(`Copied ${state.selected.size} link${state.selected.size === 1 ? "" : "s"}`);
}

let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.remove("hidden");
  void toast.offsetHeight;         // reflow so the transition plays
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 250);
  }, 1300);
}

// ── Wire up ─────────────────────────────────────────────────────────────
$("scope").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-scope]"); if (!b) return;
  state.scope = b.dataset.scope; syncControls(); saveSettings(); load();
});
$("fmt").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-fmt]"); if (!b) return;
  state.fmt = b.dataset.fmt; syncControls(); saveSettings();
});
dedupeEl.addEventListener("change", () => { state.dedupe = dedupeEl.checked; saveSettings(); });
searchEl.addEventListener("input", () => { state.filter = searchEl.value.trim(); render(); });
$("select-all").addEventListener("click", () => {
  const f = state.filter.toLowerCase();
  for (const t of state.tabs) if (!f || `${t.title} ${t.url}`.toLowerCase().includes(f)) state.selected.add(t.id);
  render();
});
$("select-none").addEventListener("click", () => { state.selected.clear(); render(); });
copyBtn.addEventListener("click", copy);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") copy();
  if (e.key === "/" && document.activeElement !== searchEl) { e.preventDefault(); searchEl.focus(); }
});

(async () => {
  await loadSettings();
  syncControls();
  await load();
  searchEl.focus();
})();
