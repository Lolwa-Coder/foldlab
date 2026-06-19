import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------------------------------------------------------------------
// CPK element colors and approximate van der Waals radii (Angstroms)
// ---------------------------------------------------------------------------
const ELEMENTS = {
  H:  { color: 0xffffff, radius: 1.20 },
  C:  { color: 0x909090, radius: 1.70 },
  N:  { color: 0x3050f8, radius: 1.55 },
  O:  { color: 0xff0d0d, radius: 1.52 },
  S:  { color: 0xffff30, radius: 1.80 },
  P:  { color: 0xff8000, radius: 1.80 },
  FE: { color: 0xe06633, radius: 1.40 },
};
const DEFAULT_ELEMENT = { color: 0xff1493, radius: 1.50 };
const elementInfo = sym => ELEMENTS[sym] || DEFAULT_ELEMENT;

// ---------------------------------------------------------------------------
// PDB parser — reads ATOM / HETATM records (fixed-column format)
// ---------------------------------------------------------------------------
function parsePDB(text) {
  const atoms = [];
  for (const line of text.split('\n')) {
    const rec = line.slice(0, 6).trim();
    if (rec !== 'ATOM' && rec !== 'HETATM') continue;

    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;

    let element = line.slice(76, 78).trim().toUpperCase();
    if (!element) element = line.slice(12, 16).trim().replace(/[^A-Za-z]/g, '').toUpperCase();

    atoms.push({
      element,
      name: line.slice(12, 16).trim(),
      resName: line.slice(17, 20).trim(),
      chain: line.slice(21, 22).trim(),
      resSeq: parseInt(line.slice(22, 26), 10),
      pos: new THREE.Vector3(x, y, z),
      hetatm: rec === 'HETATM',
      bf: parseFloat(line.slice(60, 66)) || 0, // B-factor / pLDDT
    });
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 5e6);
camera.position.set(0, 0, 80);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// environment map for glossy reflections (procedural, no external assets)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
rim.position.set(-1, -0.4, -1);
scene.add(rim);

// groups: molecule (cleared per load), ground (under molecule), scale overlay
const molecule = new THREE.Group();
const ground = new THREE.Group();
const scaleGroup = new THREE.Group();
scene.add(molecule, ground, scaleGroup);
scaleGroup.visible = false;

const sphereGeo = new THREE.SphereGeometry(1, 24, 16);

const highlight = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x3b82f6, wireframe: true })
);
highlight.visible = false;
scene.add(highlight);

// ---------------------------------------------------------------------------
// Materials & representations
// ---------------------------------------------------------------------------
function atomMaterial(info, element) {
  const metal = element === 'FE';
  return new THREE.MeshStandardMaterial({
    color: info.color,
    metalness: metal ? 0.9 : 0.15,
    roughness: metal ? 0.35 : 0.22,
    envMapIntensity: 1.0,
  });
}

function clearGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.geometry?.dispose?.();
    if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
    else c.material?.dispose?.();
    c.material?.map?.dispose?.();
  }
}

