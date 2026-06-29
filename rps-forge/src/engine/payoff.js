// Payoff model for the RPS-stat duel.
//
// A character is three stat pools plus HP:  { rock, paper, scissors, hp }
// Hands are indexed [0]=rock, [1]=paper, [2]=scissors.
//
// RPS rule:  hand i beats hand (i + 2) % 3   (rock>scissors, paper>rock, scissors>paper)
//            hand i loses to hand (i + 1) % 3
//
// When two hands clash we don't just decide "who wins" — the STAT VALUE of the
// throw decides how hard it lands. That is the whole point of the design: a big
// stat is a big punch, but you can only swing it by throwing that hand, which is
// readable. The math below is what makes over-specialization self-correcting.

export const HANDS = ["rock", "paper", "scissors"];

/** Does hand a beat hand b? */
export function beats(a, b) {
  return (a + 2) % 3 === b;
}

/**
 * Resolve a single simultaneous throw.
 * Returns { aDmg, bDmg } — damage each side deals this round.
 *
 *  - a beats b   -> A lands its thrown stat, B lands nothing
 *  - b beats a   -> B lands its thrown stat, A lands nothing
 *  - a === b     -> the bigger stat lands the *difference* (a real clash)
 */
export function resolveThrow(A, B, a, b) {
  const aStat = A[HANDS[a]];
  const bStat = B[HANDS[b]];

  if (a === b) {
    if (aStat > bStat) return { aDmg: aStat - bStat, bDmg: 0 };
    if (bStat > aStat) return { aDmg: 0, bDmg: bStat - aStat };
    return { aDmg: 0, bDmg: 0 };
  }
  if (beats(a, b)) return { aDmg: aStat, bDmg: 0 };
  return { aDmg: 0, bDmg: bStat };
}

/**
 * Build the 3x3 net-damage payoff matrix for the row player A.
 *   M[a][b] = (damage A deals) - (damage B deals)  when A throws a, B throws b.
 *
 * This is zero-sum by construction (it's a single signed number A wants to push
 * up and B wants to push down), so one game-solve yields BOTH players' optimal
 * mixed strategies. That equilibrium is the "fair" assumption we balance against.
 */
export function netMatrix(A, B) {
  const M = [];
  for (let a = 0; a < 3; a++) {
    M[a] = [];
    for (let b = 0; b < 3; b++) {
      const { aDmg, bDmg } = resolveThrow(A, B, a, b);
      M[a][b] = aDmg - bDmg;
    }
  }
  return M;
}
