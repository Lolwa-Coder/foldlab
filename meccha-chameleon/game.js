/* =====================================================================
   MECCHA CAMO  —  PeerJS browser-multiplayer hide & seek
   ---------------------------------------------------------------------
   Inspired by the paint-to-blend / pose-to-hide mechanic of party
   hide-and-seek games. Original implementation.

   Networking model: HOST-AUTHORITATIVE.
     - Host opens a Peer whose id is "meccha-<CODE>".
     - Clients connect to that id. They stream their *input* to the host.
     - Host runs the whole simulation (movement, catching, timers, scoring)
       and broadcasts a full snapshot ~18x/sec. Clients render snapshots.
     - The world is generated from a numeric seed so every client draws
       the identical room without shipping geometry.
   ===================================================================== */

(() => {
'use strict';

// ---------- tiny helpers ----------
const $  = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const lerp  = (a,b,t) => a + (b-a)*t;
const now   = () => performance.now();
function mulberry32(seed){ // deterministic seeded RNG
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hexToRgb(h){ const n = parseInt(h.slice(1),16);
  return [n>>16 & 255, n>>8 & 255, n & 255]; }
function colorDist(a,b){ // perceptual-ish 0..1 (0 = identical)
  const dr=(a[0]-b[0])/255, dg=(a[1]-b[1])/255, db=(a[2]-b[2])/255;
  return Math.sqrt((dr*dr*0.3 + dg*dg*0.59 + db*db*0.11)); }

// ---------- world / balance constants ----------
const WORLD = { w: 2200, h: 1500 };
const SPEED = 230;            // px/sec hider/hunter move
const CATCH_RADIUS = 46;      // hunter click tolerance
const PREP_SECS = 18;         // hiding phase
const HUNT_SECS = 90;         // hunting phase
const TAUNT_COOLDOWN = 4;
const PALETTE = ['#6b7b8c','#8d6e5c','#3f7d4f','#b0a06a','#7a5b86',
                 '#c06b5a','#4a6b8a','#d9c7a8','#2f3a44','#9fb1a0'];

// =====================================================================
//  WORLD GENERATION (seeded, identical on every peer)
// =====================================================================
function buildWorld(seed){
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[(rnd()*arr.length)|0];
  const floorPalettes = [
    ['#39424d','#323b45','#3d4751'], ['#4a3f36','#433a32','#52473c'],
    ['#36473b','#314034','#3d5042']];
  const floorSet = pick(floorPalettes);

  // floor tiles (big cells so colors are samplable & paintable-to)
  const cell = 220, cols = Math.ceil(WORLD.w/cell), rows = Math.ceil(WORLD.h/cell);
  const tiles = [];
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++)
    tiles.push({ x:x*cell, y:y*cell, w:cell, h:cell, c: pick(floorSet) });

  // props: furniture-ish rectangles & rugs the hiders can hide against
  const propCols = ['#5a4632','#6e5a44','#7d6a52','#2d3a46','#3a4b3f',
                    '#8a7c5c','#6b4f5a','#445a6b','#9a8f78','#525a64'];
  const props = [];
  const N = 46;
  for(let i=0;i<N;i++){
    const big = rnd() < .35;
    const w = big ? 120+rnd()*180 : 50+rnd()*90;
    const h = big ? 90+rnd()*150  : 50+rnd()*90;
    props.push({
      x: 60 + rnd()*(WORLD.w-120-w), y: 60 + rnd()*(WORLD.h-120-h),
      w, h, c: pick(propCols),
      round: rnd()<.3, rot: (rnd()-.5)*0.2 });
  }
  return { seed, floorSet, cell, cols, rows, tiles, props };
}
// What color is "under" a point — used by eyedropper & blend meter.
function colorUnder(world, x, y){
  // topmost prop wins, else floor tile
  for(let i=world.props.length-1;i>=0;i--){
    const p = world.props[i];
    if(x>=p.x && x<=p.x+p.w && y>=p.y && y<=p.y+p.h) return p.c;
  }
  const cx = clamp((x/world.cell)|0,0,world.cols-1);
  const cy = clamp((y/world.cell)|0,0,world.rows-1);
  return world.tiles[cy*world.cols+cx].c;
}

// =====================================================================
//  SHARED STATE
// =====================================================================
const Phase = { LOBBY:'lobby', HIDE:'hiding', HUNT:'hunting', RESULT:'result' };
let world = null;
let myId  = null;           // peer/connection id of this client
let isHost = false;
let mode = 'standard';
let roomCode = '';

// =====================================================================
//  NETWORK
// =====================================================================
let peer = null;
const conns = new Map();    // hostside: id -> DataConnection
let hostConn = null;        // clientside: connection to host

function makeCode(){ let s=''; for(let i=0;i<4;i++) s+=String.fromCharCode(65+(Math.random()*26|0)); return s; }
function send(conn, msg){ try{ conn.send(msg); }catch(e){} }
function broadcast(msg){ for(const c of conns.values()) send(c, msg); }

// ---- HOST ----
function hostStart(name, selMode){
  isHost = true; mode = selMode; roomCode = makeCode();
  world = buildWorld((Math.random()*2**31)|0);
  peer = new Peer('meccha-'+roomCode, { debug: 1 });
  peer.on('open', () => {
    myId = 'HOST';
    HostGame.addPlayer('HOST', name || 'host');
    enterGame();
    setStatus('');
    showHostCtl(true);
  });
  peer.on('error', e => setStatus('Peer error: '+e.type));
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      // tell newcomer the world + their id + current config
      send(conn, { t:'init', id:conn.peer, seed:world.seed, mode, code:roomCode });
    });
    conn.on('data', (m) => HostNet.onData(conn.peer, m));
    conn.on('close', () => { conns.delete(conn.peer); HostGame.removePlayer(conn.peer); });
  });
}

