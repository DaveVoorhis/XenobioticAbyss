# Xenobiotic Abyss — Procedural 3D Artificial Life Aquarium

A modular TypeScript + Vite + Three.js procedural 3D Alife aquarium simulation featuring composable genetics, emergent speciation, articulated marine anatomy, dynamic underwater currents, day/night solar cycles, creature-eye POV/PiP optics, and an interactive Species Codex & Genesis Lab.

## Quick Start

```bash
npm install
npm run dev
```

Build for production or run unit tests:

```bash
npm run build
npm test
npm run typecheck
```

## Architecture

```
src/
├── core/               # Tank config, math/seabed/current fields, EventBus, zero-GC SpatialHashGrid
├── genetics/           # Composable Animal & Plant genomes, mutation/recombination, SpeciesRegistry
├── simulation/         # Headless-capable SimulationEngine & decoupled ecological systems
│   └── systems/        # AnimalBehaviorSystem, PlantEcologySystem, LifecycleSystem
├── rendering/          # Sculpted GeometryLibrary, procedural TextureLibrary, GLSL Shaders,
│                       # AnimalMeshBuilder, PlantMeshBuilder, InstancedFxRenderer,
│                       # EnvironmentBuilder, CreatureEyeSystem, SceneRenderer
├── audio/              # Optional Web Audio API procedural underwater soundscape
├── ui/                 # HudController, InspectorPanel, SpeciesCodexPanel,
│                       # EnvironmentControlPanel, PopulationGraph
└── styles/             # Deep-sea glassmorphism CSS
tests/                  # Vitest unit tests (spatial grid, genetics, headless simulation)
```

## Controls & Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **Click Organism** | Select & inspect organism |
| **Drag / Scroll** | Orbit / zoom camera |
| `Space` | Pause / resume simulation |
| `G` | Toggle **Feed Mode** (click water surface to drop sinking nutrient pellets) |
| `C` | Toggle **Species Codex & Lineage** drawer |
| `E` | Toggle **Environment & Genesis Lab** drawer |
| `V` | Toggle Fullscreen **Creature-Eye POV** (when an animal is selected) |
| `P` | Toggle Live **Picture-in-Picture Eye-Cam** |
| `F` | Toggle **Follow Cam** on selected organism |
| `M` | Toggle procedural **Abyssal Ambient Audio** |
| `H` | Hide / restore HUD |
| `Esc` | Exit POV / Feed Mode / close drawers |