function buildSpacefill(atoms, scale = 1.0) {
  const byElement = new Map();
  for (const a of atoms) {
    if (!byElement.has(a.element)) byElement.set(a.element, []);
    byElement.get(a.element).push(a);
  }
  const conf = colorMode === 'confidence';
  const dummy = new THREE.Object3D();
  for (const [element, list] of byElement) {
    const info = elementInfo(element);
    // in confidence mode use a white base material so per-instance colors show through
    const mat = conf
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.3 })
      : atomMaterial(info, element);
    const mesh = new THREE.InstancedMesh(sphereGeo, mat, list.length);
    mesh.castShadow = mesh.receiveShadow = true;
    list.forEach((a, i) => {
      dummy.position.copy(a.pos);
      dummy.scale.setScalar(info.radius * scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (conf) mesh.setColorAt(i, confColor(a.bf * bScale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (conf && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.atoms = list;
    molecule.add(mesh);
  }
}

function buildBackbone(atoms) {
  const chains = new Map();
  for (const a of atoms) {
    if (a.name !== 'CA' || a.hetatm) continue;
    if (!chains.has(a.chain)) chains.set(a.chain, []);
    chains.get(a.chain).push(a);
  }
  let drew = false;
  for (const list of chains.values()) {
    if (list.length < 2) continue;
    drew = true;
    list.sort((p, q) => p.resSeq - q.resSeq);
    const curve = new THREE.CatmullRomCurve3(list.map(a => a.pos));
    const segs = Math.max(64, list.length * 6);
    const geo = new THREE.TubeGeometry(curve, segs, 0.45, 8, false);

    const conf = colorMode === 'confidence';
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    let tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.floor(i / (geo.parameters.radialSegments + 1)) / geo.parameters.tubularSegments;
      if (conf) {
        const ca = list[Math.min(list.length - 1, Math.round(t * (list.length - 1)))];
        tmp = confColor(ca.bf * bScale);
      } else {
        tmp.setHSL((1 - t) * 0.7, 0.65, 0.55); // N→C rainbow
      }
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 });
    const tube = new THREE.Mesh(geo, mat);
    tube.castShadow = tube.receiveShadow = true;
    tube.userData.caAtoms = list;
    molecule.add(tube);
  }
  return drew;
}

// ---------------------------------------------------------------------------
// Cartoon / ribbon representation
// Secondary structure is computed from backbone phi/psi (works for predicted
// structures too, which lack HELIX/SHEET records).
// ---------------------------------------------------------------------------
const SS_COLORS = { H: 0xff4d6d, E: 0xffd23f, C: 0x49c5b6 };

function dihedral(p0, p1, p2, p3) {
  const b0 = new THREE.Vector3().subVectors(p0, p1);
  const b1 = new THREE.Vector3().subVectors(p2, p1).normalize();
  const b2 = new THREE.Vector3().subVectors(p3, p2);
  const v = b0.clone().sub(b1.clone().multiplyScalar(b0.dot(b1)));
  const w = b2.clone().sub(b1.clone().multiplyScalar(b2.dot(b1)));
  const x = v.dot(w);
  const y = new THREE.Vector3().crossVectors(b1, v).dot(w);
  return Math.atan2(y, x) * 180 / Math.PI;
}

// group protein backbone atoms into ordered per-chain residue lists
function collectChains(atoms) {
  const map = new Map();
  for (const a of atoms) {
    if (a.hetatm || !AA1[a.resName]) continue;
    if (a.name !== 'N' && a.name !== 'CA' && a.name !== 'C' && a.name !== 'O') continue;
    if (!map.has(a.chain)) map.set(a.chain, new Map());
    const cm = map.get(a.chain);
    if (!cm.has(a.resSeq)) cm.set(a.resSeq, { resSeq: a.resSeq });
    const r = cm.get(a.resSeq);
    if (a.name === 'N') r.n = a.pos;
    else if (a.name === 'CA') { r.ca = a.pos; r.caAtom = a; r.plddt = a.bf; }
    else if (a.name === 'C') r.c = a.pos;
    else if (a.name === 'O') r.o = a.pos;
  }
  const chains = [];
  for (const cm of map.values()) {
    const list = [...cm.values()].filter(r => r.ca).sort((p, q) => p.resSeq - q.resSeq);
    if (list.length) chains.push(list);
  }
  return chains;
}

function enforceRun(list, type, minLen) {
  let i = 0;
  while (i < list.length) {
    if (list[i].ss === type) {
      let j = i; while (j < list.length && list[j].ss === type) j++;
      if (j - i < minLen) for (let k = i; k < j; k++) list[k].ss = 'C';
      i = j;
    } else i++;
  }
}

function assignSS(list) {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    list[i].ss = 'C';
    const r = list[i], pr = list[i - 1], nx = list[i + 1];
    if (i > 0 && i < n - 1 && r.n && r.c && pr.c && nx.n &&
        r.resSeq === pr.resSeq + 1 && nx.resSeq === r.resSeq + 1) {
      const phi = dihedral(pr.c, r.n, r.ca, r.c);
      const psi = dihedral(r.n, r.ca, r.c, nx.n);
      if (phi >= -120 && phi <= -30 && psi >= -80 && psi <= 0) list[i].ss = 'H';
      else if (phi >= -180 && phi <= -50 && psi >= 80 && psi <= 180) list[i].ss = 'E';
    }
  }
  enforceRun(list, 'H', 4);
  enforceRun(list, 'E', 3);
}

// extrude a variable-width ribbon (rectangular cross-section) along a Cα spline
function buildRibbon(res) {
  const n = res.length;
  if (n < 2) return null;
  const conf = colorMode === 'confidence';

  // per-residue flat-face direction from the carbonyl, with flip correction
  const sides = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const a = res[Math.max(0, i - 1)].ca, b = res[Math.min(n - 1, i + 1)].ca;
    const tan = new THREE.Vector3().subVectors(b, a).normalize();
    let side;
    if (res[i].o) side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3().subVectors(res[i].o, res[i].ca)).normalize();
    else { side = new THREE.Vector3(0, 1, 0).cross(tan); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize(); }
    if (prev && side.dot(prev) < 0) side.multiplyScalar(-1);
    sides.push(side); prev = side;
  }

  // per-residue cross-section size by secondary structure
  const W = res.map(r => r.ss === 'H' ? 2.2 : r.ss === 'E' ? 2.0 : 0.6);
  const T = res.map(r => r.ss === 'C' ? 0.6 : 0.45);
  // sheet arrowheads: widen then taper to a point at each strand's C-terminal end
  let i = 0;
  while (i < n) {
    if (res[i].ss === 'E') {
      let j = i; while (j < n && res[j].ss === 'E') j++;
      W[j - 1] = 0.2; if (j - 2 >= i) W[j - 2] = 3.0;
      i = j;
    } else i++;
  }
  const cols = res.map(r => conf ? confColor(r.plddt * bScale) : new THREE.Color(SS_COLORS[r.ss]));

  const curve = new THREE.CatmullRomCurve3(res.map(r => r.ca.clone()), false, 'centripetal');
  const samples = (n - 1) * 10 + 1;
  const pos = [], col = [], idx = [];
  const P = new THREE.Vector3(), tan = new THREE.Vector3();

  for (let s = 0; s < samples; s++) {
    const u = s / (samples - 1);
    const f = u * (n - 1), i0 = Math.min(n - 1, Math.floor(f)), i1 = Math.min(n - 1, i0 + 1), fr = f - i0;
    curve.getPoint(u, P);
    curve.getTangent(u, tan).normalize();
    const side = sides[i0].clone().lerp(sides[i1], fr);
    side.sub(tan.clone().multiplyScalar(side.dot(tan))).normalize(); // re-orthogonalize
    const nrm = new THREE.Vector3().crossVectors(tan, side).normalize();
    const hw = (W[i0] + (W[i1] - W[i0]) * fr) / 2;
    const ht = (T[i0] + (T[i1] - T[i0]) * fr) / 2;
    const c = cols[i0].clone().lerp(cols[i1], fr);
    const sw = side.clone().multiplyScalar(hw), nt = nrm.clone().multiplyScalar(ht);
    const corners = [
      P.clone().add(sw).add(nt), P.clone().add(sw).sub(nt),
      P.clone().sub(sw).sub(nt), P.clone().sub(sw).add(nt),
    ];
    for (const v of corners) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
    if (s > 0) {
      const r0 = (s - 1) * 4, r1 = s * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        idx.push(r0 + k, r0 + k2, r1 + k2, r0 + k, r1 + k2, r1 + k);
      }
    }
  }
  // end caps
  const last = (samples - 1) * 4;
  idx.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.caAtoms = res.map(r => r.caAtom);
  return mesh;
}

function buildCartoon(atoms) {
  let drew = false;
  for (const list of collectChains(atoms)) {
    assignSS(list);
    let seg = [list[0]];
    const flush = () => { if (seg.length >= 2) { const m = buildRibbon(seg); if (m) { molecule.add(m); drew = true; } } };
    for (let k = 1; k < list.length; k++) {
      const prev = list[k - 1], cur = list[k];
      if (cur.resSeq !== prev.resSeq + 1 || prev.ca.distanceTo(cur.ca) > 4.6) { flush(); seg = [cur]; }
      else seg.push(cur);
    }
    flush();
  }
  return drew;
}

// ground plane + grid sized to the molecule, placed just below it
function buildGround(radius) {
  clearGroup(ground);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 30, radius * 30),
    new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.85, metalness: 0.0 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -radius * 1.15;
  plane.receiveShadow = true;
  ground.add(plane);

  const grid = new THREE.GridHelper(radius * 30, 40, 0x2a3550, 0x1a2030);
  grid.position.y = -radius * 1.14;
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  ground.add(grid);
}

