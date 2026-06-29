// Pure view layer for the tarot draft + free-for-all melee (2–6 players).
// Perspective-aware: `g.viewer` is the seat this screen belongs to (defaults to
// g.current for hotseat); `g.controllable`/`g.canAdvance` gate inputs for online
// clients (default true for hotseat). Others' hidden stats render as "?".

import { ALIGN_GLYPH } from "../game/tarot.js?b=3";

export const PLAYER_COLOR = ["#7b6cf0", "#e0a73a", "#48b884", "#e06a8a", "#5aa9d6", "#d98a4a"];
const HAND_SHORT = ["✊", "✋", "✌"];
const CAT_COLOR = { points: "#3fb950", power: "#b06cf0", choice: "#e0b84a" };
const HAND_EMOJI = { rock: "✊", paper: "✋", scissors: "✌" };

const viewerOf = (g) => (g.viewer ?? g.current);
const canAct = (g) => g.controllable !== false;
const canAdvance = (g) => g.canAdvance !== false;

function cardFace(card, clickable) {
  const accent = card.kind === "minor" ? "#5aa9d6" : CAT_COLOR[card.cat];
  const tag = card.kind === "minor" ? "POINTS" : card.cat.toUpperCase();
  return `
    <button class="card ${clickable ? "click" : "static"}" style="--accent:${accent}"
            ${clickable ? `data-draft="${card.uid}"` : "disabled"}>
      <div class="card-tag" style="background:${accent}">${tag}</div>
      <div class="card-icon">${card.icon}</div>
      <div class="card-name">${card.name}</div>
      <div class="card-desc">${card.desc}</div>
      ${card.kind === "minor" ? `<div class="card-lore">${ALIGN_GLYPH[card.align] || ""} <i>${card.lore}</i></div>` : ""}
    </button>`;
}

export function spreadView(g) {
  const clickable = g.phase === "draft" && !g.pendingChoice && !g.pendingTarget && canAct(g);
  return `
    <div class="spread-head">The Spread <span class="deck-count">${g.deck.length} in deck</span></div>
    <div class="spread">${g.spread.map((c) => cardFace(c, clickable)).join("")}</div>
    ${g.lastEvent ? `<div class="event">↳ ${g.lastEvent}</div>` : ""}`;
}

function statCard(p, color, { masked, hp }) {
  const s = p.stat;
  const v = (x) => (masked || x === null ? "?" : x);
  const dead = !p.alive;
  return `
    <div class="pcard ${dead ? "dead" : ""}" style="border-color:${color}">
      <div class="pname" style="color:${color}">${p.name}${masked ? " 🙈" : ""}${dead ? " 💀" : ""}</div>
      <div class="stats">
        <span>✊ <b>${v(s.rock)}</b></span>
        <span>✋ <b>${v(s.paper)}</b></span>
        <span>✌ <b>${v(s.scissors)}</b></span>
      </div>
      ${hp ? hpBar(s.hp, color) : `<div class="last">${masked ? "hidden from you" : p.lastForge ? `last +${p.lastForge.value} ${p.lastForge.stat}` : "—"}</div>`}
      ${alignLine(p, masked)}
    </div>`;
}

function alignLine(p, masked) {
  const bits = [];
  if (!masked && p.holy) bits.push(`😇${p.holy}`);
  if (!masked && p.evil) bits.push(`😈${p.evil}`);
  if (p.blessedHand != null) bits.push(`💎${HAND_SHORT[p.blessedHand]}`);
  if (p.cursedHand != null) bits.push(`☠${HAND_SHORT[p.cursedHand]}`);
  return bits.length ? `<div class="align">${bits.join(" ")}</div>` : "";
}

function hpBar(hp, color) {
  const pct = Math.max(0, Math.min(100, (hp / 40) * 100));
  return `<div class="hpbar"><div class="hpfill" style="width:${pct}%;background:${color}"></div><span>❤ ${hp}</span></div>`;
}

