// Game state + actions for the tarot draft + free-for-all melee.
// Supports 2–6 players (hotseat / pass-and-play; the same actions will drive the
// networked game later).
//
// Flow:  draft (each player takes PICKS_EACH cards from the shared spread)
//        -> melee (free-for-all: everyone secretly throws each round, you take
//                  damage from everyone who beats you, 0 HP = eliminated,
//                  last player standing wins)

import { buildDeck } from "./tarot.js?b=3";
import { resolveThrow, beats } from "../engine/payoff.js?b=3";

export const START_STAT = 1;
export const START_HP = 40;
export const PICKS_EACH = 5;
export const SPREAD_SIZE = 4;
export const MELEE_CAP = 16; // round cap so attrition can't run forever
export const HOLY_T = 3; // holy ≥ this → a tool is blessed
export const EVIL_T = 3; // evil ≥ this → a tool is cursed
const STATS = ["rock", "paper", "scissors"];
const HANDS = ["rock", "paper", "scissors"];

const SECRET_EVENT = (name) => `✦ ${name} channels the Major Arcana…`;
const lowestStat = (s) => STATS.reduce((a, b) => (s[a] <= s[b] ? a : b));
const highestStat = (s) => STATS.reduce((a, b) => (s[a] >= s[b] ? a : b));
const aliveIndices = (g) => g.players.map((_, i) => i).filter((i) => g.players[i].alive);

export function createGame(names = ["Player 1", "Player 2"], rng = Math.random) {
  const deck = buildDeck(rng);
  const spread = deck.splice(0, SPREAD_SIZE);
  return {
    deck,
    spread,
    phase: "draft",
    rng,
    current: 0,
    pendingChoice: null, // { card, options }
    pendingTarget: null, // { card, kind: 'copy'|'tower', eligible: [idx] }
    lastEvent: "",
    message: `${names[0]}: draft a card from the spread.`,
    players: names.map((name) => ({
      name,
      alive: true,
      left: false, // true if the player quit — they forfeit
      picksLeft: PICKS_EACH,
      holy: 0,
      evil: 0,
      blessedHand: null, // hand index blessed by holiness (set at melee start)
      cursedHand: null, // hand index cursed by evil (set at melee start)
      stat: { rock: START_STAT, paper: START_STAT, scissors: START_STAT, hp: START_HP },
      lastForge: null,
    })),
    melee: null,
  };
}

const others = (g) => g.players.map((_, i) => i).filter((i) => i !== g.current && !g.players[i].left);

function refill(g) {
  while (g.spread.length < SPREAD_SIZE && g.deck.length) g.spread.push(g.deck.shift());
}

// ---- Draft ------------------------------------------------------------------

export function draftCard(g, uid) {
  if (g.phase !== "draft" || g.pendingChoice || g.pendingTarget) return;
  const idx = g.spread.findIndex((c) => c.uid === uid);
  if (idx === -1) return;
  const card = g.spread.splice(idx, 1)[0];
  refill(g);
  const me = g.players[g.current];

  if (card.kind === "minor") {
    me.stat[card.stat] += card.value;
    me.lastForge = { stat: card.stat, value: card.value };
    if (card.align === "holy") me.holy++;
    else if (card.align === "evil") me.evil++;
    const tag = card.align === "holy" ? " 😇" : card.align === "evil" ? " 😈" : "";
    g.lastEvent = `${me.name} forged +${card.value} ${card.stat} from ${card.name}.${tag}`;
    return finishTurn(g);
  }

  // Major Arcana
  if (card.cat === "choice") {
    g.pendingChoice = { card, options: card.options };
    g.message = `${me.name}: ${card.name} — ${card.desc}. Choose:`;
    return;
  }
  if (card.key === "moon") return askTarget(g, card, "copy", "copy");
  if (card.key === "tower") return askTarget(g, card, "tower", "disrupt");

  // self-only powers (sun / wheel / priestess)
  applySelfMajor(g, card, me);
  g.lastEvent = SECRET_EVENT(me.name);
  finishTurn(g);
}

