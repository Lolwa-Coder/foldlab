// Catan-style hex board. Each hex produces a resource — and the resources ARE
// Rock / Paper / Scissors, the same three things you forge into combat stats.
//
// Geometry trick: we compute each hex's 6 corner pixels and dedupe coincident
// corners into shared "nodes". A node touching three Rock hexes is a Rock hotspot
// — settling there makes you a Rock specialist. Spreading your settlements across
// resource types is how you become a generalist, and (per the sim) the dice
// variance of needing three different numbers is the natural "diversity tax".

const SIZE = 46; // hex radius in px
const OX = 330;
const OY = 250;

// Pointy-top hex: corner k sits at angle 60k - 30 degrees.
function corner(cx, cy, k) {
  const a = (Math.PI / 180) * (60 * k - 30);
  return { x: cx + SIZE * Math.cos(a), y: cy + SIZE * Math.sin(a) };
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const RESOURCES = ["rock", "paper", "scissors"];

export function generateBoard(rng = Math.random) {
  // 7-hex flower (radius 1): |q|,|r|,|q+r| <= 1.
  const axials = [];
  for (let q = -1; q <= 1; q++)
    for (let r = -1; r <= 1; r++) if (Math.abs(q + r) <= 1) axials.push({ q, r });

  const resPool = shuffle(["rock", "rock", "rock", "paper", "paper", "scissors", "scissors"], rng);
  const numPool = shuffle([3, 4, 5, 6, 8, 9, 10], rng); // 2d6 numbers, no 7

  const nodeMap = new Map();
  const nodes = [];

  const hexes = axials.map((a, i) => {
    const cx = OX + SIZE * Math.sqrt(3) * (a.q + a.r / 2);
    const cy = OY + SIZE * 1.5 * a.r;
    const corners = [];
    for (let k = 0; k < 6; k++) {
      const p = corner(cx, cy, k);
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      let id = nodeMap.get(key);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ id, x: p.x, y: p.y, hexes: [], owner: null });
        nodeMap.set(key, id);
      }
      corners.push(id);
    }
    return { id: i, cx, cy, res: resPool[i], num: numPool[i], corners };
  });

  // Record which hexes each node touches (drives production payouts).
  hexes.forEach((h) => h.corners.forEach((nid) => nodes[nid].hexes.push(h.id)));

  return { hexes, nodes, size: SIZE };
}

// Two nodes are adjacent if they share a hex edge (used for the no-touching rule
// during settlement placement, like Catan's distance rule).
export function areAdjacent(board, a, b) {
  if (a === b) return true;
  for (const h of board.hexes) {
    const ia = h.corners.indexOf(a);
    const ib = h.corners.indexOf(b);
    if (ia !== -1 && ib !== -1) {
      const d = Math.abs(ia - ib);
      if (d === 1 || d === 5) return true; // consecutive corners of the same hex
    }
  }
  return false;
}
