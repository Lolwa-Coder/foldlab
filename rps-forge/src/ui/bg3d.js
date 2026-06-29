// 3D ambient background (Three.js from CDN — free, no account).
// A light-hearted storybook scene: low-poly castles on rolling green ground,
// fluffy drifting clouds, a warm sun, and a few playful RPS tokens bobbing in the
// sky. Fixed canvas behind everything, pointer-events none. Fail-safe: init()
// throws if WebGL/CDN is unavailable so the caller falls back to the 2D
// background. Respects prefers-reduced-motion (renders a calm static frame).

export async function initBg3d() {
  const THREE = await import("https://esm.sh/three@0.160.0");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const canvas = document.createElement("canvas");
  canvas.className = "bg3d";
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0); // CSS sky gradient shows through
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  document.body.prepend(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcdeeff, 22, 60);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  const FOCUS = new THREE.Vector3(0, -0.2, -3);
  const ORBIT_R = 11.5, ORBIT_H = 4.0;
  const setCam = (a) => { camera.position.set(FOCUS.x + Math.cos(a) * ORBIT_R, FOCUS.y + ORBIT_H, FOCUS.z + Math.sin(a) * ORBIT_R); camera.lookAt(FOCUS); };
  setCam(Math.PI * 0.5);

  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x86c46a, 1.05)); // sky / grass bounce
  const sun = new THREE.DirectionalLight(0xfff3d0, 1.25);
  sun.position.set(9, 12, 6);
  scene.add(sun);

  // sun disc
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(2, 18, 18), new THREE.MeshBasicMaterial({ color: 0xfff0b8 }));
  sunDisc.position.set(12, 12, -26);
  scene.add(sunDisc);

  // rolling ground
  const groundGeo = new THREE.PlaneGeometry(160, 120, 24, 18);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setZ(i, Math.sin(gp.getX(i) * 0.12) * Math.cos(gp.getY(i) * 0.1) * 1.1);
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x83cf6a, roughness: 1, flatShading: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  scene.add(ground);

  // ---- castle ----
  function castle(stoneCol, roofCol) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: stoneCol, roughness: 0.9, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.7, flatShading: true });

    const keep = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.9, 1.5), stone);
    keep.position.y = 0.95; g.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.1, 4), roof);
    keepRoof.position.y = 2.45; keepRoof.rotation.y = Math.PI / 4; g.add(keepRoof);

    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 2.3, 8), stone);
      t.position.set(x, 1.15, z); g.add(t);
      const tr = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 8), roof);
      tr.position.set(x, 2.7, z); g.add(tr);
    }
    // flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), stone);
    pole.position.set(0, 3.35, 0); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.28), new THREE.MeshStandardMaterial({ color: roofCol, side: THREE.DoubleSide }));
    flag.position.set(0.23, 3.5, 0); g.add(flag);
    g.userData.flag = flag;
    return g;
  }

  const palette = [
    [0xf3ead2, 0xe06a6a], [0xeadfc4, 0x5bb8e6], [0xf0e6cc, 0x6cc06c], [0xefe3c6, 0xf4b942], [0xf2e8d4, 0xb58be0],
  ];
  const spots = [
    { x: 0, z: -3, s: 1.9 },   // hero castle, front & centre
    { x: -6, z: -5, s: 1.25 }, { x: 6, z: -6, s: 1.35 },
    { x: -9.5, z: -10, s: 1.5 }, { x: 9.5, z: -11, s: 1.5 },
  ];
  const castles = [];
  spots.forEach((sp, i) => {
    const [st, rf] = palette[i % palette.length];
    const c = castle(st, rf);
    c.position.set(sp.x, -3, sp.z);
    c.scale.setScalar(sp.s);
    c.rotation.y = rnd(-0.4, 0.4);
    scene.add(c); castles.push(c);
  });

  // ---- clouds ----
  function cloud() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.7, 1.2), 0), m);
      puff.position.set(rnd(-1.6, 1.6), rnd(-0.2, 0.2), rnd(-0.5, 0.5));
      puff.scale.y = 0.65; g.add(puff);
    }
    return g;
  }
  const clouds = [];
  for (let i = 0; i < 5; i++) {
    const c = cloud();
    c.position.set(rnd(-16, 16), rnd(5, 10), rnd(-20, -8));
    c.scale.setScalar(rnd(1, 2.2));
    scene.add(c); clouds.push({ mesh: c, sp: rnd(0.006, 0.016) });
  }

  // ---- playful RPS tokens bobbing in the sky ----
  const HAND_MAT = {
    rock: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9, flatShading: true }),
    paper: new THREE.MeshStandardMaterial({ color: 0xfff7e6, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }),
    scissors: new THREE.MeshStandardMaterial({ color: 0xff8a5b, roughness: 0.5, metalness: 0.3, flatShading: true }),
  };
  const tokens = [];
  function tokenRock() { const g = new THREE.IcosahedronGeometry(0.5, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = 1 + (Math.random() * 2 - 1) * 0.18; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); } g.computeVertexNormals(); return new THREE.Mesh(g, HAND_MAT.rock); }
  function tokenPaper() { const g = new THREE.PlaneGeometry(0.9, 1.1, 4, 5); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 1.4) * 0.14); g.computeVertexNormals(); return new THREE.Mesh(g, HAND_MAT.paper); }
  function tokenScissors() { const grp = new THREE.Group(); const blade = new THREE.BoxGeometry(0.09, 1.0, 0.09); const b1 = new THREE.Mesh(blade, HAND_MAT.scissors); b1.position.x = 0.12; b1.rotation.z = 0.3; const b2 = new THREE.Mesh(blade, HAND_MAT.scissors); b2.position.x = -0.12; b2.rotation.z = -0.3; grp.add(b1, b2); return grp; }
  const tmk = [tokenRock, tokenPaper, tokenScissors];
  for (let i = 0; i < 3; i++) {
    const m = tmk[i]();
    m.position.set(rnd(-9, 9), rnd(4.5, 8), rnd(-6, 2));
    scene.add(m);
    tokens.push({ mesh: m, baseY: m.position.y, bobAmt: rnd(0.25, 0.6), bobSpeed: rnd(0.4, 0.8), phase: rnd(0, 6.28), rs: rnd(0.004, 0.01) });
  }

  function resize() {
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    renderer.setSize(w, h); // updateStyle: Three sets canvas style in px
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(resize); // re-fit once layout has settled

  const clock = new THREE.Clock();
  let hidden = false;
  function frame() {
    const t = clock.getElapsedTime();
    setCam(Math.PI * 0.5 + t * 0.06); // slow orbit around the castles
    for (const c of clouds) { c.mesh.position.x += c.sp; if (c.mesh.position.x > 20) c.mesh.position.x = -20; }
    for (const tk of tokens) { tk.mesh.position.y = tk.baseY + Math.sin(t * tk.bobSpeed + tk.phase) * tk.bobAmt; tk.mesh.rotation.y += tk.rs; }
    for (const c of castles) if (c.userData.flag) c.userData.flag.rotation.y = Math.sin(t * 2 + c.position.x) * 0.4;
    renderer.render(scene, camera);
    if (!hidden) requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => { hidden = document.hidden; if (!hidden && !reduce) { clock.getDelta(); requestAnimationFrame(frame); } });

  if (reduce) renderer.render(scene, camera);
  else requestAnimationFrame(frame);

  return true;
}
