// Bridges the forged characters into the combat engine. Best-of-4 throws (the
// format we settled on), equilibrium play for now — interactive throw-picking is
// a later polish step. Returns a per-throw replay the UI can animate.

import { fight, Strategies } from "../engine/combat.js";

export function runDuel(playerA, playerB, rng = Math.random) {
  const A = { ...playerA.stat };
  const B = { ...playerB.stat };
  const result = fight(A, B, Strategies.nash, Strategies.nash, { bouts: 4, variance: 0.1, rng });

  const winnerIdx = result.winner === "A" ? 0 : result.winner === "B" ? 1 : -1;
  return {
    statsA: A,
    statsB: B,
    log: result.log,
    dealt: result.dealt,
    winnerIdx,
    winnerName: winnerIdx === -1 ? "Draw" : (winnerIdx === 0 ? playerA.name : playerB.name),
  };
}