// frame the molecule and aim the shadow-casting light at it
function frameMolecule(radius) {
  const dist = radius / Math.sin((camera.fov / 2) * Math.PI / 180);
  camera.position.set(dist * 0.2, dist * 0.25, dist * 1.15);
  camera.near = Math.max(0.05, dist / 500);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();

  key.position.set(radius * 2, radius * 3, radius * 2);
  const s = key.shadow.camera;
  s.left = -radius * 1.5; s.right = radius * 1.5;
  s.top = radius * 1.5; s.bottom = -radius * 1.5;
  s.near = radius * 0.1; s.far = radius * 12;
  s.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Scale comparison — real biological objects, true scale (diameters in nm)
// ---------------------------------------------------------------------------
const NM = 10; // 1 nm = 10 Angstroms
const SCALE_REFS = [
  { name: 'Water molecule', d: 0.28, color: 0x60a5fa },
  { name: 'Glucose', d: 0.9, color: 0x34d399 },
  { name: 'Hemoglobin', d: 5.5, color: 0xf472b6 },
  { name: 'Antibody (IgG)', d: 10, color: 0xfbbf24 },
  { name: 'Ribosome', d: 25, color: 0xa78bfa },
  { name: 'Influenza virus', d: 100, color: 0xf87171 },
  { name: 'Mitochondrion', d: 1000, color: 0x22d3ee },
  { name: 'E. coli bacterium', d: 2000, color: 0x4ade80 },
  { name: 'Animal cell', d: 20000, color: 0x93c5fd },
];

function makeLabel(text, color = '#ffffff') {
  const pad = 8, font = 48;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  c.width = w + pad * 2; c.height = font + pad * 2;
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(10,12,18,0.78)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.textBaseline = 'top';
  ctx.fillText(text, pad, pad);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.userData.aspect = c.width / c.height;
  sprite.renderOrder = 999;
  return sprite;
}

let currentRadius = 10; // molecule bounding radius in Angstroms

function buildScale() {
  clearGroup(scaleGroup);
  const dir = new THREE.Vector3(1, 0.55, 0).normalize(); // labels fan out along this ray

  const refs = [
    ...SCALE_REFS.map(r => ({ name: r.name, r: (r.d * NM) / 2, color: r.color })),
    { name: 'THIS PROTEIN', r: currentRadius, color: 0xffffff, me: true },
  ].sort((a, b) => a.r - b.r);

  let maxR = 0;
  for (const ref of refs) {
    maxR = Math.max(maxR, ref.r);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(ref.r, 24, 16),
      new THREE.MeshBasicMaterial({
        color: ref.color, wireframe: true, transparent: true,
        opacity: ref.me ? 0.9 : 0.18,
      })
    );
    scaleGroup.add(sphere);

    const sizeTxt = ref.r * 2 >= NM * 1000
      ? `${(ref.r * 2 / (NM * 1000)).toPrecision(2)} µm`
      : ref.r * 2 >= NM ? `${(ref.r * 2 / NM).toPrecision(2)} nm`
      : `${(ref.r * 2).toPrecision(2)} Å`;
    const label = makeLabel(`${ref.name}  ·  ${sizeTxt}`,
      ref.me ? '#ffffff' : '#' + ref.color.toString(16).padStart(6, '0'));
    label.position.copy(dir).multiplyScalar(ref.r);
    const ls = ref.r * 0.42;
    label.scale.set(ls * label.userData.aspect, ls, 1);
    scaleGroup.add(label);
  }
  return maxR;
}

