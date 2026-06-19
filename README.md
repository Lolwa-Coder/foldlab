# 🧬 foldlab

A browser-based protein-structure studio that goes beyond *viewing* known structures — it **predicts** structures from sequence, estimates the **cost of making them in a lab**, and predicts the effect of **point mutations**. No build step, no backend: one HTML file, one JS module, three live scientific APIs.

> **The workflow that makes it different:** paste a sequence → fold it with ESMFold → see per-residue confidence → find its closest natural relatives in the PDB → estimate what it would cost to produce → mutate a residue and re-fold to measure the structural impact.

Mature viewers (Mol\*, PyMOL, ChimeraX) render structures beautifully. `foldlab`'s niche is pairing structure with **prediction and economics** — the questions those tools don't answer: *is this real, is it novel, and what would it cost to make?*

---

## Features

- **Load any PDB structure** live from the RCSB Protein Data Bank by 4-character ID.
- **Two representations** — CPK space-filling spheres (`InstancedMesh`, smooth even for ~5,000-atom hemoglobin) and a rainbow α-carbon backbone trace.
- **Glossy rendering** — `MeshStandardMaterial` with a procedural environment map for reflections, ACES tone mapping, and a soft-shadowed ground plane.
- **Click any atom to identify** its residue, chain, and (for predictions) pLDDT confidence.
- **About panel** — title, method, resolution, mass, source organism, and primary citation, pulled live from the RCSB data API.
- **Similar proteins** — sequence-similarity search (RCSB MMseqs2) across the entire PDB, with % identity; click any hit to switch to it.
- **Cell-scale comparison** — nests the protein among real biological objects (ribosome, virus, mitochondrion, cell) at true scale.
- **🔮 Fold a sequence (ESMFold)** — predict a 3D structure from any amino-acid sequence, colored by pLDDT confidence.
- **💰 Lab cost estimate** — chemical-synthesis vs recombinant-expression routes, with **region** (US / Europe / China / India …) and **setup** (academic DIY / in-house / CRO) modifiers.
- **🧪 Mutation effect prediction** — mutate one residue, re-fold the mutant, and compare to wild-type via ΔpLDDT and Cα RMSD (Theobald QCP superposition).

---

## 📊 Claude Rating: 63 / 100 — *Solid*

A self-assessment using a reusable 7-benchmark rubric (each 0–10, weighted, ×10). Scored honestly — high craft and rigor, modest real-world impact.

| Benchmark | Weight | Score | |
|---|---:|---:|:--|
| **Craft** — execution & correctness | 20% | 8.5 | `████████▌░` |
| **Rigor** — domain accuracy & honesty | 15% | 8.0 | `████████░░` |
| **Completeness** — coherent finished scope | 10% | 7.0 | `███████░░░` |
| **Novelty** — differentiation vs prior art | 15% | 6.5 | `██████▌░░░` |
| **Ambition** — difficulty of the problem | 10% | 6.0 | `██████░░░░` |
| **Robustness** — tests, deps, scalability | 10% | 5.0 | `█████░░░░░` |
| **Impact** — real-world usefulness | 20% | 3.0 | `███░░░░░░░` |
| **Composite** | | **63** | **Solid** |

*Tiers: 90+ Landmark · 80–89 Excellent · 70–79 Strong · 60–69 Solid · 50–59 Promising · 40–49 Rough · <40 Early.*

**Honest read:** high craft and intellectual honesty; held back by impact (molecular visualization is commoditized and ESMFold is the real engine) and robustness (no tests, leans on free public APIs). This is a strong learning/portfolio artifact, not a product.

---

## Getting started

No dependencies and no build. Just serve the folder over HTTP (ES modules and `fetch` don't work over `file://`):

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, etc.). An internet connection is required — structures, predictions, and metadata are fetched live.

---

## How it works

| Capability | Source / method |
|---|---|
| Rendering | [three.js](https://threejs.org) r160 (via CDN importmap) |
| Structure files & metadata | [RCSB PDB](https://www.rcsb.org) file download + data API |
| Sequence similarity | RCSB search API (MMseqs2), `results_verbosity: verbose` for % identity |
| Structure prediction | [ESMFold](https://esmatlas.com) public API (`api.esmatlas.com`, ~400-residue limit) |
| Confidence | pLDDT from the prediction's B-factor column (AlphaFold blue→orange palette) |
| Mutation RMSD | Theobald **QCP** superposition (Cα, no SVD) — rotation/translation invariant |

The cost model splits into **commodities** (gene/peptide synthesis — globally priced, flat) and **labor** (region- and setup-sensitive), which is why the same protein can range from ~$1.8k (China / academic DIY) to ~$13k (Switzerland / outsourced CRO).

---

## What this is — and isn't

- **It is** an educational/exploration tool that pairs structure with prediction and feasibility.
- **It isn't** a stability (ΔΔG) predictor — the mutation view is a *structural proxy* (how much the predicted fold and confidence shift), not a thermodynamic prediction. Confirming a real effect needs experiment or a dedicated predictor.
- The lab-cost figures are deliberately ballpark commercial rates, not quotes.

---

## Project structure

```
index.html   UI, styles, three.js importmap
main.js      PDB parser, scene, representations, all APIs, cost & mutation logic
.claude/     launch config for local preview
```

---

## Acknowledgements

- [RCSB Protein Data Bank](https://www.rcsb.org) for structures, metadata, and the search service.
- [ESM / ESMFold](https://esmatlas.com) (Meta AI) for the structure-prediction API.
- [three.js](https://threejs.org) for WebGL rendering.

Built iteratively with [Claude Code](https://claude.com/claude-code).