const HostNet = {
  onData(from, m){
    if(m.t==='join'){ HostGame.addPlayer(from, m.name); }
    else if(m.t==='input'){ HostGame.applyInput(from, m); }
  }
};

// ---- CLIENT ----
function clientJoin(name, code){
  isHost = false; roomCode = code;
  peer = new Peer({ debug: 1 });
  peer.on('error', e => setStatus(
    e.type==='peer-unavailable' ? 'No room with that code.' : 'Peer error: '+e.type));
  peer.on('open', () => {
    hostConn = peer.connect('meccha-'+code, { reliable:false });
    hostConn.on('open', () => { send(hostConn, { t:'join', name: name||'blob' }); });
    hostConn.on('data', (m) => {
      if(m.t==='init'){
        myId = m.id; mode = m.mode; world = buildWorld(m.seed); roomCode = m.code;
        enterGame(); setStatus('');
      } else if(m.t==='state'){ ClientView.snapshot = m; }
    });
    hostConn.on('close', () => setCenter('Disconnected from host', true));
    setStatus('Connecting…');
  });
}

// =====================================================================
//  HOST GAME SIMULATION
// =====================================================================
const HostGame = {
  players: new Map(),  // id -> player
  phase: Phase.LOBBY,
  phaseEnd: 0,         // performance.now() ms when phase ends
  started: false,

  addPlayer(id, name){
    if(this.players.has(id)) return;
    const spawn = this._spawn();
    this.players.set(id, {
      id, name: (name||'blob').slice(0,14),
      x: spawn.x, y: spawn.y, vx:0, vy:0,
      color: PALETTE[(Math.random()*PALETTE.length)|0],
      pose: 'stand', role: 'hider', alive: true,
      taunt: 0, tauntCd: 0, score: 0, caught: false,
      input: { ux:0, uy:0 }
    });
  },
  removePlayer(id){ this.players.delete(id); },
  _spawn(){ return { x: 120+Math.random()*(WORLD.w-240), y: 120+Math.random()*(WORLD.h-240) }; },

  applyInput(id, m){
    const p = this.players.get(id); if(!p) return;
    if(m.ux!==undefined){ p.input.ux = clamp(m.ux,-1,1); p.input.uy = clamp(m.uy,-1,1); }
    if(m.color) p.color = m.color;
    if(m.pose)  p.pose  = m.pose;
    if(m.taunt && p.tauntCd<=0 && p.role==='hider' && p.alive){ p.taunt = 1.0; p.tauntCd = TAUNT_COOLDOWN; }
    if(m.catch && p.role==='hunter') this._tryCatch(p, m.catch.x, m.catch.y);
  },

  startMatch(){
    if(this.players.size < 1) return;
    const ids = [...this.players.keys()];
    // assign roles
    for(const id of ids){ const p=this.players.get(id);
      p.role='hider'; p.alive=true; p.caught=false; p.score=0; p.taunt=0; p.tauntCd=0;
      const s=this._spawn(); p.x=s.x; p.y=s.y; }
    if(mode!=='double'){
      // one random hunter
      const hunter = ids[(Math.random()*ids.length)|0];
      this.players.get(hunter).role='hunter';
    }
    this.phase = Phase.HIDE; this.started=true;
    this.phaseEnd = now() + PREP_SECS*1000;
    showHostCtl(false);
  },

  _tryCatch(hunter, wx, wy){
    let best=null, bestD=Infinity;
    for(const p of this.players.values()){
      if(p.role!=='hider' || !p.alive) continue;
      const d=Math.hypot(p.x-wx, p.y-wy);
      const r = p.pose==='curl'?CATCH_RADIUS*0.7:CATCH_RADIUS;  // curling shrinks your hitbox
      if(d<=r && d<bestD){ best=p; bestD=d; }
    }
    if(best){
      const v = best;
      v.caught = true;
      hunter.score += 1;
      if(mode==='infection'){ v.role='hunter'; v.alive=true; v.caught=false; }
      else { v.alive=false; }
    }
  },

  tick(dt){
    // movement integration for everyone
    for(const p of this.players.values()){
      if(!p.alive){ p.vx=p.vy=0; continue; }
      const moving = (p.input.ux||p.input.uy);
      // posing slows/stops you (and curl/lie shrink hitbox) — staying still helps you blend
      const poseMul = p.pose==='stand'?1 : p.pose==='curl'?0 : 0.0;
      const mag = Math.hypot(p.input.ux,p.input.uy)||1;
      p.vx = (p.input.ux/mag)*SPEED*poseMul;
      p.vy = (p.input.uy/mag)*SPEED*poseMul;
      if(moving && p.pose!=='stand'){ /* movement forces you back to standing */ p.pose='stand'; p.vx=(p.input.ux/mag)*SPEED; p.vy=(p.input.uy/mag)*SPEED; }
      p.x = clamp(p.x + p.vx*dt, 24, WORLD.w-24);
      p.y = clamp(p.y + p.vy*dt, 24, WORLD.h-24);
      p.taunt   = Math.max(0, p.taunt - dt*1.4);
      p.tauntCd = Math.max(0, p.tauntCd - dt);
    }
    // phase clock
    if(this.phase===Phase.HIDE && now()>=this.phaseEnd){
      this.phase = Phase.HUNT;
      this.phaseEnd = now() + HUNT_SECS*1000;
    }
    if(this.phase===Phase.HUNT){
      // survivors gain score over time (rewards good hiding)
      for(const p of this.players.values())
        if(p.role==='hider' && p.alive) p.score += dt*1.0;
      const hidersLeft = [...this.players.values()].filter(p=>p.role==='hider'&&p.alive).length;
      if(now()>=this.phaseEnd || hidersLeft===0){
        this.phase = Phase.RESULT;
        this.phaseEnd = now() + 8000;
      }
    }
    if(this.phase===Phase.RESULT && now()>=this.phaseEnd){
      this.phase = Phase.LOBBY; this.started=false; showHostCtl(true);
    }
  },

  snapshot(){
    const t = Math.max(0, Math.ceil((this.phaseEnd-now())/1000));
    const players = [...this.players.values()].map(p=>({
      id:p.id, n:p.name, x:Math.round(p.x), y:Math.round(p.y),
      c:p.color, po:p.pose, r:p.role, a:p.alive?1:0,
      tt:+p.taunt.toFixed(2), s:Math.round(p.score) }));
    return { t:'state', ph:this.phase, tm:t, md:mode, code:roomCode, players };
  }
};

