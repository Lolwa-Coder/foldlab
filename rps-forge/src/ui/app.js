// Controller: setup → (lobby | matchmaking) → draft → melee.
// Modes:
//   local   — hotseat, one device controls everyone (2–6)
//   private — online invite by code; host or join (2–6)
//   public  — online quick-match: auto 1v1 via a deterministic room cascade
// Roles: 'local' | 'host' | 'client' | 'matching'.

import {
  createGame, draftCard, resolveChoice, resolveTarget, meleePick, meleeNext,
  activeSeat, snapshotFor, forfeit,
} from "../game/state.js?b=3";
import { host as netHost, join as netJoin } from "../net/net.js?b=3";
import { spreadView, hud, meleeView } from "./render.js?b=3";
import * as vfx from "./vfx.js?b=4";
import { loadCount, bumpCount } from "./counter.js?b=4";

// Ambient background: prefer the 3D scene; fall back to the emoji animation if
// WebGL or the Three.js CDN isn't available.
(async () => {
  try { const m = await import("./bg3d.js?b=4"); await m.initBg3d(); }
  catch (e) { try { await import("./bgfx.js?b=4"); } catch {} }
})();

const MIN_P = 2;
const MAX_P = 6;
const MM_PREFIX = "RPSFORGE-MM-V1-ROOM-"; // deterministic matchmaking room ids
const SEAT_COLORS = ["#7b6cf0", "#e0a73a", "#48b884", "#e06a8a", "#5aa9d6", "#d98a4a"];
const tableEl = document.getElementById("table");
const hudEl = document.getElementById("hud");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let screen = "setup";          // 'setup' | 'waiting'
let setup = { mode: "local", count: 2, pub: "host", joinCode: "" };
let role = "local";
let lobby = null;
let net = null;
let mySeat = 0;
let g = null;
let netError = "";
let lastFxKey = null; // dedupes battle VFX per melee reveal
let matchSearching = false;

const makeCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

// ---- setup view -------------------------------------------------------------

function modeTabs() {
  const tab = (m, label) => `<button class="seg ${setup.mode === m ? "sel" : ""}" data-mode="${m}">${label}</button>`;
  return `<div class="lobby-row"><span class="lbl">Mode</span>${tab("local", "Local")}${tab("private", "Private")}${tab("public", "Public")}</div>`;
}

function countRow() {
  let counts = "";
  for (let n = MIN_P; n <= MAX_P; n++) counts += `<button class="count ${setup.count === n ? "sel" : ""}" data-count="${n}">${n}</button>`;
  return `<div class="lobby-row"><span class="lbl">Players</span><div class="counts">${counts}</div></div>`;
}

function setupView() {
  let panel = "";
  if (setup.mode === "local") {
    panel = `${countRow()}<button class="big start" data-act="create">Create local table ▸</button>
      <p class="muted small">Pass-and-play on one device.</p>`;
  } else if (setup.mode === "private") {
    panel = `
      <div class="lobby-row"><span class="lbl"></span>
        <button class="seg ${setup.pub === "host" ? "sel" : ""}" data-pub="host">Host</button>
        <button class="seg ${setup.pub === "join" ? "sel" : ""}" data-pub="join">Join by code</button>
      </div>
      ${setup.pub === "host"
        ? `${countRow()}<button class="big start" data-act="host-create">Host private lobby ▸</button>
           <p class="muted small">Share the code with friends to invite them.</p>`
        : `<div class="lobby-row"><span class="lbl">Code</span><input class="code-input" data-code value="${setup.joinCode}" placeholder="ABCD" maxlength="4" /></div>
           <button class="big start" data-act="client-join">Join lobby ▸</button>`}`;
  } else {
    panel = `<button class="big start" data-act="find-match">⚔ Find a match (1v1) ▸</button>
      <p class="muted small">Quick-match against the next player who's looking. Rooms fill two at a time.</p>`;
  }
  return `
    <div class="lobby">
      <h2>✦ New Game ✦</h2>
      ${modeTabs()}
      ${panel}
      ${netError ? `<div class="neterr">⚠ ${netError}</div>` : ""}
    </div>`;
}

function searchingView() {
  return `
    <div class="lobby searching">
      <h2>🔮 Searching…</h2>
      <div class="seeking"><span class="orb">✦</span> Looking for an opponent to duel…</div>
      <button class="big ghost" data-act="back">Cancel</button>
    </div>`;
}

