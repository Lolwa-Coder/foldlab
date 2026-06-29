// Shared balance logic — pure, environment-agnostic. Takes a `log(line)` sink so
// it can print to the Node console OR append to a DOM node in the browser.
// No Node-only APIs in here.

import { fight, Strategies } from "../src/engine/combat.js";
import { netMatrix } from "../src/engine/payoff.js";
import { solveZeroSum, sample } from "../src/engine/nash.js";

const HP = 40;

export const ARCHETYPES = {
  "Specialist (22/1/1)": { rock: 22, paper: 1, scissors: 1, hp: HP },
  "Duo (11/11/2)": { rock: 11, paper: 11, scissors: 2, hp: HP },
  "Skewed (14/7/3)": { rock: 14, paper: 7, scissors: 3, hp: HP },
  "Generalist (8/8/8)": { rock: 8, paper: 8, scissors: 8, hp: HP },
};

// Build a per-round sampler for a fixed matchup. Crucially, the Nash equilibrium
// is solved ONCE here (stats don't change during a fight) and the resulting mix
// is reused every round — otherwise we'd re-solve thousands of times and freeze.
function buildStrat(kind, self, foe) {
  if (kind === "greedy") return Strategies.greedy;
  if (kind === "uniform") return Strategies.uniform;
  // nash
  const { row } = solveZeroSum(netMatrix(self, foe), 8000);
  return (_s, _f, rng = Math.random) => sample(row, rng);
}

function winRate(A, B, kindA, kindB, games, fightOpts = {}) {
  const sA = buildStrat(kindA, A, B);
  const sB = buildStrat(kindB, B, A);
  let aWins = 0;
  let draws = 0;
  for (let i = 0; i < games; i++) {
    const r = fight(A, B, sA, sB, { variance: 0.1, ...fightOpts });
    if (r.winner === "A") aWins++;
    else if (r.winner === "draw") draws++;
  }
  return (aWins + draws / 2) / games;
}

// Average win rate of each archetype across all the *other* archetypes.
// `builds` lets callers supply modified stat blocks (e.g. forging-taxed ones).
async function overall(kind, fightOpts, games, tick, builds = ARCHETYPES) {
  const names = Object.keys(builds);
  const res = {};
  for (const rn of names) {
    let sum = 0;
    let count = 0;
    for (const cn of names) {
      if (rn === cn) continue;
      sum += winRate(builds[rn], builds[cn], kind, kind, games, fightOpts);
      count++;
    }
    res[rn] = sum / count;
    if (tick) await tick(); // yield so the browser stays responsive
  }
  return res;
}

// Forging-stage cost model: spreading your forge is less efficient than focusing
// it. A build's effective stats are discounted by how *diverse* it is, so the
// generalist ends the build phase with fewer real points than the specialist.
//   diversity = 1 - (biggest stat's share of the total)   // 0 = pure spec
//   factor    = 1 - tax * diversity
function taxedBuild(base, tax) {
  const stats = [base.rock, base.paper, base.scissors];
  const total = stats.reduce((a, b) => a + b, 0);
  const diversity = 1 - Math.max(...stats) / total;
  const f = 1 - tax * diversity;
  return {
    rock: Math.max(1, Math.round(base.rock * f)),
    paper: Math.max(1, Math.round(base.paper * f)),
    scissors: Math.max(1, Math.round(base.scissors * f)),
    hp: base.hp,
  };
}

// Spread = max-min overall win rate. Lower = more balanced (closer to all-50%).
function spread(rates) {
  const v = Object.values(rates);
  return Math.max(...v) - Math.min(...v);
}

const pad = (s, n) => String(s).padEnd(n);

async function table(log, kind, label, games, tick) {
  const names = Object.keys(ARCHETYPES);
  log("");
  log(`=== Win-rate matrix — ${label} ===`);
  log("(row's win% vs column)");
  log("");
  log(pad("vs", 22) + names.map((n) => pad(n.split(" ")[0], 13)).join(""));

  const totals = {};
  for (const rn of names) {
    let line = pad(rn, 22);
    let sum = 0;
    let count = 0;
    for (const cn of names) {
      if (rn === cn) {
        line += pad("—", 13);
        continue;
      }
      const wr = winRate(ARCHETYPES[rn], ARCHETYPES[cn], kind, kind, games);
      line += pad((wr * 100).toFixed(1) + "%", 13);
      sum += wr;
      count++;
    }
    totals[rn] = sum / count;
    log(line);
    if (tick) await tick();
  }

  log("");
  log("Overall win-rate across all matchups:");
  for (const n of names) {
    const wr = totals[n] * 100;
    const bar = "#".repeat(Math.round(wr / 2));
    log(`  ${pad(n, 22)} ${wr.toFixed(1).padStart(5)}%  ${bar}`);
  }
}

