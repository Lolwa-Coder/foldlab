// Solve a zero-sum matrix game for both players' optimal mixed strategies.
//
// We use "fictitious play": each player repeatedly best-responds to the running
// empirical distribution of the opponent's past plays. For zero-sum games this
// is guaranteed to converge to a Nash equilibrium. It's a few lines, needs no
// LP solver, and is plenty accurate for a 3x3.
//
// Why we need this: the metric is only "fair" if NO build dominates *under
// optimal play*. A greedy player who always throws their biggest stat is easy to
// punish; the real question is what happens when both sides play the equilibrium.
// This solver gives us that equilibrium so the balance sim can test it.

export function solveZeroSum(M, iters = 50000) {
  const n = M.length;
  const m = M[0].length;

  const rowCount = new Array(n).fill(0);
  const colCount = new Array(m).fill(0);

  // seed
  rowCount[0] = 1;
  colCount[0] = 1;

  for (let t = 0; t < iters; t++) {
    // Row (A) maximizes expected payoff against the column's empirical mix.
    let bestI = 0;
    let bestV = -Infinity;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < m; j++) v += colCount[j] * M[i][j];
      if (v > bestV) {
        bestV = v;
        bestI = i;
      }
    }

    // Column (B) minimizes A's expected payoff against the row's empirical mix.
    let bestJ = 0;
    let worstV = Infinity;
    for (let j = 0; j < m; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += rowCount[i] * M[i][j];
      if (v < worstV) {
        worstV = v;
        bestJ = j;
      }
    }

    rowCount[bestI]++;
    colCount[bestJ]++;
  }

  const rowSum = rowCount.reduce((a, b) => a + b, 0);
  const colSum = colCount.reduce((a, b) => a + b, 0);

  const row = rowCount.map((c) => c / rowSum);
  const col = colCount.map((c) => c / colSum);

  // Value of the game = row^T M col
  let value = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) value += row[i] * M[i][j] * col[j];

  return { row, col, value };
}

/** Sample an index from a probability vector. */
export function sample(probs, rng = Math.random) {
  let r = rng();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}