function sideHelp() {
  return `<div class="lobby-side"><h3>How it plays</h3><ol>
      <li>Draft tarot cards to forge ✊✋✌ stats.</li>
      <li>Minor cards have a soul: 😇 Holy (humble +1) or 😈 Evil (greedy +3); plain cards give +2.</li>
      <li>Reach 3 Holy and your weakest tool is <b>Blessed</b> 💎 — it strikes back even when countered. Reach 3 Evil and it's <b>Cursed</b> ☠ — it loses every mirror clash.</li>
      <li>Opponents' stats & special cards stay hidden.</li>
      <li>Free-for-all melee: throw each round, lose HP to whoever beats you.</li>
      <li>0 HP = eliminated. Last fighter standing wins.</li>
    </ol></div>`;
}

// ---- waiting room -----------------------------------------------------------

function makeLocalLobby() {
  return { mode: "local", code: makeCode(), seats: Array.from({ length: setup.count }, (_, i) => ({ name: `Player ${i + 1}`, joined: i === 0, ready: false, peerId: null })) };
}

function waitingView() {
  const isLocal = role === "local";
  const isHost = role === "host";
  const seats = lobby.seats;
  const joined = seats.filter((s) => s.joined).length;
  const readyCount = seats.filter((s) => s.joined && s.ready).length;
  const allReady = seats.every((s) => s.joined && s.ready);
  const locked = allReady && seats.every((s) => s.joined);

  const rows = seats
    .map((s, i) => {
      const mine = isLocal || i === mySeat;
      if (!s.joined) {
        return `<div class="seat empty"><span class="seat-num">${i + 1}</span>
          <span class="seat-open">${isLocal ? "Open seat" : "Awaiting a challenger…"}${locked ? " · 🔒" : ""}</span>
          ${isLocal && !locked ? `<button class="seat-join" data-join="${i}">Join</button>` : ""}</div>`;
      }
      return `<div class="seat ${s.ready ? "ready" : ""}" style="border-color:${SEAT_COLORS[i]}">
        <span class="seat-num">${i + 1}</span>
        ${mine ? `<input class="seat-name" data-seat="${i}" value="${s.name}" maxlength="14" />` : `<span class="seat-name ro">${s.name}</span>`}
        ${i === 0 ? `<span class="host">HOST</span>` : ""}${mine ? `<span class="you">YOU</span>` : ""}
        <button class="seat-ready ${s.ready ? "on" : ""}" data-ready="${i}" ${mine ? "" : "disabled"}>${s.ready ? "Ready ✓" : "Ready?"}</button>
      </div>`;
    })
    .join("");

  const meta = lobby.matchmaking
    ? `⚔ Quick Match · ${joined}/${seats.length} present · ${readyCount} ready`
    : `Code <b class="code">${lobby.code}</b> · ${joined}/${seats.length} joined · ${readyCount} ready`;
  const canStart = (isHost || isLocal) && allReady;
  return `
    <div class="lobby waiting">
      <h2>${lobby.matchmaking ? "Quick Match" : lobby.mode === "private" ? "Private Lobby" : "Lobby"}</h2>
      <div class="lobby-meta">${meta}</div>
      <div class="seats">${rows}</div>
      ${locked ? `<div class="locked-note">🔒 Everyone's ready — the table is sealed.</div>`
               : `<div class="muted small">${isHost && !lobby.matchmaking ? "Share the code. " : ""}Take a seat and ready up; the table locks once all are ready.</div>`}
      <div class="lobby-actions">
        <button class="big ghost" data-act="back">‹ Leave</button>
        ${isHost || isLocal ? `<button class="big start" data-act="startgame" ${canStart ? "" : "disabled"}>Start game ▸</button>` : `<span class="muted">Waiting for host to start…</span>`}
      </div>
    </div>`;
}

// ---- render -----------------------------------------------------------------

function render() {
  if (g) {
    if (role === "host") { g.viewer = mySeat; g.controllable = activeSeat(g) === mySeat; g.canAdvance = true; }
    else if (role === "local") { const vs = activeSeat(g); g.viewer = vs === -1 ? g.current : vs; g.controllable = true; g.canAdvance = true; }
    if (g.phase === "melee") {
      tableEl.innerHTML = `<div class="duel-banner">🏰 To the melee! 🏰<br><span>Read your rivals. Last one standing wins.</span></div>`;
      hudEl.innerHTML = meleeView(g);
      // fire battle VFX once per new reveal (visible to everyone)
      const m = g.melee;
      const key = m.reveal ? `${m.reveal.round}:${m.reveal.final ? "F" : "R"}` : null;
      if (key && key !== lastFxKey) {
        lastFxKey = key;
        const reveal = m.reveal, winnerIdx = m.winnerIdx;
        requestAnimationFrame(() => vfx.battleVfx(reveal, winnerIdx));
      }
    } else {
      tableEl.innerHTML = spreadView(g);
      hudEl.innerHTML = hud(g);
    }
    return;
  }
  if (role === "matching" && !lobby) { tableEl.innerHTML = searchingView(); hudEl.innerHTML = sideHelp(); return; }
  tableEl.innerHTML = screen === "waiting" ? waitingView() : setupView();
  hudEl.innerHTML = sideHelp();
}

// ---- game action plumbing ---------------------------------------------------

function applyAction(a) {
  switch (a.type) {
    case "draft": draftCard(g, a.uid); break;
    case "choice": resolveChoice(g, a.opt); break;
    case "target": resolveTarget(g, a.idx); break;
    case "throw": meleePick(g, a.hand); break;
    case "meleenext": meleeNext(g); break;
  }
}

function broadcastViews() {
  if (role !== "host") return;
  lobby.seats.forEach((s, i) => { if (i !== mySeat && s.peerId) net.send(s.peerId, { t: "view", snap: snapshotFor(g, i) }); });
}

function hostHandleAction(seat, action) {
  if (!g) return;
  if (action.type === "meleenext" || action.type === "new") { if (seat !== mySeat) return; }
  else if (activeSeat(g) !== seat) return;
  if (action.type === "new") g = createGame(lobby.seats.map((s) => s.name));
  else applyAction(action);
  broadcastViews();
  render();
}

function localAction(action) {
  // themed card-use effect on the acting device (before the card leaves state)
  let fxCard = null;
  if (g) {
    if (action.type === "draft") fxCard = g.spread && g.spread.find((c) => c.uid === action.uid);
    else if (action.type === "choice") fxCard = g.pendingChoice && g.pendingChoice.card;
    else if (action.type === "target") fxCard = g.pendingTarget && g.pendingTarget.card;
  }
  if (fxCard) { const c = spreadCenter(); vfx.cardEffect(fxCard, c.x, c.y); }

  if (role === "client") { net.send({ t: "action", action }); return; }
  if (role === "host") { hostHandleAction(mySeat, action); return; }
  if (action.type === "new") { g = null; screen = "setup"; lobby = null; lastFxKey = null; }
  else applyAction(action);
  render();
}

function spreadCenter() {
  const el = document.querySelector(".spread") || document.getElementById("table");
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ---- lobby networking (host side) -------------------------------------------

function lobbyPublic() {
  return { mode: lobby.mode, code: lobby.code, matchmaking: lobby.matchmaking, seats: lobby.seats.map((s) => ({ name: s.name, joined: s.joined, ready: s.ready })) };
}

function broadcastLobby() {
  if (role !== "host") return;
  lobby.seats.forEach((s, i) => { if (s.peerId) net.send(s.peerId, { t: "lobby", lobby: lobbyPublic(), yourSeat: i }); });
  render();
}

const hostHandlers = () => ({ onJoin: onPeerJoin, onLeave: onPeerLeave, onMessage: onHostMessage, onError: (e) => { netError = "Connection error: " + (e.type || e.message); render(); } });

function onPeerJoin(peerId) {
  if (g) { net.send(peerId, { t: "full" }); return; }       // game already going — no late joins
  const seat = lobby.seats.findIndex((s) => !s.joined);
  if (seat === -1) { net.send(peerId, { t: "full" }); return; }
  lobby.seats[seat] = { name: `Player ${seat + 1}`, joined: true, ready: false, peerId };
  broadcastLobby();
}

function onPeerLeave(peerId) {
  const seat = lobby.seats.findIndex((s) => s.peerId === peerId);
  if (seat === -1) return;
  if (!g) { lobby.seats[seat] = { name: `Player ${seat + 1}`, joined: false, ready: false, peerId: null }; broadcastLobby(); return; }
  // mid-game: leaving = losing. Forfeit them and continue.
  forfeit(g, seat);
  broadcastViews();
  render();
}

// Auto-play a stalled seat's turn (used by the turn timer). Default action only.
function autoPlay(seat) {
  if (g.phase === "draft" && g.current === seat) {
    if (g.pendingTarget) resolveTarget(g, g.pendingTarget.eligible[0]);
    else if (g.pendingChoice) resolveChoice(g, g.pendingChoice.options[0].opt);
    else draftCard(g, g.spread[0].uid);
  } else if (g.phase === "melee" && g.melee.picker === seat && !g.melee.reveal) {
    meleePick(g, "rock");
  }
  if (role === "host") broadcastViews();
  render();
}

function onHostMessage(peerId, msg) {
  const seat = lobby.seats.findIndex((s) => s.peerId === peerId);
  if (seat === -1) return;
  if (msg.t === "name") { lobby.seats[seat].name = (msg.name || `Player ${seat + 1}`).slice(0, 14); broadcastLobby(); }
  else if (msg.t === "ready") { lobby.seats[seat].ready = !!msg.ready; broadcastLobby(); }
  else if (msg.t === "action") hostHandleAction(seat, msg.action);
}

// ---- client side ------------------------------------------------------------

function onClientData(msg) {
  if (msg.t === "lobby") { role = "client"; lobby = msg.lobby; mySeat = msg.yourSeat; g = null; screen = "waiting"; render(); }
  else if (msg.t === "view") { g = msg.snap; render(); }
  else if (msg.t === "full") { netError = "That lobby is full."; if (net) net.destroy(); net = null; role = "local"; render(); }
}

function onClientClose() { netError = "Disconnected from host."; g = null; role = "local"; lobby = null; screen = "setup"; net = null; render(); }

// ---- mode entry points ------------------------------------------------------

async function hostCreate() {
  netError = ""; role = "host"; mySeat = 0;
  lobby = { mode: "private", code: "", seats: Array.from({ length: setup.count }, (_, i) => ({ name: `Player ${i + 1}`, joined: i === 0, ready: false, peerId: null })) };
  let h = null;
  for (let tries = 0; tries < 6 && !h; tries++) {
    const code = makeCode();
    try { h = await netHost(code, hostHandlers()); lobby.code = code; }
    catch (e) { if (e.type !== "unavailable-id") { netError = "Couldn't open lobby: " + (e.message || e.type); role = "local"; render(); return; } }
  }
  if (!h) { netError = "Couldn't claim a code, try again."; role = "local"; render(); return; }
  net = h; screen = "waiting"; render();
}

async function clientJoin() {
  netError = "";
  const code = (setup.joinCode || "").toUpperCase().trim();
  if (code.length < 3) { netError = "Enter the 4-letter lobby code."; render(); return; }
  try { net = await netJoin(code, { onData: onClientData, onClose: onClientClose }); role = "client"; render(); }
  catch (e) { netError = "Couldn't join: " + (e.message || e.type); render(); }
}

// Matchmaking: cascade through deterministic rooms — host the first free one,
// else join it; if it's full, move to the next. Forms 1v1 rooms two at a time.
async function findMatch() {
  netError = ""; matchSearching = true; role = "matching"; lobby = null; g = null; screen = "waiting"; render();
  for (let room = 1; room <= 60 && matchSearching; room++) {
    const code = MM_PREFIX + room;
    // 1) try to host this room
    try {
      const h = await netHost(code, hostHandlers());
      if (!matchSearching) { h.destroy(); return; }
      net = h; role = "host"; mySeat = 0; matchSearching = false;
      lobby = { mode: "public", matchmaking: true, code, seats: [
        { name: "You", joined: true, ready: false, peerId: null },
        { name: "Player 2", joined: false, ready: false, peerId: null },
      ] };
      screen = "waiting"; render(); return;
    } catch (e) {
      if (e.type !== "unavailable-id") { netError = "Matchmaking failed: " + (e.message || e.type); resetToSetup(); return; }
    }
    // 2) room taken → try to join it
    let joined = false, full = false, cli = null;
    try {
      cli = await netJoin(code, { onData: (m) => { if (m.t === "full") full = true; else { onClientData(m); if (m.t === "lobby") joined = true; } }, onClose: onClientClose });
    } catch (e) { continue; } // couldn't connect — next room
    await wait(1500);
    if (joined && matchSearching) { net = cli; role = "client"; matchSearching = false; return; }
    try { cli.destroy(); } catch {}
    if (full) continue; // room was full — next room
  }
  if (matchSearching) { netError = "No opponents right now — try again."; resetToSetup(); }
}

function resetToSetup() { matchSearching = false; role = "local"; screen = "setup"; lobby = null; render(); }

function startGame() {
  if (!lobby.seats.every((s) => s.joined && s.ready)) return;
  g = createGame(lobby.seats.map((s) => s.name));
  lastFxKey = null;
  if (role !== "client") bumpCount(); // count each game once (host/local; clients are part of the host's game)
  if (role === "host") broadcastViews();
  render();
}

function leave() {
  matchSearching = false;
  if (net) { try { net.destroy(); } catch {} net = null; }
  role = "local"; g = null; lobby = null; screen = "setup"; lastFxKey = null; render();
}

// ---- events -----------------------------------------------------------------

// ---- turn timer -------------------------------------------------------------
// Each active turn gets TURN_SECONDS; when it runs out the turn auto-skips
// (default action). Only the authoritative side (local/host) enforces it; clients
// just see the countdown. Reveal/round-advance is not timed.
const TURN_SECONDS = 30;
let turnKey = null;
let turnEndsAt = 0;
const clockEl = document.createElement("div");
clockEl.className = "turnclock";
clockEl.hidden = true;
document.body.appendChild(clockEl);

function turnKeyOf() {
  if (!g) return null;
  if (g.phase === "draft") return `d:${g.current}:${g.players[g.current]?.picksLeft}:${g.pendingChoice ? 1 : 0}:${g.pendingTarget ? 1 : 0}`;
  if (g.phase === "melee") { const m = g.melee; return m && !m.reveal ? `m:${m.round}:${m.picker}:${m.pos}` : "m:reveal"; }
  return null;
}

function tickClock() {
  const active = g ? activeSeat(g) : -1;
  if (!g || active === -1) { clockEl.hidden = true; turnKey = null; return; }
  const key = turnKeyOf();
  if (key !== turnKey) { turnKey = key; turnEndsAt = Date.now() + TURN_SECONDS * 1000; }
  const remain = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000));
  clockEl.hidden = false;
  clockEl.textContent = `⏳ ${g.players[active].name}: ${remain}s`;
  clockEl.classList.toggle("low", remain <= 5);
  if (remain <= 0 && (role === "local" || role === "host")) {
    turnEndsAt = Date.now() + TURN_SECONDS * 1000; // re-arm before acting
    autoPlay(active);
  }
}
setInterval(tickClock, 250);
loadCount(); // show the global games-played total

document.getElementById("app").addEventListener("input", (e) => {
  const code = e.target.closest("input[data-code]");
  if (code) { setup.joinCode = code.value.toUpperCase(); return; }
  const t = e.target.closest("input[data-seat]");
  if (!t || !lobby) return;
  const i = Number(t.dataset.seat);
  lobby.seats[i].name = t.value || `Player ${i + 1}`;
  if (role === "client") net.send({ t: "name", name: lobby.seats[i].name });
  else if (role === "host") broadcastLobby();
});

document.getElementById("app").addEventListener("click", (e) => {
  const t = e.target.closest("[data-draft],[data-choice],[data-target],[data-throw],[data-act],[data-count],[data-mode],[data-pub],[data-join],[data-ready]");
  if (!t) return;
  const d = t.dataset;

  if (d.count !== undefined) setup.count = Number(d.count);
  else if (d.mode !== undefined) { setup.mode = d.mode; netError = ""; }
  else if (d.pub !== undefined) setup.pub = d.pub;
  else if (d.act === "create") { role = "local"; lobby = makeLocalLobby(); screen = "waiting"; }
  else if (d.act === "host-create") { hostCreate(); return; }
  else if (d.act === "client-join") { clientJoin(); return; }
  else if (d.act === "find-match") { findMatch(); return; }
  else if (d.act === "back") { leave(); }
  else if (d.join !== undefined) { if (role === "local") lobby.seats[Number(d.join)].joined = true; }
  else if (d.ready !== undefined) {
    const i = Number(d.ready);
    if (role === "local") lobby.seats[i].ready = !lobby.seats[i].ready;
    else if (i === mySeat) {
      const v = !lobby.seats[i].ready;
      lobby.seats[i].ready = v;
      if (role === "client") net.send({ t: "ready", ready: v });
      else broadcastLobby();
    }
  } else if (d.act === "startgame") { startGame(); return; }
  else if (d.draft !== undefined) localAction({ type: "draft", uid: Number(d.draft) });
  else if (d.choice !== undefined) localAction({ type: "choice", opt: d.choice });
  else if (d.target !== undefined) localAction({ type: "target", idx: Number(d.target) });
  else if (d.throw !== undefined) localAction({ type: "throw", hand: d.throw });
  else if (d.act === "meleenext") localAction({ type: "meleenext" });
  else if (d.act === "new") localAction({ type: "new" });

  render();
});

render();
