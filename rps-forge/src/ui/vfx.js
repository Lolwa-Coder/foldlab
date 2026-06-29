// Lightweight 2D VFX layer (DOM + Web Animations). Used for:
//   - card-use effects, themed per tarot card
//   - battle effects on melee reveal (hits, eliminations, victory confetti)
// A fixed overlay above the UI, pointer-events:none. No dependencies.

const layer = document.createElement("div");
layer.className = "vfx-layer";
document.body.appendChild(layer);

const rand = (a, b) => a + Math.random() * (b - a);
function node(cls, txt) { const d = document.createElement("div"); d.className = cls; if (txt != null) d.textContent = txt; return d; }

export function burst(x, y, { count = 14, colors = ["#ffd24a"], emoji = null, spread = 120, size = 10, dur = 800 } = {}) {
  for (let i = 0; i < count; i++) {
    const p = node("vfx-bit");
    if (emoji) { p.textContent = emoji; p.style.fontSize = size * 1.7 + "px"; }
    else { p.style.width = p.style.height = size + "px"; p.style.background = colors[i % colors.length]; p.style.borderRadius = "50%"; }
    p.style.left = x + "px"; p.style.top = y + "px";
    layer.appendChild(p);
    const ang = Math.random() * Math.PI * 2;
    const dist = spread * (0.4 + Math.random() * 0.7);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - spread * 0.25; // slight upward bias
    p.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0 },
      ],
      { duration: dur * rand(0.8, 1.2), easing: "cubic-bezier(.2,.7,.3,1)" }
    ).onfinish = () => p.remove();
  }
}

export function ripple(x, y, color = "#fff") {
  const r = node("vfx-ripple");
  r.style.left = x + "px"; r.style.top = y + "px"; r.style.borderColor = color;
  layer.appendChild(r);
  r.animate(
    [{ transform: "translate(-50%,-50%) scale(.2)", opacity: 0.75 }, { transform: "translate(-50%,-50%) scale(3.4)", opacity: 0 }],
    { duration: 720, easing: "ease-out" }
  ).onfinish = () => r.remove();
}

export function flash(x, y, text, color = "#fff") {
  const f = node("vfx-flash", text);
  f.style.left = x + "px"; f.style.top = y + "px"; f.style.color = color;
  layer.appendChild(f);
  f.animate(
    [
      { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
      { transform: "translate(-50%,-95%) scale(1.2)", opacity: 1, offset: 0.3 },
      { transform: "translate(-50%,-150%) scale(1)", opacity: 0 },
    ],
    { duration: 950, easing: "ease-out" }
  ).onfinish = () => f.remove();
}

export function shake(el) {
  if (!el) return;
  el.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(0)" }],
    { duration: 320, easing: "ease-in-out" }
  );
}

export function confetti() {
  const colors = ["#ff7a59", "#4fb0e8", "#5cc06a", "#f6c544", "#ef6f9e", "#b58be0"];
  for (let i = 0; i < 90; i++) {
    const c = node("vfx-confetti");
    c.style.left = rand(0, 100) + "vw"; c.style.top = "-24px";
    c.style.background = colors[i % colors.length];
    layer.appendChild(c);
    c.animate(
      [
        { transform: "translateY(-24px) rotate(0deg)", opacity: 1 },
        { transform: `translateY(${window.innerHeight + 50}px) rotate(${rand(360, 1080)}deg)`, opacity: 1 },
      ],
      { duration: rand(1800, 3400), delay: rand(0, 500), easing: "cubic-bezier(.3,.1,.5,1)" }
    ).onfinish = () => c.remove();
  }
}

// ---- semantic helpers -------------------------------------------------------

const STAT_COLOR = { rock: "#9aa3ad", paper: "#4fb0e8", scissors: "#ff7a59" };
const STAT_ICON = { rock: "✊", paper: "✋", scissors: "✌" };

// Effect for using a tarot card, themed per card.
export function cardEffect(card, x, y) {
  if (!card) return;
  if (card.kind === "minor") {
    const col = STAT_COLOR[card.stat];
    burst(x, y, { count: 10, colors: [col], spread: 90, size: 9 });
    flash(x, y, `+${card.value} ${STAT_ICON[card.stat]}`, col);
    return;
  }
  switch (card.key) {
    case "sun": ripple(x, y, "#f6c544"); burst(x, y, { count: 24, colors: ["#f6c544", "#ffe98a", "#ffb347"], spread: 170, size: 12 }); break;
    case "moon": ripple(x, y, "#4fb0e8"); burst(x, y, { count: 14, emoji: "🌙", spread: 120 }); break;
    case "tower": burst(x, y, { count: 20, colors: ["#e06a6a", "#b03a3a", "#9aa3ad"], spread: 160, size: 11 }); flash(x, y, "CRASH!", "#e06a6a"); break;
    case "wheel": burst(x, y, { count: 22, colors: ["#ff7a59", "#4fb0e8", "#5cc06a", "#f6c544", "#b58be0"], spread: 150 }); break;
    case "priestess": burst(x, y, { count: 14, colors: ["#9fd6f5", "#cfe9ff"], spread: 100, emoji: "✦" }); break;
    case "fool": burst(x, y, { count: 26, colors: ["#ff7a59", "#4fb0e8", "#5cc06a", "#f6c544", "#ef6f9e"], spread: 160 }); break;
    case "magician": burst(x, y, { count: 16, emoji: "✦", spread: 120 }); break;
    case "star": burst(x, y, { count: 18, emoji: "⭐", spread: 150 }); break;
    default: burst(x, y, { count: 10 });
  }
}

// Battle effects on a melee reveal: hits, eliminations, and victory confetti.
export function battleVfx(reveal, winnerIdx) {
  document.querySelectorAll(".rcell[data-seat]").forEach((cell) => {
    const seat = Number(cell.dataset.seat);
    const d = reveal.dmg ? reveal.dmg[seat] || 0 : 0;
    const r = cell.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (d > 0) {
      burst(cx, cy, { count: 11, colors: ["#ff7a59", "#f6c544", "#e06a6a"], spread: 72, size: 8 });
      flash(cx, cy, `-${d}`, "#e06a6a");
      shake(cell);
    }
  });
  (reveal.elim || []).forEach((seat) => {
    const cell = document.querySelector(`.rcell[data-seat="${seat}"]`);
    if (cell) { const r = cell.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, { count: 16, emoji: "💥", spread: 100 }); }
  });
  if (reveal.final && winnerIdx >= 0) confetti();
}