// Sweep the forging-stage diversity tax to find how hard generalist forging must
// be to balance the four archetypes. Combat math is UNCHANGED — only the build
// budgets shift. Format: best-of-4 throws (locked in), equilibrium play.
export async function runForgingTax(log, games = 600, tick = null) {
  log("RPS-Forge — Forging-stage balancing");
  log("Idea: make spreading your forge LESS efficient, so generalists end the");
  log("build phase with fewer real stat points. Combat math is untouched.");
  log(`Format: best-of-4 throws, equilibrium play, ${games} games/cell.`);
  log("Diversity tax t:  effective stats *= (1 - t * diversity)");
  log("");

  const taxes = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const results = [];
  log(pad("forge tax t", 16) + "balance spread (max-min win%, lower = fairer)");
  for (const t of taxes) {
    const builds = {};
    for (const [n, b] of Object.entries(ARCHETYPES)) builds[n] = taxedBuild(b, t);
    const ov = await overall("nash", { bouts: 4 }, games, tick, builds);
    results.push({ t, ov, builds });
    const s = spread(ov) * 100;
    log(pad(t.toFixed(2), 16) + `${s.toFixed(1).padStart(5)} pts  ` + "#".repeat(Math.round(s / 2)));
  }

  const best = results.reduce((a, b) => (spread(b.ov) < spread(a.ov) ? b : a));
  log("");
  log(`Most balanced at forge tax t=${best.t.toFixed(2)}  (spread ${(spread(best.ov) * 100).toFixed(1)} pts):`);
  log("");
  log("  " + pad("build", 22) + pad("effective stats", 18) + "win%");
  for (const n of Object.keys(ARCHETYPES)) {
    const b = best.builds[n];
    const eff = `${b.rock}/${b.paper}/${b.scissors}`;
    log("  " + pad(n, 22) + pad(eff, 18) + (best.ov[n] * 100).toFixed(1) + "%");
  }
  log("");
  log("Read-off: that 'effective stats' column is the target the forging economy");
  log("should produce — i.e. how much a generalist should lag a specialist in total.");
  log("");
}

export async function runBalance(log, games = 1500, tick = null) {
  log(`RPS-Forge balance sim — 24 pts, ${HP} HP, ${games} games/cell, 10% variance`);

  await table(log, "nash", "both play NASH equilibrium (attrition / fight-to-death)", games, tick);

  // The duel-length experiment: does a short best-of-N duel compress win rates
  // toward 50% (balance) compared to a long attrition fight? All equilibrium play.
  const modes = [
    ["Attrition (to death)", {}],
    ["Best-of-4 throws", { bouts: 4 }],
    ["Best-of-9 throws", { bouts: 9 }],
  ];
  const names = Object.keys(ARCHETYPES);
  const cols = [];
  for (const [, opt] of modes) cols.push(await overall("nash", opt, games, tick));

  log("");
  log("=== Duel length vs balance — overall win% under equilibrium play ===");
  log("(shorter duel = more variance = win rates should compress toward 50%)");
  log("");
  log(pad("build", 22) + modes.map(([m]) => pad(m, 22)).join(""));
  for (let i = 0; i < names.length; i++) {
    let line = pad(names[i], 22);
    for (const col of cols) line += pad((col[names[i]] * 100).toFixed(1) + "%", 22);
    log(line);
  }
  log("");
  log("Balance spread (max-min win%, lower is better):");
  modes.forEach(([m], k) => {
    const s = spread(cols[k]) * 100;
    const bar = "#".repeat(Math.round(s / 2));
    log(`  ${pad(m, 22)} ${s.toFixed(1).padStart(5)} pts  ${bar}`);
  });
  log("");
}