// host main loop
let lastTick = now();
function hostLoop(){
  if(isHost){
    const t=now(), dt=Math.min(0.05,(t-lastTick)/1000); lastTick=t;
    HostGame.tick(dt);
    broadcast(HostGame.snapshot());
    // host renders from its own snapshot too
    ClientView.snapshot = HostGame.snapshot();
  }
  requestAnimationFrame(hostLoop);
}

// =====================================================================
//  CLIENT VIEW (render + local input)
// =====================================================================
const ClientView = {
  snapshot: null,
  cam: { x:0, y:0 },
  keys: {},
  myColor: PALETTE[0],
  myPose: 'stand',
  lastSent: 0,
  pendingClick: null,
  me(){ return this.snapshot?.players.find(p=>p.id===myId) || null; }
};

const canvas = $('#game'), ctx = canvas.getContext('2d');
function resize(){ canvas.width = innerWidth*devicePixelRatio; canvas.height = innerHeight*devicePixelRatio;
  canvas.style.width=innerWidth+'px'; canvas.style.height=innerHeight+'px'; }
addEventListener('resize', resize); resize();

// ---- input ----
addEventListener('keydown', e=>{ ClientView.keys[e.key.toLowerCase()] = true;
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
  if(e.key==='1') setPose('stand'); if(e.key==='2') setPose('curl'); if(e.key==='3') setPose('lie');
  if(e.key.toLowerCase()==='t') doTaunt();
  if(e.key.toLowerCase()==='e') eyedrop();
});
addEventListener('keyup', e=>{ ClientView.keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousedown', e=>{
  const me = ClientView.me();
  if(!me) return;
  const wx = ClientView.cam.x + e.clientX, wy = ClientView.cam.y + e.clientY;
  if(me.r==='hunter') ClientView.pendingClick = { x:wx, y:wy };
});

