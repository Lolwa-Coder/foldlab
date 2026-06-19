# Meccha Camo

A browser-multiplayer **hide & seek** built with **PeerJS** (WebRTC, peer-to-peer — no game server).

Inspired by *Meccha Chameleon* (Lemorion_1224, 2026): the non-obvious twist isn't running and
hiding — it's that **hiders are blank blobs who paint themselves to match the floor and freeze in a
pose to camouflage**, while a hunter races a timer to spot the ones that blended in.

## Play
Open `index.html` (served over http, e.g. `npx serve` or VS Code Live Server — `file://` blocks WebRTC).
One player **hosts** and gets a 4-letter code; everyone else **joins** with it. Host presses *Start match*.

- **Move:** WASD / arrows
- **Pose:** `1` stand · `2` curl (smaller hitbox) · `3` lie (flat). *Moving snaps you back to standing.*
- **Paint:** click a palette swatch · `E` = eyedropper (sample the floor under you)
- **Taunt:** `T` — whistle ring that helps the hunter find you (risky)
- **Hunter:** click a blob to catch it

The **Blend** meter shows how well your color matches what's beneath you; standing still in a matching
pose maxes it out.

## Modes
- **Standard** — one hunter, hiders score by surviving.
- **Infection** — caught hiders become hunters; last hider wins.
- **Double** — everyone hides, then everyone hunts; most catches wins.

## Networking
Host-authoritative. The host runs the whole simulation and broadcasts a snapshot ~18×/s; clients stream
input. The room is generated from a shared seed so every peer renders the identical map without shipping
geometry. Uses the public PeerJS broker for signalling.
