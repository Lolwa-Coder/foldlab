// Ambient background animation (side-effect module). Two layers, both very faint
// so they never fight the foreground:
//   1. drifting hand glyphs floating across the screen
//   2. periodic "clash" vignettes — two hands slide together and the winner
//      plays its interaction (rock crushes scissors, paper covers rock,
//      scissors snip paper), then they fade out. Cycles through the matchups.
// Respects prefers-reduced-motion.

const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HANDS = ["✊", "✋", "✌"];
const rand = (a, b) => a + Math.random() * (b - a);

const layer = document.createElement("div");
layer.className = "bg-fx";
document.body.prepend(layer);

// ---- drifting floaters ------------------------------------------------------

function floater(gentle = false) {
  const el = document.createElement("span");
  el.className = "bg-hand bg-floater";
  el.textContent = HANDS[Math.floor(Math.random() * 3)];
  el.style.fontSize = rand(64, 170) + "px";
  layer.appendChild(el);

  const drift = () => {
    const top = rand(4, 92);
    const fromX = rand(-12, 95);
    const span = gentle ? rand(-10, 10) : rand(-28, 28); // smaller movement when gentle
    const toX = fromX + span;
    el.style.top = top + "vh";
    el.animate(
      [
        { transform: `translate(${fromX}vw, 0) rotate(0deg)`, opacity: 0 },
        { opacity: 0.06, offset: 0.12 },
        { opacity: 0.06, offset: 0.88 },
        { transform: `translate(${toX}vw, ${gentle ? rand(-3, 3) : rand(-8, 8)}vh) rotate(${gentle ? rand(-8, 8) : rand(-40, 40)}deg)`, opacity: 0 },
      ],
      { duration: gentle ? rand(46000, 70000) : rand(20000, 34000), easing: "ease-in-out" }
    ).onfinish = drift;
  };
  drift();
}

// ---- clash vignettes --------------------------------------------------------

const MATCHUPS = [
  { win: "✊", lose: "✌", kind: "crush" }, // rock crushes scissors
  { win: "✋", lose: "✊", kind: "cover" }, // paper covers rock
  { win: "✌", lose: "✋", kind: "snip" },  // scissors snip paper
];
let mi = 0;

function clash() {
  const m = MATCHUPS[mi++ % MATCHUPS.length];
  const lane = document.createElement("div");
  lane.className = "bg-clash";
  lane.style.top = rand(22, 74) + "vh";

  const mk = (txt) => { const s = document.createElement("span"); s.className = "bg-hand"; s.textContent = txt; lane.appendChild(s); return s; };
  const w = mk(m.win);
  const l = mk(m.lose);
  const spark = document.createElement("span");
  spark.className = "bg-spark";
  spark.textContent = "✦";
  lane.appendChild(spark);
  layer.appendChild(lane);

  const C = 50; // clash point (vw)
  const OP = 0.17;
  w.animate([{ transform: "translateX(-22vw)", opacity: 0 }, { transform: `translateX(${C - 7}vw)`, opacity: OP }], { duration: 1600, easing: "ease-out", fill: "forwards" });
  l.animate([{ transform: "translateX(108vw)", opacity: 0 }, { transform: `translateX(${C + 1}vw)`, opacity: OP }], { duration: 1600, easing: "ease-out", fill: "forwards" });

  setTimeout(() => {
    spark.style.left = C + "vw";
    spark.animate(
      [
        { opacity: 0, transform: "translateX(-50%) scale(.4)" },
        { opacity: 0.5, transform: "translateX(-50%) scale(1.7)" },
        { opacity: 0, transform: "translateX(-50%) scale(2.6)" },
      ],
      { duration: 750, easing: "ease-out" }
    );

    // winner's interaction
    if (m.kind === "crush") {
      w.animate(
        [
          { transform: `translateX(${C - 7}vw) translateY(0) scale(1)` },
          { transform: `translateX(${C - 7}vw) translateY(2.6vh) scale(1.18)` },
          { transform: `translateX(${C - 7}vw) translateY(0) scale(1)` },
        ],
        { duration: 480, easing: "ease-in-out" }
      );
    } else if (m.kind === "cover") {
      w.animate([{ transform: `translateX(${C - 7}vw) scale(1)` }, { transform: `translateX(${C - 4}vw) scale(1.45)` }], { duration: 620, easing: "ease-out", fill: "forwards" });
    } else {
      w.animate(
        [
          { transform: `translateX(${C - 7}vw) rotate(0deg)` },
          { transform: `translateX(${C - 7}vw) rotate(-26deg)` },
          { transform: `translateX(${C - 7}vw) rotate(0deg)` },
        ],
        { duration: 360, iterations: 2, easing: "ease-in-out" }
      );
    }

    // loser is defeated
    const fall = l.animate(
      [
        { transform: `translateX(${C + 1}vw) rotate(0deg) scale(1)`, opacity: OP },
        { transform: `translateX(${C + 5}vw) rotate(85deg) translateY(9vh) scale(.55)`, opacity: 0 },
      ],
      { duration: 950, easing: "ease-in", fill: "forwards" }
    );
    fall.onfinish = () => {
      w.animate([{ opacity: OP }, { opacity: 0 }], { duration: 900, fill: "forwards" }).onfinish = () => lane.remove();
    };
  }, 1650);

  setTimeout(clash, rand(5200, 8200));
}

// ---- boot -------------------------------------------------------------------

if (reduce) {
  // reduced-motion: gentle, slow drift only — no energetic clashes
  for (let i = 0; i < 4; i++) floater(true);
} else {
  for (let i = 0; i < 6; i++) floater();
  setTimeout(clash, 1200);
}
