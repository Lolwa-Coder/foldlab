// Global "games played" counter. Uses Abacus (abacus.jasoncameron.dev) — a free,
// no-account, CORS-enabled hit counter. There is no server/billing of our own;
// this is the only no-login way to keep a number shared across all players.
// Best-effort: if the service is unreachable the counter simply hides.
//
// /get/<ns>/<key>  → read without incrementing
// /hit/<ns>/<key>  → increment and return the new value

const BASE = "https://abacus.jasoncameron.dev";
const NS = "rpsforge-lolwa-coder";
const KEY = "plays";

function show(n) {
  const el = document.getElementById("playcount");
  if (!el) return;
  el.textContent = n == null ? "" : `🎮 ${Number(n).toLocaleString()} champions forged`;
}

export async function loadCount() {
  try {
    const r = await fetch(`${BASE}/get/${NS}/${KEY}`);
    if (!r.ok) return show(null);
    const j = await r.json();
    show(j.value ?? 0);
  } catch { show(null); }
}

// Called when a game actually starts. Increments the shared total and updates UI.
export async function bumpCount() {
  try {
    const r = await fetch(`${BASE}/hit/${NS}/${KEY}`);
    if (!r.ok) return;
    const j = await r.json();
    show(j.value);
  } catch { /* offline / blocked — leave the displayed number as-is */ }
}