function localInput(){
  const k = ClientView.keys;
  let ux = (k['d']||k['arrowright']?1:0) - (k['a']||k['arrowleft']?1:0);
  let uy = (k['s']||k['arrowdown']?1:0) - (k['w']||k['arrowup']?1:0);
  return { ux, uy };
}

function sendInput(){
  const t=now();
  if(t - ClientView.lastSent < 45) return;     // ~22 Hz
  ClientView.lastSent = t;
  const {ux,uy} = localInput();
  const msg = { t:'input', ux, uy, color:ClientView.myColor, pose:ClientView.myPose };
  if(ClientView.pendingClick){ msg.catch = ClientView.pendingClick; ClientView.pendingClick=null; }
  if(ClientView._taunt){ msg.taunt=1; ClientView._taunt=false; }
  if(isHost) HostGame.applyInput('HOST', msg);
  else if(hostConn && hostConn.open) send(hostConn, msg);
}

// ---- toolbar actions ----
function setPose(p){ ClientView.myPose = p;
  document.querySelectorAll('#poseGroup .pbtn').forEach(b=>b.classList.toggle('sel', b.dataset.pose===p)); }
function setColor(c){ ClientView.myColor=c;
  document.querySelectorAll('#paletteGroup .swatch').forEach(s=>s.classList.toggle('sel', s.dataset.c===c)); }
function doTaunt(){ ClientView._taunt = true; }
function eyedrop(){ const me=ClientView.me(); if(!me||!world) return;
  setColor(colorUnder(world, me.x, me.y)); }

// =====================================================================
//  RENDER
// =====================================================================
function drawBlob(p, isMe){
  ctx.save();
  ctx.translate(p.x - ClientView.cam.x, p.y - ClientView.cam.y);
  // pose -> silhouette
  let rx=22, ry=22;
  if(p.po==='curl'){ rx=15; ry=15; }
  if(p.po==='lie'){  rx=28; ry=12; }
  // taunt ring
  if(p.tt>0){ ctx.globalAlpha=p.tt*0.6; ctx.strokeStyle='#fff';
    ctx.lineWidth=2; ctx.beginPath();
    ctx.arc(0,0, 30 + (1-p.tt)*46, 0, TAU); ctx.stroke(); ctx.globalAlpha=1; }
  // body
  ctx.fillStyle = p.a ? p.c : '#0008';
  ctx.beginPath(); ctx.ellipse(0,0, rx, ry, 0, 0, TAU); ctx.fill();
  // little feet/eyes only when standing (silhouette cue)
  if(p.po==='stand' && p.a){
    ctx.fillStyle='#0007';
    ctx.beginPath(); ctx.ellipse(-7,-4,3,4,0,0,TAU); ctx.ellipse(7,-4,3,4,0,0,TAU); ctx.fill();
  }
  // outline for the hunter / yourself so you don't get lost
  if(isMe){ ctx.strokeStyle = p.r==='hunter' ? '#f87171' : '#4ade80';
    ctx.lineWidth=2.5; ctx.beginPath(); ctx.ellipse(0,0,rx+3,ry+3,0,0,TAU); ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='11px sans-serif'; ctx.textAlign='center';
    ctx.fillText('you', 0, ry+16);
  }
  if(!p.a){ ctx.fillStyle='#fff8'; ctx.font='11px sans-serif'; ctx.textAlign='center';
    ctx.fillText('caught', 0, -ry-6); }
  ctx.restore();
}