function askTarget(g, card, kind, verb) {
  g.pendingTarget = { card, kind, eligible: others(g) };
  g.message = `${g.players[g.current].name}: ${card.name} — choose a player to ${verb}.`;
}

function applySelfMajor(g, card, me) {
  switch (card.key) {
    case "sun":
      for (const s of STATS) me.stat[s] += 1;
      me.lastForge = { stat: highestStat(me.stat), value: 1 };
      break;
    case "wheel": {
      const s = STATS[Math.floor(g.rng() * 3)];
      const amt = 1 + Math.floor(g.rng() * 4);
      me.stat[s] += amt;
      me.lastForge = { stat: s, value: amt };
      break;
    }
    case "priestess": {
      const s = lowestStat(me.stat);
      me.stat[s] += 2;
      me.lastForge = { stat: s, value: 2 };
      break;
    }
  }
}

export function resolveTarget(g, targetIdx) {
  const pt = g.pendingTarget;
  if (!pt || !pt.eligible.includes(targetIdx)) return;
  const me = g.players[g.current];
  const target = g.players[targetIdx];

  if (pt.kind === "copy") copyForge(g, me, target);
  else if (pt.kind === "tower") {
    const t = highestStat(target.stat);
    target.stat[t] = Math.max(1, target.stat[t] - 2);
  }
  g.pendingTarget = null;
  g.lastEvent = SECRET_EVENT(me.name);
  finishTurn(g);
}

function copyForge(g, me, target) {
  if (target.lastForge) {
    const { stat, value } = target.lastForge;
    me.stat[stat] += value;
    me.lastForge = { stat, value };
  } else {
    me.stat[lowestStat(me.stat)] += 1;
  }
}

export function resolveChoice(g, opt) {
  if (!g.pendingChoice) return;
  const me = g.players[g.current];
  const card = g.pendingChoice.card;
  g.pendingChoice = null;

  switch (opt) {
    case "fool_rock": forgeOne(me, "rock", 3); break;
    case "fool_paper": forgeOne(me, "paper", 3); break;
    case "fool_scissors": forgeOne(me, "scissors", 3); break;
    case "mag_forge": forgeOne(me, lowestStat(me.stat), 3); break;
    case "mag_convert": {
      const top = highestStat(me.stat);
      const low = lowestStat(me.stat);
      const moved = Math.min(3, me.stat[top] - 1);
      me.stat[top] -= moved;
      me.stat[low] += moved;
      me.lastForge = { stat: low, value: moved };
      break;
    }
    case "star_all":
      for (const s of STATS) me.stat[s] += 1;
      me.lastForge = { stat: highestStat(me.stat), value: 1 };
      break;
    case "star_copy":
      // needs a target — branch back into target selection
      return askTarget(g, card, "copy", "copy");
  }
  g.lastEvent = SECRET_EVENT(me.name);
  finishTurn(g);
}

function forgeOne(me, stat, amt) {
  me.stat[stat] += amt;
  me.lastForge = { stat, value: amt };
}

function finishTurn(g) {
  g.players[g.current].picksLeft--;
  // next player who hasn't quit and still has picks
  const N = g.players.length;
  let next = -1;
  for (let k = 1; k <= N; k++) {
    const idx = (g.current + k) % N;
    if (!g.players[idx].left && g.players[idx].picksLeft > 0) { next = idx; break; }
  }
  if (next === -1) return startMelee(g);
  g.current = next;
  g.message = `${g.players[g.current].name}: draft a card.`;
}

// ---- Free-for-all melee -----------------------------------------------------

