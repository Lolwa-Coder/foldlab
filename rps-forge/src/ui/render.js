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

// The big arena (rendered in #table): one podium per fighter with a large hand
// that snaps from a ready fist to its thrown gesture on reveal, recoils when hit,
// drains its HP bar, and fades on KO. This is the "fighting animation".
export function meleeStage(g) {
  const m = g.melee;
  const P = g.players;
  const idxs = P.map((_, i) => i).filter((i) => !P[i].left);

  let head;
  if (m.reveal && m.reveal.final) head = m.winnerIdx === -1 ? "🤝 A draw!" : `🏆 ${P[m.winnerIdx].name} is the champion!`;
  else if (m.reveal) head = `⚔️ Round ${m.reveal.round} — clash!`;
  else head = `⚔️ Round ${m.round} · ${m.order.length} fighters left`;

  const fighters = idxs.map((i, k) => fighterCard(g, i, k)).join("");
  return `<div class="arena"><div class="arena-head">${head}</div><div class="arena-fighters">${fighters}</div></div>`;
}

function fighterCard(g, i, k) {
  const m = g.melee;
  const p = g.players[i];
  const col = PLAYER_COLOR[i];
  const ko = !p.alive;
  const dmg = m.reveal && m.reveal.dmg ? m.reveal.dmg[i] || 0 : 0;
  let hand;
  if (m.reveal) hand = m.reveal.throws[i] ? HAND_EMOJI[m.reveal.throws[i]] : ko ? "💀" : "✊";
  else hand = ko ? "💀" : "✊";
  const hp = p.stat.hp;
  const oldHp = hp + dmg;
  const pct = (h) => Math.max(0, Math.min(100, (h / 40) * 100));
  const badge = (p.blessedHand != null ? " 💎" : "") + (p.cursedHand != null ? " ☠" : "");
  const cls = ["afighter", m.reveal ? "revealed" : "pick", dmg > 0 ? "hurt" : "", ko ? "ko" : ""].join(" ");
  return `
    <div class="${cls}" data-seat="${i}" style="--col:${col}">
      <div class="aname" style="color:${col}">${p.name}${badge}</div>
      <div class="ahand" style="animation-delay:${k * 80}ms">${hand}</div>
      <div class="admg ${dmg ? "show" : ""}">${dmg ? `−${dmg}` : ""}</div>
      <div class="ahp"><i style="--from:${pct(oldHp)}%; --to:${pct(hp)}%; animation-delay:${k * 80 + 120}ms"></i><b>❤ ${hp}</b></div>
    </div>`;
}

// The HUD column: controls (throw buttons / next / new game), score and log.
export function meleeView(g) {
  const m = g.melee;
  const P = g.players;
  const viewer = viewerOf(g);

  if (m.reveal && m.reveal.final) {
    const standings = [...P.keys()]
      .filter((i) => !P[i].left)
      .sort((a, b) => P[b].stat.hp - P[a].stat.hp)
      .map((i) => `<div style="color:${PLAYER_COLOR[i]}">${P[i].alive ? "🏆" : "💀"} ${P[i].name} — ❤ ${P[i].stat.hp}</div>`)
      .join("");
    return `
      <div class="melee">
        <h2>🏁 Melee over</h2>
        <div class="standings">${standings}</div>
        <div class="actions">${canAdvance(g) ? `<button data-act="new" class="big">＋ New game</button>` : `<p class="hint">Waiting for the host…</p>`}</div>
      </div>`;
  }

  if (m.reveal) {
    return `
      <div class="melee">
        <h2>Round ${m.reveal.round}</h2>
        ${m.reveal.elim.length ? `<div class="elim">💀 ${m.reveal.elim.map((i) => P[i].name).join(", ")} eliminated!</div>` : `<p class="muted small">Blows traded — watch the arena.</p>`}
        <div class="actions">${canAdvance(g) ? `<button data-act="meleenext" class="big">Next round ▸</button>` : `<p class="hint">⏳ Waiting for the host…</p>`}</div>
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
      <p class="muted small">Your throw is compared against every fighter. You lose HP to each who beats it.</p>`
    : `<p class="hint">⏳ ${me.name} is choosing a throw…</p>`;
  return `
    <div class="melee">
      <h2>Round ${m.round}</h2>
      <div class="pick-prompt"><b style="color:${PLAYER_COLOR[m.picker]}">${me.name}</b>, choose your throw.
        ${youThrow ? `<span class="muted">others, look away 🙈</span>` : ""}</div>
      ${body}
    </div>`;
}
