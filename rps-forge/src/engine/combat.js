// The combat resolver — a pure function. Transport-agnostic: it does not know or
// care whether throws arrive over PeerJS, a WebSocket, or local hotseat. Feed it
// two characters and a way to choose hands; it returns the winner and a full
// replay log (the log is the satisfying part to show in the UI).

import { HANDS, resolveThrow, netMatrix } from "./payoff.js";
import { solveZeroSum, sample } from "./nash.js";

/**
 * A "strategy" is a function (self, foe, rng) -> hand index (0..2).
 * Built-ins below; the live game will replace these with real player input.
 */
export const Strategies = {
  // Always throw your single biggest stat. Powerful but readable -> exploitable.
  greedy(self) {
    const stats = [self.rock, self.paper, self.scissors];
    return stats.indexOf(Math.max(...stats));
  },

  // Throw uniformly at random — the baseline "unreadable but unfocused" play.
  uniform(_self, _foe, rng = Math.random) {
    return Math.floor(rng() * 3);
  },

  // Play the game-theoretic equilibrium for the current matchup. This is the
  // "skilled player" model we balance against.
  nash(self, foe, rng = Math.random) {
    const M = netMatrix(self, foe);
    const { row } = solveZeroSum(M, 4000);
    return sample(row, rng);
  },
};

/**
 * Run a full fight.
 * @returns {{ winner: 'A'|'B'|'draw', rounds: number, log: object[], hp: {A:number,B:number} }}
 */
export function fight(charA, charB, stratA = Strategies.nash, stratB = Strategies.nash, opts = {}) {
  const { maxRounds = 50, variance = 0, rng = Math.random, bouts = null } = opts;

  // Two duel formats:
  //   attrition (default) — fight to 0 HP; long, so small edges compound.
  //   best-of-N (bouts)   — exactly N throws, winner = most total damage dealt.
  //                         Short, so variance keeps underdog builds alive.
  const limit = bouts ?? maxRounds;

  let hpA = charA.hp;
  let hpB = charB.hp;
  let dealtA = 0;
  let dealtB = 0;
  const log = [];

  let round = 0;
  while (round < limit) {
    if (!bouts && (hpA <= 0 || hpB <= 0)) break;
    round++;
    const a = stratA(charA, charB, rng);
    const b = stratB(charB, charA, rng);

    let { aDmg, bDmg } = resolveThrow(charA, charB, a, b);

    // "Snappy but forgiving": optional small swing so leaders aren't guaranteed.
    if (variance > 0) {
      aDmg = jitter(aDmg, variance, rng);
      bDmg = jitter(bDmg, variance, rng);
    }

    dealtA += aDmg;
    dealtB += bDmg;
    hpA -= bDmg;
    hpB -= aDmg;

    log.push({ round, a: HANDS[a], b: HANDS[b], aDmg, bDmg, hpA, hpB });
  }

  let winner;
  if (bouts) {
    winner = dealtA === dealtB ? "draw" : dealtA > dealtB ? "A" : "B"; // most damage dealt
  } else if (hpA <= 0 && hpB <= 0) winner = "draw";
  else if (hpB <= 0) winner = "A";
  else if (hpA <= 0) winner = "B";
  else winner = hpA === hpB ? "draw" : hpA > hpB ? "A" : "B"; // round cap -> more HP wins

  return { winner, rounds: round, log, hp: { A: hpA, B: hpB }, dealt: { A: dealtA, B: dealtB } };
}

function jitter(dmg, variance, rng) {
  if (dmg === 0) return 0;
  const factor = 1 + (rng() * 2 - 1) * variance; // +/- variance
  return Math.max(0, Math.round(dmg * factor));
}