export function startMelee(g) {
  g.players.forEach((p) => {
    p.alive = !p.left; // players who quit during the draft don't get to fight
    p.stat.hp = START_HP;
    // resolve alignment destiny on the weakest tool
    const weak = HANDS.indexOf(lowestStat(p.stat));
    p.blessedHand = p.holy >= HOLY_T ? weak : null;
    p.cursedHand = p.evil >= EVIL_T && p.blessedHand === null ? weak : null;
  });
  const blessed = g.players.filter((p) => p.blessedHand != null && !p.left).map((p) => p.name);
  const cursed = g.players.filter((p) => p.cursedHand != null && !p.left).map((p) => p.name);
  const fate = [blessed.length ? `💎 Blessed: ${blessed.join(", ")}` : "", cursed.length ? `☠ Cursed: ${cursed.join(", ")}` : ""].filter(Boolean).join("   ·   ");
  const order = aliveIndices(g);
  g.phase = "melee";
  g.melee = { round: 1, cap: MELEE_CAP, order, pos: 0, picker: order[0], picks: {}, reveal: null, winnerIdx: null };
  g.lastEvent = fate;
  g.message = `Melee! ${g.players[order[0]].name}, pick your throw — everyone else look away.`;
}

// Combat resolver for the melee, honouring blessings and curses.
//   blessed hand → when countered, strikes back for half (instead of 0)
//   cursed hand  → loses every mirror clash vs the same hand
function resolveDuelPair(A, B, a, b) {
  let { aDmg, bDmg } = resolveThrow(A.stat, B.stat, a, b);
  if (a === b) {
    const aC = A.cursedHand === a, bC = B.cursedHand === b;
    if (aC && !bC) { aDmg = 0; bDmg = Math.max(1, B.stat[HANDS[b]]); }
    else if (bC && !aC) { bDmg = 0; aDmg = Math.max(1, A.stat[HANDS[a]]); }
  } else if (beats(a, b)) {
    if (B.blessedHand === b) bDmg = Math.max(1, Math.floor(B.stat[HANDS[b]] / 2)); // blessed tool chips back
  } else {
    if (A.blessedHand === a) aDmg = Math.max(1, Math.floor(A.stat[HANDS[a]] / 2));
  }
  return { aDmg, bDmg };
}

// A player quit — they forfeit (eliminated immediately). Robust across phases.
export function forfeit(g, seat) {
  const p = g.players[seat];
  if (!p || p.left) return;
  p.left = true;
  p.alive = false;
  p.picksLeft = 0;
  p.lastEvent = "";
  g.lastEvent = `${p.name} left the game.`;

  if (g.phase === "draft") {
    // if it's their turn (incl. a pending choice/target), pass to the next player
    if (g.current === seat) {
      g.pendingChoice = null;
      g.pendingTarget = null;
      finishTurn(g); // finishTurn skips players who left
    }
  } else if (g.phase === "melee" && g.melee) {
    const m = g.melee;
    if (!m.reveal) {
      const oi = m.order.indexOf(seat);
      if (oi !== -1) {
        m.order.splice(oi, 1);
        if (oi < m.pos) m.pos--; // keep pos aligned to the same upcoming picker
        delete m.picks[seat];
      }
      if (m.order.length === 0) {
        m.reveal = { throws: {}, dmg: {}, elim: [seat], round: m.round, final: true };
        m.winnerIdx = -1;
      } else if (m.pos >= m.order.length) {
        resolveRound(g);
      } else {
        m.picker = m.order[m.pos];
        // if only one fighter remains, end it
        const alive = aliveIndices(g);
        if (alive.length <= 1) {
          m.reveal = { throws: {}, dmg: {}, elim: [], round: m.round, final: true };
          m.winnerIdx = alive.length === 1 ? alive[0] : -1;
        } else {
          g.message = `${p.name} fled. ${g.players[m.picker].name}, pick your throw.`;
        }
      }
    }
  }
}

export function meleePick(g, hand) {
  const m = g.melee;
  if (g.phase !== "melee" || !m || m.reveal || !HANDS.includes(hand)) return;
  m.picks[m.picker] = hand;
  m.pos++;
  if (m.pos >= m.order.length) return resolveRound(g);
  m.picker = m.order[m.pos];
  g.message = `${g.players[m.picker].name}, pick your throw.`;
}

