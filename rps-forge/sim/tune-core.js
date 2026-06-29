// Card-pool tuning. Plays full games headlessly with a greedy draft AI, then
// auto-resolves the duel, and reports:
//   1. First-player win rate  — should be ~50% (turn order shouldn't decide games)
//   2. Per-card "win% when drafted" — a card far above 50% is a balance smell
//      (the classic suspect is The Moon stacking copies).
//
// The draft AI is crude but symmetric, so a card that consistently correlates
// with winning is a real signal, not just "good players pick good cards".

import { createGame, draftCard, resolveChoice } from "../src/game/state.js";
import { runDuel } from "../src/game/duel.js";

const STATS = ["rock", "paper", "scissors"];
const lowest = (s) => STATS.reduce((a, b) => (s[a] <= s[b] ? a : b));
const pad = (s, n) => String(s).padEnd(n);

function cardValue(card, me, opp) {
  if (card.kind === "minor") return card.value;
  switch (card.key) {
    case "sun": return 3;
    case "moon": return opp.lastForge ? opp.lastForge.value : 1;
    case "tower": return 2;
    case "wheel": return 2.5;
    case "priestess": return 2;
    case "fool": return 3;
    case "magician": return 3;
    case "star": return Math.max(3, opp.lastForge ? opp.lastForge.value : 0);
    default: return 1;
  }
}

function chooseOption(card, me, opp) {
  switch (card.key) {
    case "fool": return "fool_" + lowest(me.stat);
    case "magician": return "mag_forge";
    case "star": return opp.lastForge && opp.lastForge.value > 6 ? "star_copy" : "star_all";
    default: return card.options[0].opt;
  }
}

export function playGame(rng = Math.random) {
  const g = createGame(["A", "B"], rng);
  const drafted = [new Set(), new Set()];
  let guard = 300;
  while (g.phase === "draft" && guard-- > 0) {
    const me = g.players[g.current];
    const opp = g.players[(g.current + 1) % 2];
    if (g.pendingChoice) {
      resolveChoice(g, chooseOption(g.pendingChoice.card, me, opp));
      continue;
    }
    let best = g.spread[0];
    let bv = -Infinity;
    for (const c of g.spread) {
      const v = cardValue(c, me, opp);
      if (v > bv) { bv = v; best = c; }
    }
    if (best.kind === "major") drafted[g.current].add(best.key);
    draftCard(g, best.uid);
  }
  const d = runDuel(g.players[0], g.players[1], rng);
  return { winnerIdx: d.winnerIdx, drafted };
}

export function runTune(log, games = 2000) {
  log(`Card-pool tuning — ${games} games, greedy draft AI, best-of-4 auto duel`);
  log("");

  let p0 = 0;
  let draws = 0;
  const keys = ["sun", "moon", "tower", "wheel", "priestess", "fool", "magician", "star"];
  const stat = {};
  keys.forEach((k) => (stat[k] = { drew: 0, won: 0 }));

  for (let i = 0; i < games; i++) {
    const { winnerIdx, drafted } = playGame(Math.random);
    if (winnerIdx === 0) p0++;
    else if (winnerIdx === -1) draws++;
    for (let pl = 0; pl < 2; pl++) {
      for (const k of drafted[pl]) {
        stat[k].drew++;
        if (winnerIdx === pl) stat[k].won++;
        else if (winnerIdx === -1) stat[k].won += 0.5;
      }
    }
  }

  log(`First-player (P1) win rate: ${(((p0 + draws / 2) / games) * 100).toFixed(1)}%   (50% = fair turn order)`);
  log("");
  log("Per-card — when a player drafted it, did they win? (≈50% balanced; >>50% = too strong)");
  log("");
  log(pad("card", 14) + pad("times drafted", 16) + "win% when drafted");
  for (const k of keys) {
    const s = stat[k];
    const wr = s.drew ? (s.won / s.drew) * 100 : 0;
    const bar = "#".repeat(Math.round(wr / 2));
    log(pad(k, 14) + pad(s.drew, 16) + `${wr.toFixed(1).padStart(5)}%  ${bar}`);
  }
  log("");
}