function frameScale(maxR) {
  const dist = maxR / Math.sin((camera.fov / 2) * Math.PI / 180);
  camera.position.set(dist * 0.35, dist * 0.45, dist * 1.05);
  camera.near = Math.max(0.05, dist / 5000);
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

// ---------------------------------------------------------------------------
// State + view orchestration
// ---------------------------------------------------------------------------
let currentAtoms = [];
let currentRep = 'spacefill';
let scaleMode = false;
let colorMode = 'element';   // 'element' | 'confidence'
let isPrediction = false;    // true when the structure came from ESMFold
let bScale = 1;              // multiply atom.bf to get pLDDT on a 0–100 scale

// pLDDT confidence palette (AlphaFold/ESMFold convention), input 0–100
function confColor(v) {
  if (v >= 90) return new THREE.Color(0x0053d6); // very high
  if (v >= 70) return new THREE.Color(0x65cbf3); // confident
  if (v >= 50) return new THREE.Color(0xffdb13); // low
  return new THREE.Color(0xff7d45);              // very low
}
const CONF_LEGEND =
  `<div class="legend">` +
  `<span><i style="background:#0053d6"></i>Very high (90+)</span>` +
  `<span><i style="background:#65cbf3"></i>Confident (70–90)</span>` +
  `<span><i style="background:#ffdb13"></i>Low (50–70)</span>` +
  `<span><i style="background:#ff7d45"></i>Very low (&lt;50)</span></div>`;

const statusEl = document.getElementById('status');
const setStatus = (msg, err = false) => { statusEl.textContent = msg; statusEl.className = err ? 'error' : ''; };

function renderMolecule() {
  clearGroup(molecule);
  if (!currentAtoms.length) return;
  if (currentRep === 'spacefill') buildSpacefill(currentAtoms);
  else if (currentRep === 'cartoon') {
    if (!buildCartoon(currentAtoms)) {
      setStatus('No protein backbone for cartoon — showing spacefill.', true);
      buildSpacefill(currentAtoms);
    }
  } else if (!buildBackbone(currentAtoms)) {
    setStatus('No Cα backbone — showing spacefill.', true);
    buildSpacefill(currentAtoms);
  }
}

function applyView() {
  renderMolecule();
  ground.visible = !scaleMode;
  scaleGroup.visible = scaleMode;
  highlight.visible = false;
  document.getElementById('tip').style.display = 'none';
  if (scaleMode) {
    frameScale(buildScale());
  } else {
    buildGround(currentRadius);
    frameMolecule(currentRadius);
  }
}

// ---------------------------------------------------------------------------
// Structure metadata (RCSB data API) + similar proteins (RCSB search API)
// ---------------------------------------------------------------------------
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const aboutEl = document.getElementById('tab-about');
const similarEl = document.getElementById('tab-similar');
const costEl = document.getElementById('tab-cost');

const POLYMER_TO_SEQTYPE = { Protein: 'protein', DNA: 'dna', RNA: 'rna' };

// Explainer shown at the top of the Similar tab.
const SIMILAR_HELP =
  `<div class="simhelp">` +
  `We take this structure's chain <b>sequence</b> and search the entire PDB for others ` +
  `whose sequence aligns to it (RCSB's MMseqs2 service), keeping hits with ≥30% identity. ` +
  `<b>% identity</b> = fraction of aligned residues that match: 100% is the same protein ` +
  `(another crystal form, a mutant, or a different bound ligand); ~30–60% is usually a ` +
  `homolog — the same protein from another species or a relative. Click any hit to load it.` +
  `<details><summary>More detail</summary>` +
  `This compares <i>sequence</i>, not 3D shape, so it won't find unrelated sequences that ` +
  `happen to fold alike. Hits are filtered at e-value ≤ 1, de-duplicated per PDB ID, and ` +
  `ranked by identity. Works on protein / nucleic-acid chains only.</details>` +
  `</div>`;

// Rough commercial pricing (USD, research scale, ~2026), calibrated to a US baseline.
// Split into commodities (globally priced, import-sensitive) and labor (region-sensitive).
const COST = {
  // commodities — ordered from global vendors, scaled by a region's import factor
  bpSynthesis: 0.12,    // gene synthesis, $/bp (codon-optimized)
  cloningOverhead: 90,  // extra bp for cloning sites / affinity tag
  cloning: 200,         // vector + restriction/ligation reagents
  consumables: 700,     // media, resin, columns, IPTG, etc. for one prep
  oligoPerBase: 0.30,   // DNA/RNA oligo synthesis, $/base
  oligoMin: 50,
  // labor — one expression + purification prep (~1 week), scaled by region & setup
  laborBase: 1800,
  // chemical peptide synthesis (a bought service; blend of labor + reagent)
  spppPerResidue: 10,   // $/residue (mid purity, few mg)
  spppMaxLen: 60,       // residues beyond which SPPS becomes impractical
  spppMin: 150,         // minimum peptide order
};

// region: labor = wage multiplier; import = reagent/commodity markup (or discount)
const REGIONS = {
  us: { name: 'United States',       labor: 1.00, import: 1.00 },
  eu: { name: 'Western Europe',      labor: 0.95, import: 1.05 },
  hi: { name: 'Switzerland / Japan', labor: 1.30, import: 1.10 },
  ee: { name: 'Eastern Europe',      labor: 0.45, import: 1.10 },
  cn: { name: 'China',               labor: 0.25, import: 0.70 },
  in: { name: 'India',               labor: 0.20, import: 1.20 },
};
// setup: how the work is resourced — changes labor weight, capital, and margin
const SETUPS = {
  diy:     { name: 'Academic DIY (existing lab)', laborFactor: 0.5, equipment: 0,    margin: 1.0 },
  inhouse: { name: 'In-house startup',            laborFactor: 1.0, equipment: 1200, margin: 1.0 },
  cro:     { name: 'Outsourced to CRO',           laborFactor: 1.4, equipment: 0,    margin: 1.5 },
};
let costRegion = 'us', costSetup = 'diy';
let lastCostEntities = [], lastCofactorCount = 0; // remembered so selectors can recompute

const fmt$ = n => '$' + Math.round(n).toLocaleString('en-US');

// regional/setup blend used for the bought peptide-synthesis service
const pepRegionFactor = r => r.labor * 0.4 + r.import * 0.6;

// recombinant cost of one protein chain, broken into commodity / labor / margin
function recombCost(L, r, s) {
  const bp = L * 3 + COST.cloningOverhead;
  const gene = bp * COST.bpSynthesis * r.import;
  const reagents = (COST.cloning + COST.consumables) * r.import;
  const labor = COST.laborBase * r.labor * s.laborFactor;
  const equip = s.equipment;
  const subtotal = gene + reagents + labor + equip;
  const total = subtotal * s.margin;
  return { bp, gene, production: reagents + labor + equip, marginAdd: subtotal * (s.margin - 1), total };
}

function buildCostTab(entities, cofactorCount) {
  lastCostEntities = entities; lastCofactorCount = cofactorCount;
  if (!entities.length) { costEl.innerHTML = '<div class="loading">No polymer chains to cost.</div>'; return; }

  const r = REGIONS[costRegion], s = SETUPS[costSetup];
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) =>
    `<option value="${k}"${k === cur ? ' selected' : ''}>${v.name}</option>`).join('');
  const controls =
    `<div class="costctl"><label>Region</label><select id="costRegion">${opt(REGIONS, costRegion)}</select></div>` +
    `<div class="costctl"><label>Setup</label><select id="costSetup">${opt(SETUPS, costSetup)}</select></div>`;

  let recombTotal = 0, pepTotal = 0, pepFeasible = true, hasProtein = false;
  const lines = [];

  for (const e of entities) {
    const L = e.length, copies = e.copies > 1 ? ` ×${e.copies} chains` : '';
    if (e.type === 'Protein') {
      hasProtein = true;
      const c = recombCost(L, r, s);
      recombTotal += c.total;

      if (L <= COST.spppMaxLen) { pepTotal += Math.max(COST.spppMin, L * COST.spppPerResidue) * pepRegionFactor(r); }
      else { pepFeasible = false; }

      let sub = `<div class="line sub"><span>gene synthesis (${c.bp} bp)</span><span>${fmt$(c.gene)}</span></div>` +
        `<div class="line sub"><span>cloning, consumables, labor${s.equipment ? ', equipment' : ''}</span><span>${fmt$(c.production)}</span></div>`;
      if (c.marginAdd > 0) sub += `<div class="line sub"><span>CRO margin (×${s.margin})</span><span>${fmt$(c.marginAdd)}</span></div>`;
      lines.push(`<div class="line"><span>${esc(e.name)} — ${L} aa${copies}</span><span>${fmt$(c.total)}</span></div>` + sub);
    } else {
      const strands = e.type === 'DNA' ? 2 : 1;
      const na = (L <= 120 ? Math.max(COST.oligoMin, L * COST.oligoPerBase * strands)
                           : L * COST.bpSynthesis + COST.cloning) * r.import;
      recombTotal += na; pepTotal += na;
      lines.push(`<div class="line"><span>${esc(e.name)} — ${L} nt${copies} (${esc(e.type)})</span><span>${fmt$(na)}</span></div>` +
        `<div class="line sub"><span>oligonucleotide synthesis${strands > 1 ? ', both strands' : ''}</span><span>${fmt$(na)}</span></div>`);
    }
  }

  const bestIsPep = pepFeasible && hasProtein && pepTotal < recombTotal;
  const bestRoute = bestIsPep ? 'Chemical synthesis' : 'Recombinant expression';
  const bestTotal = bestIsPep ? pepTotal : recombTotal;

  let html = controls +
    `<div class="best"><div class="total"><span class="big">~${fmt$(bestTotal)}</span></div>` +
    `<div class="route">${bestRoute} · ${esc(r.name)} · ${esc(s.name)}</div></div>`;
  html += '<div style="font-size:11px;opacity:.6;margin-bottom:6px">Breakdown (per unique chain)</div>' + lines.join('');

  html += '<div style="margin-top:10px">';
  if (hasProtein) {
    html += pepFeasible
      ? `<div class="line"><span>Alt — chemical peptide synthesis</span><span>${fmt$(pepTotal)}</span></div>`
      : `<div class="line"><span class="warn">Chemical synthesis not feasible</span><span>chain &gt; ${COST.spppMaxLen} aa</span></div>`;
    html += `<div class="line"><span>Alt — recombinant expression</span><span>${fmt$(recombTotal)}</span></div>`;
  }
  html += '</div>';

  if (cofactorCount > 0) {
    html += `<div class="line warn" style="margin-top:8px">⚠ ${cofactorCount} cofactor/ligand group(s) — ` +
      `metals, heme or other prosthetic groups must be added and may need special folding.</div>`;
  }

  html += `<div class="caveat">Ballpark only. <b>Region</b> scales wages and adds reagent import markup; ` +
    `<b>setup</b> changes labor weight, capital (existing vs amortized equipment) and CRO margin. ` +
    `Commodities like gene synthesis stay roughly flat worldwide. Cost is per <i>unique</i> chain. ` +
    `Excludes discovery/design/structure determination, assay development, PTMs, and the reality that ` +
    `yields vary and many proteins resist folding or expression.</div>`;

  costEl.innerHTML = html;

  costEl.querySelector('#costRegion').addEventListener('change', e => { costRegion = e.target.value; buildCostTab(lastCostEntities, lastCofactorCount); });
  costEl.querySelector('#costSetup').addEventListener('change', e => { costSetup = e.target.value; buildCostTab(lastCostEntities, lastCofactorCount); });
}