function resolveRound(g) {
  const m = g.melee;
  const P = g.players;
  const ord = m.order;
  const dmg = {};
  ord.forEach((i) => (dmg[i] = 0));

  // every pair of throwers clashes; you take damage from anyone who beats you
  for (let x = 0; x < ord.length; x++) {
    for (let y = x + 1; y < ord.length; y++) {
      const i = ord[x];
      const j = ord[y];
      const a = HANDS.indexOf(m.picks[i]);
      const b = HANDS.indexOf(m.picks[j]);
      const r = resolveDuelPair(P[i], P[j], a, b);
      dmg[j] += jitter(r.aDmg, 0.1, g.rng); // i deals to j
      dmg[i] += jitter(r.bDmg, 0.1, g.rng); // j deals to i
    }
  }

  const elim = [];
  ord.forEach((i) => {
    P[i].stat.hp -= dmg[i];
    if (P[i].stat.hp <= 0 && P[i].alive) {
      P[i].stat.hp = 0;
      P[i].alive = false;
      elim.push(i);
    }
  });

  m.reveal = { throws: { ...m.picks }, dmg, elim, round: m.round };
  const alive = aliveIndices(g);
  if (alive.length <= 1) {
    m.reveal.final = true;
    m.winnerIdx = alive.length === 1 ? alive[0] : -1;
  } else if (m.round >= m.cap) {
    m.reveal.final = true;
    m.winnerIdx = topHp(g, alive);
  }
  g.message = `Round ${m.round} resolved.`;
}

export function meleeNext(g) {
  const m = g.melee;
  if (!m || !m.reveal || m.reveal.final) return;
  m.round++;
  m.order = aliveIndices(g);
  m.pos = 0;
  m.picker = m.order[0];
  m.picks = {};
  m.reveal = null;
  g.message = `Round ${m.round} — ${g.players[m.picker].name}, pick your throw.`;
}

function topHp(g, alive) {
  let best = alive[0];
  let tie = false;
  for (const i of alive) {
    if (g.players[i].stat.hp > g.players[best].stat.hp) {
      best = i;
      tie = false;
    } else if (i !== best && g.players[i].stat.hp === g.players[best].stat.hp) tie = true;
  }
  return tie ? -1 : best;
}

function jitter(dmg, variance, rng) {
  if (dmg === 0) return 0;
  return Math.max(0, Math.round(dmg * (1 + (rng() * 2 - 1) * variance)));
}

// ---- Networking helpers -----------------------------------------------------

// Which seat is allowed to act right now (draft = current player; melee pick =
// the picker). Reveal/round-advance is host-driven, so returns -1 there.
export function activeSeat(g) {
  if (g.phase === "draft") return g.current;
  if (g.phase === "melee" && g.melee && !g.melee.reveal) return g.melee.picker;
  return -1;
}

// Build a redacted, serializable view of the game for one seat. Other players'
// stats are nulled (rendered as "?"), and in-progress melee picks are stripped,
// so a client literally never receives data it shouldn't see.
export function snapshotFor(g, seat) {
  const cur = g.current;
  return {
    phase: g.phase,
    current: g.current,
    deck: { length: g.deck.length },
    spread: g.spread,
    lastEvent: g.lastEvent,
    message: g.message,
    pendingChoice: cur === seat ? g.pendingChoice : null,
    pendingTarget: cur === seat ? g.pendingTarget : null,
    players: g.players.map((p, i) => ({
      name: p.name,
      alive: p.alive,
      stat: i === seat ? { ...p.stat } : { rock: null, paper: null, scissors: null, hp: p.stat.hp },
      lastForge: i === seat ? p.lastForge : null,
      holy: i === seat ? p.holy : null,
      evil: i === seat ? p.evil : null,
      blessedHand: p.blessedHand, // combat-relevant in the melee — public
      cursedHand: p.cursedHand,
    })),
    melee: g.melee
      ? {
          round: g.melee.round,
          rounds: g.melee.rounds,
          picker: g.melee.picker,
          order: g.melee.order,
          reveal: g.melee.reveal, // throws+dmg are public once revealed
          winnerIdx: g.melee.winnerIdx,
        }
      : null,
    viewer: seat,
    controllable: activeSeat(g) === seat,
    canAdvance: false,
  };
}
