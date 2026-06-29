// The tarot deck — this replaces the Catan board as the forge stage.
//
// Suits map onto the three combat stats (thematically tight):
//   Wands  (force)   -> Rock
//   Cups   (flow)    -> Paper
//   Swords (cutting) -> Scissors
//
// Cards come in three kinds, exactly as designed:
//   points  — forge stat value immediately (all Minor Arcana + a couple Majors)
//   power   — a special effect (copy, disrupt, gamble…)
//   choice  — pick points OR a power when you draft it
//
// "Copy" is a card, not a free action: The Moon copies the opponent's last
// forged card. Powers live on cards you draft, so what you can do is hidden
// information until you take the card off the shared spread.

export const SUIT_STAT = { wands: "rock", cups: "paper", swords: "scissors" };
export const SUIT_ICON = { wands: "🔥", cups: "💧", swords: "⚔️" };
export const SUIT_NAME = { wands: "Wands", cups: "Cups", swords: "Swords" };
export const STAT_ICON = { rock: "✊", paper: "✋", scissors: "✌" };

// Minor-card alignment: holy = humble (+1, sacred), evil = greedy (+3, dark),
// normal = +2. Each minor carries a one-line backstory shown under its effect.
export const ALIGN_GLYPH = { holy: "😇", evil: "😈", normal: "" };
const LORE = {
  holy: {
    wands: "A pilgrim's staff, blessed by restraint.",
    cups: "Water shared freely returns tenfold.",
    swords: "A blade sheathed in mercy.",
  },
  evil: {
    wands: "Forged in a tyrant's furnace — power at any cost.",
    cups: "A chalice that drinks more than it gives.",
    swords: "Honed on broken oaths.",
  },
  normal: {
    wands: "A sturdy branch from the old wood.",
    cups: "An honest traveller's flask.",
    swords: "Common steel, keen and true.",
  },
};

// Major Arcana. `cat` = points | power | choice. Choice cards carry concrete
// options so the UI never needs nested prompts.
const MAJORS = [
  { key: "sun", name: "The Sun", icon: "☀️", cat: "points", count: 2, desc: "+1 to ALL stats" },
  { key: "moon", name: "The Moon", icon: "🌙", cat: "power", count: 3, desc: "Copy a target's last forged card" },
  { key: "tower", name: "The Tower", icon: "🗼", cat: "power", count: 2, desc: "A target's highest stat −2" },
  { key: "wheel", name: "Wheel of Fortune", icon: "🎡", cat: "power", count: 2, desc: "Random stat +1 to +4" },
  { key: "priestess", name: "High Priestess", icon: "🔮", cat: "power", count: 2, desc: "+2 to your lowest stat" },
  {
    key: "fool", name: "The Fool", icon: "🃏", cat: "choice", count: 3, desc: "+3 to a stat of your choice",
    options: [
      { label: "✊ +3 Rock", opt: "fool_rock" },
      { label: "✋ +3 Paper", opt: "fool_paper" },
      { label: "✌ +3 Scissors", opt: "fool_scissors" },
    ],
  },
  {
    key: "magician", name: "The Magician", icon: "🎩", cat: "choice", count: 2, desc: "Forge or convert",
    options: [
      { label: "Forge: +3 to lowest stat", opt: "mag_forge" },
      { label: "Power: move 3 from top → lowest", opt: "mag_convert" },
    ],
  },
  {
    key: "star", name: "The Star", icon: "⭐", cat: "choice", count: 2, desc: "Points or power",
    options: [
      { label: "Forge: +1 to all stats", opt: "star_all" },
      { label: "Power: copy opponent's last", opt: "star_copy" },
    ],
  },
];

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildDeck(rng = Math.random) {
  const cards = [];
  let uid = 0;

  // Minor Arcana: per suit, holy(+1)×2, normal(+2)×4, evil(+3)×2 → a 1:1:2
  // holy:evil:normal ratio. Each carries an alignment + backstory.
  for (const suit of Object.keys(SUIT_STAT)) {
    const stat = SUIT_STAT[suit];
    const make = (value, align, copies) => {
      for (let c = 0; c < copies; c++) {
        cards.push({
          uid: uid++, kind: "minor", cat: "points", suit, value, stat, align,
          lore: LORE[align][suit],
          name: `${value} of ${SUIT_NAME[suit]}`,
          icon: SUIT_ICON[suit],
          desc: `+${value} ${STAT_ICON[stat]} ${stat}`,
        });
      }
    };
    make(1, "holy", 2);
    make(2, "normal", 4);
    make(3, "evil", 2);
  }

  // Major Arcana.
  for (const m of MAJORS) {
    for (let c = 0; c < m.count; c++) {
      cards.push({ uid: uid++, kind: "major", ...m });
    }
  }

  return shuffle(cards, rng);
}
