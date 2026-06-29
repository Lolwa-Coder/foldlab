# RPS-Forge

A turn-based **character-forge battler**. Spend ~10 resource turns growing three
stat pools — **Rock / Paper / Scissors** — then duel another forged fighter. The
RPS stats *are* the combat moves, so how you build is how you fight.

## Design pillars

- **The stats are the moves.** No translation layer between the build phase and
  the fight. Investing in Rock makes your Rock punch hard *and* makes throwing
  Rock tempting — which is readable. That tension is the whole game.
- **Combat = simultaneous secret throws.** Each round both pick a hand. RPS
  decides who wins the clash; the *stat value* of the winning hand decides how
  hard it lands. (See `src/engine/payoff.js`.)
- **Snappy but forgiving.** Deterministic core + a small (±10%) damage swing so
  leaders aren't guaranteed and upsets happen.

## Stack — no logins, no billing, no server you operate

| Layer      | Choice                                  | Why |
|------------|-----------------------------------------|-----|
| Client     | Static site → **GitHub Pages**          | Free, you already have GitHub |
| Realtime   | **PeerJS** public broker (P2P)          | No account, no billing; same as meccha-chameleon |
| Fairness   | **Commit-reveal** (`src/engine/commit-reveal.js`) | Provably-fair simultaneous throws with no referee |
| Stats      | **Session-only** (in memory)            | No database, nothing to host |

Everything runs in the browser. No build step required (plain ES modules).

## Alignment — Holy vs Evil meta-layer

Minor cards carry a **backstory + alignment**, tied to how greedy the gain is:

- **Holy** 😇 — humble **+1**, grants 1 Holy. **Evil** 😈 — greedy **+3**, grants 1
  Evil. **Normal** — **+2**, no alignment. Frequency **1:1:2** (holy:evil:normal),
  so chasing big stats or sacrificing them is a deliberate draft choice.
- Each player accumulates Holy/Evil. At threshold **3** (set in `state.js`):
  - **Holy ≥ 3 → Blessed tool** 💎 (your weakest hand): when it's countered it
    strikes back for **half** its value instead of dealing 0.
  - **Evil ≥ 3 → Cursed tool** ☠ (your weakest hand): it **loses every mirror
    clash** vs the same hand, regardless of stat. (Blessing wins out if you earn both.)
- Net effect: evil = big stats but a rotten weak tool; holy = small stats but a
  resilient one; normal = safe. Shown on cards (lore + glyph) and player panels
  (😇/😈 counts, 💎/☠ markers). *Not yet reflected in the balance sim — a future
  tuning pass could model it.*

## Settled rules (from the balance sim)

- **Duel format:** best-of-4 throws (winner = most total damage). Short enough that
  variance keeps underdog builds alive.
- **Forge economy:** spreading is less efficient than focusing (1:1 forge for a
  matching resource; 3:1 inefficient cross-forge). Target ≈ a 0.25 "diversity tax"
  so generalists end with fewer real points than specialists.
- **Pure 1-stat builds** are a deliberate high-risk underdog (~27%), not optimal.

## Forge stage — Tarot draft (replaced the Catan board)

To avoid being "a Catan reskin," the forge stage is a **tarot card draft**, not a
hex board. Each turn a player takes one card from a shared 4-card spread:

- **Suits = stats:** Wands→✊Rock, Cups→✋Paper, Swords→✌Scissors. Pip value = points forged.
- **Card kinds:** `points` (Minor Arcana + The Sun), `power` (The Moon=copy
  opponent's last card, The Tower=disrupt, Wheel=gamble, High Priestess), and
  `choice` (The Fool / Magician / Star let you pick points OR a power).
- **Copy is a card** (The Moon), not a free action — and powers are hidden until
  drafted, which is where the bluff lives. (P2P secrecy: shared seeded deck +
  commit-reveal, already written, wired later.)

## Layout

```
src/engine/        (unchanged, fully tested)
  payoff.js         stat model + 3x3 net-damage matrix
  nash.js           zero-sum solver (fictitious play)
  combat.js         fight() — attrition OR best-of-N, replay log
  commit-reveal.js  SHA-256 commit/reveal handshake (Web Crypto)
src/game/
  tarot.js          the deck — suits, Major Arcana, card kinds
  state.js          draft flow + card effects (10 turns → duel)
  duel.js           bridges forged stats into the combat engine
  board.js          DEPRECATED (old Catan stage; kept for reference)
src/ui/
  render.js         tarot spread + HUD + duel view (pure view layer)
  app.js            controller — hotseat, event delegation, re-render
index.html          the playable game (open the site root)
sim/                balance harness (balance-core.js, balance.js, protocol-demo.js)
sim.html            browser harness for the balance sim
```

## Play it

```
python -m http.server 5700 --directory .
# open http://localhost:5700/         -> the game
# open http://localhost:5700/sim.html -> the balance sim
```

## Status

Playable hotseat **2–6 player** game, end to end and verified in-browser:

- **Three modes:**
  - **Local** — hotseat pass-and-play, 2–6 players on one device.
  - **Private** — online invite by 4-letter code (host or join), 2–6 players,
    via PeerJS (free public broker, no accounts/billing).
  - **Public** — online quick-match (1v1). "Find a match" cascades through
    deterministic room IDs: host the first free room, else join it; if it's full,
    move to the next. Players pair off two at a time (3rd opens a new room, 4th
    joins it). Host-authoritative; per-client views are redacted so the wire never
    carries another player's hidden stats.
  - **Waiting room** with seats + Ready; locks 🔒 once all ready; starting removes
    the lobby so no one can join mid-game.
- **Leaving = losing:** if a player quits mid-game they forfeit — eliminated
  immediately (removed from the melee / skipped in the draft); the game continues
  and ends correctly when one fighter remains.
- **Turn timer:** every turn has 30s (countdown badge, top-right). If it runs out
  the turn auto-skips with a default action (auto-draft the first card / throw
  Rock). Host-enforced online; clients see the same countdown.
- **Theme:** light-hearted storybook kingdom — bright sky→grass gradient, cream
  rounded panels, colorful playful cards, Fredoka/Nunito fonts, cheerful accent
  colors (coral / sky / leaf / sun) (see `index.html`).
- **Ambient 3D background** (`src/ui/bg3d.js`, Three.js from CDN): a sunny
  landscape — low-poly castles (keeps, turrets, flags) on rolling green ground
  with the **camera slowly orbiting** the front-and-centre hero castle, drifting
  clouds, a warm sun, and a few playful RPS tokens bobbing in the sky. Fixed
  canvas behind everything, `pointer-events:none`. Fail-safe: falls back to the 2D
  emoji animation (`src/ui/bgfx.js`) if WebGL/CDN is unavailable. Respects
  `prefers-reduced-motion` (renders a calm static frame).
- **VFX** (`src/ui/vfx.js`): themed **card-use effects** (Sun = golden burst,
  Moon = blue ripple + crescents, Tower = red shards + "CRASH!", Wheel = rainbow
  sparkle, Fool/Star = confetti/stars, minor = suit-coloured puff + "+N"), plus
  **battle effects** on each melee reveal — hit bursts and "−N" pop-ups on damaged
  fighters, 💥 on eliminations, and victory confetti for the winner.
- **Dev server:** `serve.py` (threaded, no-cache) so ES-module edits always reload.
- **Draft** tarot cards (points / power / choice) to forge stats. **Targeted
  arcana:** The Moon (copy), The Tower (disrupt) and Star-copy prompt you to pick
  which player they hit.
- **Hidden info:** each opponent's stats are masked during the draft, and Major
  Arcana effects are never announced ("channels the Major Arcana…").
- **Free-for-all melee:** every alive player secretly throws each round; you take
  damage from everyone who beats your throw; 0 HP = eliminated; last fighter
  standing wins (16-round cap → most HP).
- **Card pool tuned** (`tune.html`): all eight Majors win 48.5–52% when drafted.

Run: `python serve.py 5700` then open `/` (game), `/tune.html` (card tuning),
`/sim.html` (combat balance). (`serve.py` disables caching for dev.)

**Open balance note:** FFA is attrition, which our sim showed favors generalist
builds. The forge "diversity tax" pushes back, but the FFA format wants its own
tuning pass (extend `tune.html` to score builds under melee, not just best-of-4).

**Next:** online lobby via PeerJS (commit-reveal + shared-seeded-deck already
designed; the hidden-info model maps straight onto it), then melee re-tune and
card/throw animation.

## Run the balance sim (no toolchain needed)

Serve the folder and open `sim.html`:

```
python -m http.server 5700 --directory .
# then open http://localhost:5700/sim.html
```

## Status / open balance question

The simulator (`sim.html`) pits equal-budget builds against each other under
equilibrium play. **Current finding:** the present damage model *over-rewards*
balanced builds — a Generalist (8/8/8) dominates and a pure Specialist (22/1/1)
is non-viable. The self-correction against predictability works, but it
over-corrects into "always spread evenly." Next tuning step is to make
specialization a real choice (e.g. let a countered big hit still deal chip
damage, or add convex returns), then re-run the sim until win rates cluster.