async function fetchMeta(id) {
  aboutEl.innerHTML = '<div class="loading">Loading structure info…</div>';
  similarEl.innerHTML = '<div class="loading">Searching for similar structures…</div>';
  costEl.innerHTML = '<div class="loading">Estimating…</div>';
  try {
    const entry = await (await fetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`)).json();
    const info = entry.rcsb_entry_info || {};
    const cite = entry.rcsb_primary_citation;
    const entityIds = entry.rcsb_entry_container_identifiers?.polymer_entity_ids || [];
    const entities = await Promise.all(entityIds.map(eid =>
      fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${id}/${eid}`).then(r => r.json()).catch(() => null)
    ));

    // ---- About tab ----
    let html = `<h2>${esc(entry.struct?.title || '(untitled)')}</h2><div class="pid">PDB ${esc(id)}</div><div class="meta">`;
    const method = entry.exptl?.[0]?.method, res = info.resolution_combined?.[0];
    const released = entry.rcsb_accession_info?.initial_release_date?.slice(0, 10);
    if (method)   html += `<span>Method</span><span>${esc(method)}</span>`;
    if (res)      html += `<span>Resolution</span><span>${res} Å</span>`;
    if (info.molecular_weight) html += `<span>Mass</span><span>${Math.round(info.molecular_weight)} kDa</span>`;
    if (released) html += `<span>Released</span><span>${esc(released)}</span>`;
    html += '</div>';
    for (const pe of entities.filter(Boolean)) {
      const nm = pe.rcsb_polymer_entity?.pdbx_description || 'polymer';
      const type = pe.entity_poly?.rcsb_entity_polymer_type;
      const org = pe.rcsb_entity_source_organism?.[0]?.scientific_name;
      html += `<div class="entity"><div class="nm">${esc(nm)}` +
              (type ? ` <span style="opacity:.6;font-weight:400">(${esc(type)})</span>` : '') + `</div>`;
      if (org) html += `<div class="org">${esc(org)}</div>`;
      html += '</div>';
    }
    if (cite?.title) {
      const yr = cite.year ? ` (${cite.year})` : '';
      const jr = cite.rcsb_journal_abbrev ? `<i>${esc(cite.rcsb_journal_abbrev)}</i>${yr}` : '';
      const doi = cite.pdbx_database_id_DOI;
      html += `<div class="cite">${esc(cite.title)}<br>${jr}` +
              (doi ? ` · <a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener">DOI</a>` : '') + `</div>`;
    }
    html += `<div class="cite"><a href="https://www.rcsb.org/structure/${esc(id)}" target="_blank" rel="noopener">View on RCSB PDB →</a></div>`;
    aboutEl.innerHTML = html;

    // ---- Lab cost tab ----
    const costEntities = entities.filter(Boolean).map(pe => ({
      name: pe.rcsb_polymer_entity?.pdbx_description || 'polymer',
      type: pe.entity_poly?.rcsb_entity_polymer_type,
      length: pe.entity_poly?.rcsb_sample_sequence_length ||
              (pe.entity_poly?.pdbx_seq_one_letter_code_can || '').replace(/\s/g, '').length,
      copies: pe.rcsb_polymer_entity_container_identifiers?.asym_ids?.length || 1,
    })).filter(e => e.length > 0);
    buildCostTab(costEntities, info.nonpolymer_entity_count || 0);

    // ---- Similar tab (sequence similarity of first entity) ----
    const first = entities.find(Boolean);
    const seq = first?.entity_poly?.pdbx_seq_one_letter_code_can;
    const seqType = POLYMER_TO_SEQTYPE[first?.entity_poly?.rcsb_entity_polymer_type];
    if (seq && seqType) fetchSimilar(id, seq.replace(/\s/g, ''), seqType);
    else similarEl.innerHTML = '<div class="loading">Sequence-similarity search needs a protein/nucleic-acid chain.</div>';
  } catch {
    aboutEl.innerHTML = `<div class="loading">No metadata available for ${esc(id)}.</div>`;
    similarEl.innerHTML = '<div class="loading">—</div>';
  }
}