export function hud(g) {
  const viewer = viewerOf(g);
  const me = canAct(g);
  const curName = g.players[g.current].name;
  let actions;
  if (g.pendingTarget) {
    actions = me
      ? `<div class="choice-prompt">${g.pendingTarget.card.icon} ${g.pendingTarget.card.name} — pick a target</div>` +
        g.pendingTarget.eligible
          .map((i) => `<button class="big choice-btn" data-target="${i}" style="background:${PLAYER_COLOR[i]}">${g.players[i].name}</button>`)
          .join("")
      : `<p class="hint">⏳ ${curName} is choosing a target…</p>`;
  } else if (g.pendingChoice) {
    actions = me
      ? `<div class="choice-prompt">${g.pendingChoice.card.icon} ${g.pendingChoice.card.name}</div>` +
        g.pendingChoice.options
          .map((o) => `<button class="big choice-btn" data-choice="${o.opt}" style="background:${PLAYER_COLOR[g.current]}">${o.label}</button>`)
          .join("")
      : `<p class="hint">⏳ ${curName} is deciding…</p>`;
  } else {
    actions = me ? `<p class="hint">${curName}, click a card to forge it.</p>` : `<p class="hint">⏳ Waiting for ${curName} to draft…</p>`;
  }
  return `
    <div class="status">${g.message}</div>
    <div class="actions">${actions}</div>
    <div class="players">${g.players.map((p, i) => statCard(p, PLAYER_COLOR[i], { masked: i !== viewer })).join("")}</div>`;
}

// ---- Melee ------------------------------------------------------------------

export function meleeView(g) {
  const m = g.melee;
  const P = g.players;
  const viewer = viewerOf(g);

  if (m.reveal && m.reveal.final) {
    const c = m.winnerIdx === -1 ? "#aaa" : PLAYER_COLOR[m.winnerIdx];
    const name = m.winnerIdx === -1 ? "Nobody — a draw" : P[m.winnerIdx].name;
    const standings = [...P.keys()]
      .sort((a, b) => P[b].stat.hp - P[a].stat.hp)
      .map((i) => `<div style="color:${PLAYER_COLOR[i]}">${P[i].alive ? "🏆" : "💀"} ${P[i].name} — ❤ ${P[i].stat.hp}</div>`)
      .join("");
    return `
      <div class="melee">
        <h2>⚔️ Melee over</h2>
        <div class="winner" style="color:${c}">🏆 ${name}${m.winnerIdx === -1 ? "" : " wins!"}</div>
        ${revealGrid(g)}
        <div class="standings">${standings}</div>
        <div class="actions">${canAdvance(g) ? `<button data-act="new" class="big">＋ New game</button>` : `<p class="hint">Waiting for the host…</p>`}</div>
      </div>`;
  }

  if (m.reveal) {
    return `
      <div class="melee">
        <h2>⚔️ Round ${m.reveal.round} — reveal</h2>
        ${revealGrid(g)}
        ${m.reveal.elim.length ? `<div class="elim">Eliminated: ${m.reveal.elim.map((i) => P[i].name).join(", ")} 💀</div>` : ""}
        <div class="actions">${canAdvance(g) ? `<button data-act="meleenext" class="big">Next round ▸</button>` : `<p class="hint">⏳ Waiting for the host to continue…</p>`}</div>
      </div>`;
  }

  // secret pick phase
  const me = P[m.picker];
  const youThrow = m.picker === viewer && canAct(g);
  const body = youThrow
    ? `<div class="throw-buttons">
        <button class="throw" data-throw="rock">✊<small>Rock ${me.stat.rock}</small></button>
        <button class="throw" data-throw="paper">✋<small>Paper ${me.stat.paper}</small></button>
        <button class="throw" data-throw="scissors">✌<small>Scissors ${me.stat.scissors}</small></button>
      </div>
      <p class="muted small">Your throw is compared against every other fighter. You lose HP to each who beats it.</p>`
    : `<p class="hint">⏳ ${me.name} is choosing a throw…</p>`;
  return `
    <div class="melee">
      <h2>⚔️ Round ${m.round} · ${m.order.length} fighters</h2>
      <div class="pick-prompt"><b style="color:${PLAYER_COLOR[m.picker]}">${me.name}</b>, choose your throw.
        ${youThrow ? `<span class="muted">others, look away 🙈</span>` : ""}</div>
      ${body}
      <div class="roster">${g.players.map((p, i) => statCard(p, PLAYER_COLOR[i], { masked: i !== viewer, hp: true })).join("")}</div>
    </div>`;
}

function revealGrid(g) {
  const m = g.melee;
  const P = g.players;
  const cells = m.order
    .map((i) => {
      const hand = m.reveal.throws[i];
      const d = m.reveal.dmg[i];
      return `<div class="rcell" data-seat="${i}" style="border-color:${PLAYER_COLOR[i]}">
        <div style="color:${PLAYER_COLOR[i]}">${P[i].name}</div>
        <div class="rhand">${HAND_EMOJI[hand]}</div>
        <div class="rdmg ${d ? "took" : ""}">${d ? `−${d} HP` : "unscathed"}</div>
        <div class="rhp">❤ ${P[i].stat.hp}</div>
      </div>`;
    })
    .join("");
  return `<div class="reveal-grid">${cells}</div>`;
}