function render(){
  const snap = ClientView.snapshot;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!world || !snap){ return; }

  // camera follows me
  const me = ClientView.me();
  if(me){ ClientView.cam.x = lerp(ClientView.cam.x, clamp(me.x - innerWidth/2, 0, WORLD.w-innerWidth), 0.18);
          ClientView.cam.y = lerp(ClientView.cam.y, clamp(me.y - innerHeight/2, 0, WORLD.h-innerHeight), 0.18); }
  const cx=ClientView.cam.x, cy=ClientView.cam.y;

  // floor
  for(const t of world.tiles){
    const sx=t.x-cx, sy=t.y-cy;
    if(sx>innerWidth||sy>innerHeight||sx+t.w<0||sy+t.h<0) continue;
    ctx.fillStyle=t.c; ctx.fillRect(sx,sy,t.w+1,t.h+1);
  }
  // props
  for(const p of world.props){
    const sx=p.x-cx, sy=p.y-cy;
    if(sx>innerWidth||sy>innerHeight||sx+p.w<0||sy+p.h<0) continue;
    ctx.save(); ctx.translate(sx+p.w/2, sy+p.h/2); ctx.rotate(p.rot);
    ctx.fillStyle=p.c;
    if(p.round){ ctx.beginPath(); ctx.ellipse(0,0,p.w/2,p.h/2,0,0,TAU); ctx.fill(); }
    else ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
    ctx.fillStyle='#0003'; ctx.fillRect(-p.w/2,-p.h/2,p.w,4); // top shadow seam
    ctx.restore();
  }
  // world border
  ctx.strokeStyle='#0c0f14'; ctx.lineWidth=20;
  ctx.strokeRect(-cx,-cy,WORLD.w,WORLD.h);

  // blobs (hunter on top)
  const ps = [...snap.players].sort((a,b)=> (a.r==='hunter')-(b.r==='hunter'));
  for(const p of ps) drawBlob(p, p.id===myId);

  updateHud(snap, me);
}

// =====================================================================
//  HUD
// =====================================================================
const hudPhase=$('#phaseLbl'), hudTimer=$('#timer'), hudRole=$('#roleTag'),
      hudRoom=$('#roomTag'), hudSb=$('#scoreboard'), blendFill=$('#blendFill'),
      hint=$('#hint'), centerMsg=$('#centerMsg');