async function fetchSimilar(id, sequence, seqType) {
  const query = {
    query: { type: 'terminal', service: 'sequence',
      parameters: { evalue_cutoff: 1, identity_cutoff: 0.3, sequence_type: seqType, value: sequence } },
    return_type: 'polymer_entity',
    request_options: { paginate: { start: 0, rows: 40 }, results_content_type: ['experimental'], results_verbosity: 'verbose' },
  };
  try {
    const r = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
    });
    // 204 = the search ran fine but found nothing (common for designed/novel sequences)
    if (r.status === 204) { similarEl.innerHTML = SIMILAR_HELP + '<div class="loading">No structures in the PDB share ≥30% sequence identity — this looks novel.</div>'; return; }
    if (!r.ok) throw new Error();
    const data = await r.json();
    const best = new Map(); // pdbId -> identity %
    for (const item of data.result_set || []) {
      const pdb = item.identifier.split(/[_.]/)[0].toUpperCase();
      if (pdb === id.toUpperCase()) continue;
      const ident = item.services?.[0]?.nodes?.[0]?.match_context?.[0]?.sequence_identity;
      const pct = ident != null ? Math.round(ident * 100) : null;
      if (!best.has(pdb) || pct > best.get(pdb)) best.set(pdb, pct);
    }
    const rows = [...best.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 15);
    if (!rows.length) { similarEl.innerHTML = SIMILAR_HELP + '<div class="loading">No similar structures found.</div>'; return; }
    similarEl.innerHTML = SIMILAR_HELP +
      `<div style="opacity:.6;font-size:11px;margin-bottom:8px">${rows.length} structures with similar sequence — click to load:</div>` +
      rows.map(([pdb, pct]) =>
        `<button class="simrow" data-id="${pdb}"><span>${pdb}</span>` +
        `<span class="pct">${pct != null ? pct + '% identity' : ''}</span></button>`).join('');
    similarEl.querySelectorAll('.simrow').forEach(b =>
      b.addEventListener('click', () => { document.getElementById('pdbId').value = b.dataset.id; loadPDB(b.dataset.id); }));
  } catch {
    similarEl.innerHTML = '<div class="loading">Similarity search unavailable.</div>';
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Mutation analysis support
// ---------------------------------------------------------------------------
const AA1 = { ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',ILE:'I',
  LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V' };
const AA20 = 'ACDEFGHIKLMNPQRSTVWY';

let wtSeq = '';       // reference (wild-type) sequence
let wtAtoms = [];     // reference predicted atoms
let wtMeanPlddt = 0;

// one-letter sequence of the first protein chain in a parsed structure
function extractSequence(atoms) {
  const chain = atoms.find(a => a.name === 'CA' && !a.hetatm && AA1[a.resName])?.chain;
  if (chain == null) return '';
  return atoms
    .filter(a => a.name === 'CA' && a.chain === chain && AA1[a.resName])
    .sort((p, q) => p.resSeq - q.resSeq)
    .map(a => AA1[a.resName]).join('');
}

// Cα RMSD after optimal superposition (Theobald QCP — no SVD needed)
function caRMSD(A, B) {
  const n = Math.min(A.length, B.length);
  if (n < 3) return 0;
  let ax=0,ay=0,az=0,bx=0,by=0,bz=0;
  for (let i=0;i<n;i++){ ax+=A[i].pos.x; ay+=A[i].pos.y; az+=A[i].pos.z; bx+=B[i].pos.x; by+=B[i].pos.y; bz+=B[i].pos.z; }
  ax/=n; ay/=n; az/=n; bx/=n; by/=n; bz/=n;
  let Sxx=0,Sxy=0,Sxz=0,Syx=0,Syy=0,Syz=0,Szx=0,Szy=0,Szz=0,G1=0,G2=0;
  for (let i=0;i<n;i++){
    const x1=A[i].pos.x-ax, y1=A[i].pos.y-ay, z1=A[i].pos.z-az;
    const x2=B[i].pos.x-bx, y2=B[i].pos.y-by, z2=B[i].pos.z-bz;
    G1+=x1*x1+y1*y1+z1*z1; G2+=x2*x2+y2*y2+z2*z2;
    Sxx+=x1*x2; Sxy+=x1*y2; Sxz+=x1*z2;
    Syx+=y1*x2; Syy+=y1*y2; Syz+=y1*z2;
    Szx+=z1*x2; Szy+=z1*y2; Szz+=z1*z2;
  }
  const E0 = (G1 + G2) / 2;
  const Sxx2=Sxx*Sxx,Syy2=Syy*Syy,Szz2=Szz*Szz,Sxy2=Sxy*Sxy,Syz2=Syz*Syz,Sxz2=Sxz*Sxz,Syx2=Syx*Syx,Szy2=Szy*Szy,Szx2=Szx*Szx;
  const C2 = -2*(Sxx2+Syy2+Szz2+Sxy2+Syx2+Sxz2+Szx2+Syz2+Szy2);
  const C1 = 8*(Sxx*Syz*Szy + Syy*Szx*Sxz + Szz*Sxy*Syx - Sxx*Syy*Szz - Syz*Szx*Sxy - Szy*Syx*Sxz);
  const SyzSzymSyySzz2 = 2*(Syz*Szy - Syy*Szz);
  const Sxx2Syy2Szz2Syz2Szy2 = Syy2 + Szz2 - Sxx2 + Syz2 + Szy2;
  const SxzpSzx=Sxz+Szx, SyzpSzy=Syz+Szy, SxypSyx=Sxy+Syx;
  const SyzmSzy=Syz-Szy, SxzmSzx=Sxz-Szx, SxymSyx=Sxy-Syx;
  const SxxpSyy=Sxx+Syy, SxxmSyy=Sxx-Syy;
  const Sxy2Sxz2Syx2Szx2 = Sxy2 + Sxz2 - Syx2 - Szx2;
  const C0 = Sxy2Sxz2Syx2Szx2*Sxy2Sxz2Syx2Szx2
    + (Sxx2Syy2Szz2Syz2Szy2 + SyzSzymSyySzz2)*(Sxx2Syy2Szz2Syz2Szy2 - SyzSzymSyySzz2)
    + (-(SxzpSzx)*(SyzmSzy) + (SxymSyx)*(SxxmSyy-Szz))*(-(SxzmSzx)*(SyzpSzy) + (SxymSyx)*(SxxmSyy+Szz))
    + (-(SxzpSzx)*(SyzpSzy) - (SxypSyx)*(SxxpSyy-Szz))*(-(SxzmSzx)*(SyzmSzy) - (SxypSyx)*(SxxpSyy+Szz))
    + ((SxypSyx)*(SyzpSzy) + (SxzpSzx)*(SxxmSyy+Szz))*(-(SxymSyx)*(SyzmSzy) + (SxzpSzx)*(SxxpSyy+Szz))
    + ((SxypSyx)*(SyzmSzy) + (SxzmSzx)*(SxxmSyy-Szz))*(-(SxymSyx)*(SyzpSzy) + (SxzmSzx)*(SxxpSyy-Szz));
  let l = E0;
  for (let i=0;i<50;i++){
    const l2=l*l, b=(l2+C2)*l, a=b+C1;
    const d=(a*l+C0)/(2*l2*l + b + a);
    l -= d;
    if (Math.abs(d) < 1e-11*Math.abs(l)) break;
  }
  return Math.sqrt(Math.max(0, 2*(E0 - l)/n));
}

// center the molecule, compute its radius, detect pLDDT scale, and render
function mountAtoms(atoms) {
  currentAtoms = atoms;
  const box = new THREE.Box3();
  for (const a of atoms) box.expandByPoint(a.pos);
  molecule.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1);
  currentRadius = box.getSize(new THREE.Vector3()).length() / 2 || 10;

  // ESMFold stores pLDDT on a 0–1 scale; experimental B-factors are larger
  let bMax = 0;
  for (const a of atoms) if (a.bf > bMax) bMax = a.bf;
  bScale = bMax > 0 && bMax <= 1.5 ? 100 : 1;

  applyView();
}

async function loadPDB(id) {
  id = id.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(id)) { setStatus('Enter a valid 4-character PDB ID.', true); return; }
  isPrediction = false;
  setStatus(`Loading ${id}…`);
  fetchMeta(id);
  try {
    const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
    if (!res.ok) throw new Error(`PDB ${id} not found (HTTP ${res.status})`);
    const atoms = parsePDB(await res.text());
    if (!atoms.length) throw new Error('No atom records parsed.');
    mountAtoms(atoms);
    renderMutateTab();
    const chains = new Set(atoms.map(a => a.chain)).size;
    setStatus(`${id}: ${atoms.length} atoms · ${chains} chain(s) · ⌀ ${(currentRadius * 2).toFixed(0)} Å`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

// raw ESMFold call: sequence -> parsed atoms (throws on failure)
async function foldSequence(seq) {
  const r = await fetch('https://api.esmatlas.com/foldSequence/v1/pdb/', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: seq,
  });
  if (!r.ok) throw new Error(`ESMFold error (HTTP ${r.status}). Try a shorter sequence.`);
  const atoms = parsePDB(await r.text());
  if (!atoms.length) throw new Error('ESMFold returned no coordinates.');
  return atoms;
}
const meanOfCA = atoms => {
  const ca = atoms.filter(a => a.name === 'CA');
  return ca.reduce((s, a) => s + a.bf * bScale, 0) / (ca.length || 1);
};

// Fold an arbitrary sequence with ESMFold and render the predicted structure.
async function loadSequence(raw) {
  const seq = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (seq.length < 8) { setStatus('Enter a sequence of at least 8 amino acids.', true); return; }
  if (seq.length > 400) { setStatus('ESMFold public API is limited to ~400 residues.', true); return; }
  isPrediction = true;
  setStatus(`Folding ${seq.length} residues with ESMFold… (can take 10–30 s)`);
  tip.style.display = 'none'; highlight.visible = false;
  aboutEl.innerHTML = '<div class="loading">Folding with ESMFold…</div>';
  similarEl.innerHTML = '<div class="loading">Will search for natural relatives after folding…</div>';
  costEl.innerHTML = '<div class="loading">Estimating…</div>';
  try {
    const atoms = await foldSequence(seq);
    mountAtoms(atoms);

    // this prediction becomes the wild-type reference for mutation analysis
    wtSeq = seq; wtAtoms = atoms; wtMeanPlddt = meanOfCA(atoms);
    buildPredictionAbout(seq, wtMeanPlddt);
    buildCostTab([{ name: 'Input sequence', type: 'Protein', length: seq.length, copies: 1 }], 0);
    fetchSimilar('', seq, 'protein'); // find closest natural relatives in the PDB
    renderMutateTab();

    document.getElementById('pdbId').value = '';
    setStatus(`Predicted ${seq.length} aa · mean pLDDT ${wtMeanPlddt.toFixed(0)} · ⌀ ${(currentRadius * 2).toFixed(0)} Å`);
  } catch (err) {
    setStatus(err.message, true);
    aboutEl.innerHTML = `<div class="loading">${esc(err.message)}</div>`;
  }
}

function buildPredictionAbout(seq, mean) {
  aboutEl.innerHTML =
    `<span class="predbadge">PREDICTED · ESMFold</span>` +
    `<h2>Structure predicted from sequence</h2>` +
    `<div class="meta"><span>Length</span><span>${seq.length} residues</span>` +
    `<span>Mean pLDDT</span><span>${mean.toFixed(0)} / 100</span></div>` +
    `<div style="font-size:11.5px;opacity:.8;margin:6px 0">Per-residue confidence (pLDDT):</div>` + CONF_LEGEND +
    `<div class="caveat">This is a <i>model</i> predicted from the amino-acid sequence alone — not an ` +
    `experimental measurement. Set colouring to “confidence” to see reliability on the 3D model: blue ` +
    `regions are trustworthy, orange (often loops or flexible tails) are not. A low mean pLDDT can mean ` +
    `the protein is intrinsically disordered or simply hard to predict. The <b>Similar</b> tab searches ` +
    `the PDB for the closest natural relatives of this exact sequence.</div>`;
}

// ---------------------------------------------------------------------------
// Mutation analysis tab
// ---------------------------------------------------------------------------
const mutateEl = document.getElementById('tab-mutate');

function renderMutateTab() {
  // Works on predicted structures so WT and mutant are compared by the same method.
  if (isPrediction && wtSeq) {
    const aaOpts = AA20.split('').map(a => `<option>${a}</option>`).join('');
    mutateEl.innerHTML =
      `<div class="simhelp">Change one residue and re-fold the mutant with ESMFold, then compare to the ` +
      `current prediction. Reference: <b>${wtSeq.length} aa</b>, mean pLDDT <b>${wtMeanPlddt.toFixed(0)}</b>.</div>` +
      `<div class="costctl"><label>Position</label><input id="mutPos" type="number" min="1" max="${wtSeq.length}" value="1"></div>` +
      `<div class="costctl"><label>Wild-type</label><span class="wtres" id="mutWT">${wtSeq[0]}</span>` +
      `<span style="opacity:.6">→</span><select id="mutAA">${aaOpts}</select></div>` +
      `<button id="mutBtn" class="mutbtn">⚛ Mutate & re-fold</button>` +
      `<div id="mutResult"></div>`;
    const posEl = mutateEl.querySelector('#mutPos');
    const wtEl = mutateEl.querySelector('#mutWT');
    const clampPos = () => Math.max(1, Math.min(wtSeq.length, parseInt(posEl.value, 10) || 1));
    posEl.addEventListener('input', () => { wtEl.textContent = wtSeq[clampPos() - 1] || '?'; });
    mutateEl.querySelector('#mutBtn').addEventListener('click', () =>
      mutateAndRefold(clampPos(), mutateEl.querySelector('#mutAA').value));
  } else {
    const seq = currentAtoms.length ? extractSequence(currentAtoms) : '';
    if (seq.length >= 8) {
      mutateEl.innerHTML =
        `<div class="simhelp">Mutation analysis runs on <i>predicted</i> structures, so wild-type and mutant ` +
        `are folded by the same method. This is an experimental structure — fold its sequence first.</div>` +
        `<button id="mutFold" class="mutbtn">⚛ Fold this sequence (${seq.length} aa) to enable</button>`;
      mutateEl.querySelector('#mutFold').addEventListener('click', () => {
        document.getElementById('seqInput').value = seq;
        loadSequence(seq);
      });
    } else {
      mutateEl.innerHTML = '<div class="loading">Fold a protein sequence (left panel) to enable mutation analysis.</div>';
    }
  }
}

async function mutateAndRefold(pos, newAA) {
  if (!wtSeq) return;
  const wtRes = wtSeq[pos - 1];
  const resultEl = () => mutateEl.querySelector('#mutResult');
  const label = `${wtRes}${pos}${newAA}`;
  if (newAA === wtRes) {
    if (resultEl()) resultEl().innerHTML = `<div class="line warn" style="margin-top:10px">Position ${pos} is already ${wtRes} — pick a different residue.</div>`;
    return;
  }
  const mutSeq = wtSeq.slice(0, pos - 1) + newAA + wtSeq.slice(pos);
  setStatus(`Folding mutant ${label}… (10–30 s)`);
  if (resultEl()) resultEl().innerHTML = `<div class="loading" style="margin-top:10px">Folding mutant ${label}…</div>`;
  try {
    const mutAtoms = await foldSequence(mutSeq);

    // metrics vs the wild-type reference (both ESMFold predictions, same length)
    const wtCA = wtAtoms.filter(a => a.name === 'CA');
    const mutCA = mutAtoms.filter(a => a.name === 'CA');
    const rmsd = caRMSD(wtCA, mutCA);
    const mutMean = meanOfCA(mutAtoms);
    const dMean = mutMean - wtMeanPlddt;
    const wtLocal = (wtCA[pos - 1]?.bf || 0) * bScale;
    const mutLocal = (mutCA[pos - 1]?.bf || 0) * bScale;
    const dLocal = mutLocal - wtLocal;

    // render the mutant and highlight the mutated residue
    isPrediction = true;
    mountAtoms(mutAtoms);
    buildPredictionAbout(mutSeq, mutMean);
    buildCostTab([{ name: `Mutant ${label}`, type: 'Protein', length: mutSeq.length, copies: 1 }], 0);
    fetchSimilar('', mutSeq, 'protein');
    const site = mutAtoms.find(a => a.name === 'CA' && a.resSeq === pos);
    if (site) {
      highlight.position.copy(molecule.localToWorld(site.pos.clone()));
      highlight.scale.setScalar(2.4);
      highlight.visible = true;
    }

    const [color, verdict, detail] =
      (rmsd < 1.0 && dMean > -3 && dLocal > -6) ? ['#34d399', 'Likely tolerated', 'minimal predicted change in fold and confidence'] :
      (rmsd > 3 || dMean < -8 || dLocal < -18) ? ['#f87171', 'Likely disruptive', 'large predicted structural / confidence change'] :
      ['#fbbf24', 'Possibly destabilising', 'moderate predicted change'];
    const arrow = d => `<span class="${d >= 0 ? 'delta-up' : 'delta-down'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span>`;

    resultEl().innerHTML =
      `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:12px;padding-top:10px">` +
      `<div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:6px">Mutation ${label}</div>` +
      `<span class="verdict" style="background:${color}22;color:${color};border:1px solid ${color}">${verdict}</span>` +
      `<div style="opacity:.7;font-size:11px;margin-bottom:8px">${detail}</div>` +
      `<div class="line"><span>Mean pLDDT</span><span>${wtMeanPlddt.toFixed(0)} → ${mutMean.toFixed(0)} (${arrow(dMean)})</span></div>` +
      `<div class="line"><span>Confidence at site ${pos}</span><span>${wtLocal.toFixed(0)} → ${mutLocal.toFixed(0)} (${arrow(dLocal)})</span></div>` +
      `<div class="line"><span>Cα RMSD to wild-type</span><span>${rmsd.toFixed(2)} Å</span></div>` +
      `<div class="caveat">ESMFold is not trained to predict ΔΔG (stability) — this is a coarse structural ` +
      `proxy: how much the predicted fold and per-residue confidence shift. A large RMSD or confidence drop ` +
      `suggests the mutation disrupts the model's structure, but confirming a real stability or function ` +
      `effect needs experiment or a dedicated predictor. The blue marker shows the mutated residue.</div></div>`;
    setStatus(`Mutant ${label}: ΔpLDDT ${dMean >= 0 ? '+' : ''}${dMean.toFixed(1)} · Cα RMSD ${rmsd.toFixed(2)} Å`);
  } catch (err) {
    setStatus(err.message, true);
    if (resultEl()) resultEl().innerHTML = `<div class="line warn" style="margin-top:10px">${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Click-to-identify
// ---------------------------------------------------------------------------
const RESIDUES = {
  ALA: 'Alanine', ARG: 'Arginine', ASN: 'Asparagine', ASP: 'Aspartate', CYS: 'Cysteine',
  GLN: 'Glutamine', GLU: 'Glutamate', GLY: 'Glycine', HIS: 'Histidine', ILE: 'Isoleucine',
  LEU: 'Leucine', LYS: 'Lysine', MET: 'Methionine', PHE: 'Phenylalanine', PRO: 'Proline',
  SER: 'Serine', THR: 'Threonine', TRP: 'Tryptophan', TYR: 'Tyrosine', VAL: 'Valine',
  HOH: 'Water', HEM: 'Heme group', DA: 'Adenine', DT: 'Thymine', DG: 'Guanine', DC: 'Cytosine',
  A: 'Adenine', U: 'Uracil', G: 'Guanine', C: 'Cytosine',
};
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = document.getElementById('tip');
let downXY = null;

renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (scaleMode) return;
  if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(molecule.children, false);
  if (!hits.length) { tip.style.display = 'none'; highlight.visible = false; return; }

  const hit = hits[0];
  let atom = null;
  if (hit.object.userData.atoms && hit.instanceId != null) {
    atom = hit.object.userData.atoms[hit.instanceId];
  } else if (hit.object.userData.caAtoms) {
    const local = molecule.worldToLocal(hit.point.clone());
    let best = Infinity;
    for (const a of hit.object.userData.caAtoms) {
      const d = a.pos.distanceToSquared(local);
      if (d < best) { best = d; atom = a; }
    }
  }
  if (!atom) return;
  highlight.position.copy(molecule.localToWorld(atom.pos.clone()));
  highlight.scale.setScalar(elementInfo(atom.element).radius * 1.25);
  highlight.visible = true;
  tip.innerHTML =
    `<b>${atom.resName} ${atom.resSeq}</b> · ${RESIDUES[atom.resName] || atom.resName || '—'}<br>` +
    `chain <b>${atom.chain || '?'}</b> · atom <b>${atom.name}</b> (${atom.element})` +
    (isPrediction ? `<br>pLDDT <b>${(atom.bf * bScale).toFixed(0)}</b> / 100` : '');
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = (e.clientY + 14) + 'px';
});

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
document.getElementById('load').addEventListener('click', () => loadPDB(document.getElementById('pdbId').value));
document.getElementById('pdbId').addEventListener('keydown', e => { if (e.key === 'Enter') loadPDB(e.target.value); });
document.querySelectorAll('.examples button').forEach(btn =>
  btn.addEventListener('click', () => { document.getElementById('pdbId').value = btn.dataset.id; loadPDB(btn.dataset.id); }));

document.querySelectorAll('.toggle[data-rep]').forEach(btn =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle[data-rep]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRep = btn.dataset.rep;
    applyView();
  }));

document.getElementById('foldBtn').addEventListener('click', () => loadSequence(document.getElementById('seqInput').value));

const colorBtn = document.getElementById('colorBtn');
colorBtn.addEventListener('click', () => {
  colorMode = colorMode === 'element' ? 'confidence' : 'element';
  colorBtn.classList.toggle('active', colorMode === 'confidence');
  colorBtn.textContent = colorMode === 'confidence' ? '🎨 Color: confidence (pLDDT)' : '🎨 Color: element';
  if (!scaleMode) renderMolecule();
});

const scaleBtn = document.getElementById('scaleBtn');
scaleBtn.addEventListener('click', () => {
  scaleMode = !scaleMode;
  scaleBtn.classList.toggle('active', scaleMode);
  scaleBtn.textContent = scaleMode ? '↩ Back to molecule' : '🔬 Compare to cell scale';
  applyView();
});

const tabPanes = document.querySelectorAll('.tabpane');
document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    tabPanes.forEach(p => { p.style.display = p.id === `tab-${tab.dataset.tab}` ? '' : 'none'; });
  }));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
loadPDB('1CRN');