function updateHud(snap, me){
  hudPhase.textContent = snap.ph;
  hudTimer.textContent = (snap.ph===Phase.LOBBY||snap.ph===Phase.RESULT) ? '--' : snap.tm;
  hudRoom.textContent  = 'room '+snap.code+' · '+snap.md;
  if(me){
    hudRole.textContent = me.r==='hunter' ? '🔍 HUNTER' : '🎨 HIDER';
    hudRole.style.color = me.r==='hunter' ? 'var(--danger)' : 'var(--accent)';
    // blend meter (hiders only)
    if(me.r==='hider' && world){
      const under = hexToRgb(colorUnder(world, me.x, me.y));
      const mine  = hexToRgb(me.c);
      let q = 1 - colorDist(under, mine);            // 1 = perfect match
      if(me.po==='stand') q *= 0.55;                 // moving/standing = easier to spot
      q = clamp(q,0,1);
      blendFill.style.width = (q*100).toFixed(0)+'%';
      blendFill.style.background = q>0.75?'#4ade80':q>0.45?'#fbbf24':'#f87171';
      $('#blendWrap').style.opacity = 1; $('#paletteGroup').style.opacity=1; $('#poseGroup').style.opacity=1;
    } else {
      $('#blendWrap').style.opacity = .25; $('#paletteGroup').style.opacity=.25; $('#poseGroup').style.opacity=.25;
    }
  }
  // scoreboard
  const rows = [...snap.players].sort((a,b)=>b.s-a.s).slice(0,7).map(p=>{
    const tag = p.r==='hunter'?'🔍':(p.a?'🎨':'💀');
    const meCls = p.id===myId?' class="sb-row me"':' class="sb-row"';
    return `<div${meCls.slice(7)}><span>${tag} ${escapeHtml(p.n)}</span><span>${p.s}</span></div>`;
  }).join('');
  hudSb.innerHTML = `<div class="tiny" style="margin-bottom:4px">SCOREBOARD</div>${rows}`;

  // hints + center messages
  if(snap.ph===Phase.HIDE){
    setCenter('HIDE! Paint to match the floor & strike a pose', false);
    hint.textContent = me && me.r==='hunter'
      ? 'You are the hunter — wait while hiders camouflage…'
      : 'WASD move · 1/2/3 pose · E eyedropper · click palette to paint';
  } else if(snap.ph===Phase.HUNT){
    setCenter('', false);
    hint.textContent = me && me.r==='hunter'
      ? 'Click a blob to catch it. Spot the ones that blended in!'
      : 'Freeze and blend. Caught hiders are out. T to taunt (risky).';
  } else if(snap.ph===Phase.RESULT){
    const top=[...snap.players].sort((a,b)=>b.s-a.s)[0];
    setCenter(top?`Round over — ${escapeHtml(top.n)} wins with ${top.s}!`:'Round over', false);
    hint.textContent = isHost ? 'Press “Start match” to play again.' : 'Waiting for host to restart…';
  } else { setCenter(isHost?'Press “Start match” when everyone’s in':'Waiting for host to start…', false);
    hint.textContent = `Share room code: ${snap.code}`; }
}
function setCenter(txt, danger){
  if(!txt){ centerMsg.classList.add('hidden'); return; }
  centerMsg.classList.remove('hidden');
  const el=centerMsg.querySelector('.big'); el.textContent=txt;
  el.style.color = danger?'var(--danger)':'var(--txt)';
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// =====================================================================
//  MAIN CLIENT LOOP
// =====================================================================
function clientLoop(){ sendInput(); render(); requestAnimationFrame(clientLoop); }

// =====================================================================
//  UI WIRING
// =====================================================================
function setStatus(s){ $('#status').textContent = s; }
function showHostCtl(v){ $('#hostCtl').classList.toggle('hidden', !(isHost && v)); }
function enterGame(){
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  // build palette
  const pg=$('#paletteGroup'); pg.innerHTML='';
  PALETTE.forEach((c,i)=>{ const s=document.createElement('div');
    s.className='swatch'+(i===0?' sel':''); s.style.background=c; s.dataset.c=c;
    s.onclick=()=>setColor(c); pg.appendChild(s); });
  setColor(PALETTE[0]); setPose('stand');
  clientLoop();
  if(isHost) hostLoop();
}

$('#hostBtn').onclick = () => {
  setStatus('Opening room…');
  hostStart($('#nameIn').value.trim(), $('#modeIn').value);
};
$('#joinBtn').onclick = () => {
  const code = $('#codeIn').value.trim().toUpperCase();
  if(code.length!==4){ setStatus('Enter the 4-letter code.'); return; }
  setStatus('Joining…'); clientJoin($('#nameIn').value.trim(), code);
};
$('#hostCtl').onclick = () => HostGame.startMatch();
document.querySelectorAll('#poseGroup .pbtn').forEach(b=> b.onclick=()=>setPose(b.dataset.pose));
$('#eyedrop').onclick = eyedrop;
$('#tauntBtn').onclick = doTaunt;
$('#codeIn').addEventListener('input', e=> e.target.value=e.target.value.toUpperCase());

})();
