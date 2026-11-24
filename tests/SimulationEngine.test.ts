import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TANK } from '../src/core/config';
import { computeHorizontalBoundWeight, computePlantPlacementWeight } from '../src/core/math';
import { createAnimalGenome } from '../src/genetics/AnimalGenetics';
import { createPlantGenome } from '../src/genetics/PlantGenetics';
import { SimulationEngine } from '../src/simulation/SimulationEngine';

describe('SimulationEngine', () => {
  it('seeds balanced preset and runs headless simulation without NaN transforms', () => {
    const sim = new SimulationEngine();
    sim.seedPreset('balanced_reef');

    expect(sim.animals.length).toBeGreaterThan(20);
    expect(sim.plants.length).toBeGreaterThan(20);
    expect(sim.getActiveSpeciesCount()).toBeGreaterThan(8);

    // Run 60 steps (~2.4 seconds of sim time)
    for (let i = 0; i < 60; i++) {
      sim.step(0.04);
    }

    for (const a of sim.animals) {
      expect(Number.isFinite(a.position.x)).toBe(true);
      expect(Number.isFinite(a.position.y)).toBe(true);
      expect(Number.isFinite(a.position.z)).toBe(true);
      expect(Number.isFinite(a.quaternion.w)).toBe(true);
    }
  });

  it('transitions dying animals seamlessly to sinking corpses and eventually nutrient patches', () => {
    const sim = new SimulationEngine();
    sim.seedPreset('balanced_reef');
    const animal = sim.animals[0];
    expect(animal).toBeDefined();

    const corpse = sim.transitionAnimalToCorpse(animal, 'test');
    expect(corpse).not.toBeNull();
    expect(animal.alive).toBe(false);
    expect(corpse?.phase).toBe('dying');

    // Advance enough time to enter sinking_corpse phase
    for (let i = 0; i < 45; i++) sim.step(0.04);
    expect(['sinking_corpse', 'decomposing', 'dissolving']).toContain(corpse?.phase);
  });

  it('drops nutrient pellets and allows export/import snapshot roundtrip', () => {
    const sim = new SimulationEngine();
    sim.seedPreset('bioluminescent_garden');
    sim.dropFoodCluster(0, 0, 5);
    expect(sim.foodPellets.length).toBe(5);

    const snapshot = sim.exportSnapshot();
    const animalCount = snapshot.animals.length;
    const plantCount = snapshot.plants.length;

    const sim2 = new SimulationEngine();
    sim2.importSnapshot(snapshot);
    expect(sim2.animals.length).toBe(animalCount);
    expect(sim2.plants.length).toBe(plantCount);
    expect(sim2.env.timeOfDay).toBeCloseTo(snapshot.env.timeOfDay, 4);

    // Verify induced mutation creates a new living organism
    const first = sim2.animals[0];
    const mutant = sim2.induceMutation(first);
    expect(mutant).not.toBeNull();
    expect(sim2.animals.length).toBe(animalCount + 1);
    expect(mutant?.position).toBeInstanceOf(THREE.Vector3);
  });

  it('emits torn fragments, mouth morsels, and recoil/jolt states during grazing and scavenging', () => {
    const sim = new SimulationEngine();

    const fragmentEvents: Array<{ kind: string; count: number }> = [];
    sim.events.on('fx:fragments', ({ kind, count }) => {
      fragmentEvents.push({ kind, count });
    });

    // Verify torn edible morsel spawning
    const fleshScrap = sim.spawnTornMorsel(
      new THREE.Vector3(0, 5, 0),
      new THREE.Vector3(0.4, 0.2, 0),
      0xd9485f,
      'flesh',
      30
    );
    const floraScrap = sim.spawnTornMorsel(
      new THREE.Vector3(1, 5, 0),
      new THREE.Vector3(-0.3, 0.1, 0),
      0x34d399,
      'flora',
      20
    );
    expect(fleshScrap?.origin).toBe('flesh');
    expect(floraScrap?.origin).toBe('flora');

    // Deterministic grazing pair on the left side of the tank
    const kelpGenome = createPlantGenome('Photosynthetic', 'spiral_kelp');
    const plant = sim.spawnPlant(kelpGenome, -6, 0, 1.0);
    expect(plant).not.toBeNull();

    const herbGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    const herbivore = sim.spawnAnimal(
      herbGenome,
      new THREE.Vector3(-6 + 0.35, (plant?.position.y ?? 1.0) + 0.65, 0),
      false
    );
    expect(herbivore).not.toBeNull();
    if (herbivore) {
      herbivore.energy = 25;
      herbivore.biteCooldown = 0;
      herbivore.velocity.set(0, 0, 0);
    }

    // Deterministic scavenging pair on the right side of the tank
    const donorGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    const donor = sim.spawnAnimal(donorGenome, new THREE.Vector3(6, 2.5, 0), false);
    const corpse = donor ? sim.transitionAnimalToCorpse(donor, 'test') : null;
    expect(corpse).not.toBeNull();
    if (corpse) {
      corpse.phase = 'decomposing';
    }

    const scavGenome = createAnimalGenome('Scavenger', 'armored_trilopod');
    const scavenger = sim.spawnAnimal(
      scavGenome,
      new THREE.Vector3(6 + 0.3, (corpse?.position.y ?? 2.5) + 0.15, 0),
      false
    );
    expect(scavenger).not.toBeNull();
    if (scavenger) {
      scavenger.energy = 25;
      scavenger.biteCooldown = 0;
      scavenger.velocity.set(0, 0, 0);
    }

    let maxRustle = 0;
    let maxJolt = 0;
    let maxThrash = 0;
    let maxMorsel = 0;
    for (let i = 0; i < 12; i++) {
      sim.step(0.05);
      if (plant) maxRustle = Math.max(maxRustle, plant.rustleAnim);
      if (corpse) maxJolt = Math.max(maxJolt, corpse.joltAnim);
      if (scavenger) maxThrash = Math.max(maxThrash, scavenger.thrashAnim);
      if (herbivore) maxMorsel = Math.max(maxMorsel, herbivore.mouthMorselTimer);
    }

    const floraEvents = fragmentEvents.filter((e) => e.kind === 'flora');
    const fleshEvents = fragmentEvents.filter((e) => e.kind === 'flesh');
    expect(floraEvents.length).toBeGreaterThan(0);
    expect(fleshEvents.length).toBeGreaterThan(0);
    expect(maxRustle).toBeGreaterThan(0);
    expect(maxJolt).toBeGreaterThan(0);
    expect(maxThrash).toBeGreaterThan(0);
    expect(maxMorsel).toBeGreaterThan(0);
  });

  it('enforces co-evolutionary toxin defense vs toxin_resistant herbivory', () => {
    const sim = new SimulationEngine();
    const toxicPlantGenome = createPlantGenome('Photosynthetic', 'ribbon_seagrass');
    toxicPlantGenome.defense = 'alkaloid_toxin';
    toxicPlantGenome.toxicity = 0.9;
    const pA = sim.spawnPlant(toxicPlantGenome, -4, 0, 1.0);
    const pB = sim.spawnPlant(toxicPlantGenome, 4, 0, 1.0);
    expect(pA).not.toBeNull();
    expect(pB).not.toBeNull();

    const vulnGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    vulnGenome.physiology = 'ectothermic';
    const vuln = sim.spawnAnimal(
      vulnGenome,
      new THREE.Vector3(-4 + 0.3, (pA?.position.y ?? 1.0) + 0.55, 0),
      false
    );

    const resGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    resGenome.physiology = 'toxin_resistant';
    const res = sim.spawnAnimal(
      resGenome,
      new THREE.Vector3(4 + 0.3, (pB?.position.y ?? 1.0) + 0.55, 0),
      false
    );

    expect(vuln).not.toBeNull();
    expect(res).not.toBeNull();
    if (vuln && res) {
      vuln.energy = 25;
      res.energy = 25;
      vuln.velocity.set(0, 0, 0);
      res.velocity.set(0, 0, 0);
    }

    for (let i = 0; i < 10; i++) {
      sim.step(0.05);
    }

    expect(vuln!.hp).toBeLessThan(vuln!.maxHp);
    expect(res!.hp).toBe(res!.maxHp);
  });

  it('keeps torn pieces intact while sinking, resting on the seabed, and very slowly dissolving', () => {
    const sim = new SimulationEngine();
    sim.env.autoGenesisEnabled = false;

    const piece = sim.spawnTornMorsel(
      new THREE.Vector3(0, 9.0, 0),
      new THREE.Vector3(0.2, 0.0, -0.1),
      0xe0485c,
      'flesh',
      18
    );
    expect(piece).not.toBeNull();
    expect(piece!.phase).toBe('sinking');
    expect(piece!.restingDuration).toBeGreaterThanOrEqual(50);
    expect(piece!.dissolveDuration).toBeGreaterThanOrEqual(70);

    // Advance 3 seconds while still mid-water: should remain intact & sinking (no dissolving)
    for (let i = 0; i < 60; i++) sim.step(0.05);
    expect(piece!.alive).toBe(true);
    expect(piece!.phase).toBe('sinking');
    expect(piece!.opacity).toBe(1.0);
    expect(piece!.dissolveAge).toBe(0);

    // Step until it settles onto the seabed
    let settled = false;
    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      if (piece!.phase === 'resting') {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true);
    expect(piece!.alive).toBe(true);
    expect(piece!.opacity).toBe(1.0);

    // Remains intact on the bottom after 30 seconds if uneaten
    for (let i = 0; i < 300; i++) sim.step(0.1);
    expect(piece!.alive).toBe(true);
    expect(piece!.phase).toBe('resting');
    expect(piece!.opacity).toBe(1.0);

    // Eventually enters slow dissolving phase after restingDuration
    let enteredDissolving = false;
    for (let i = 0; i < 800; i++) {
      sim.step(0.1);
      if (piece!.phase === 'dissolving') {
        enteredDissolving = true;
        break;
      }
    }
    expect(enteredDissolving).toBe(true);
    const scaleAtStart = piece!.scale;

    // Slowly dissolves over time before finally turning into a nutrient patch
    for (let i = 0; i < 200; i++) sim.step(0.1);
    expect(piece!.alive).toBe(true);
    expect(piece!.scale).toBeLessThan(scaleAtStart);
    expect(piece!.opacity).toBeLessThan(1.0);

    const patchesBefore = sim.nutrientPatches.length;
    for (let i = 0; i < 1200 && piece!.alive; i++) {
      sim.step(0.1);
    }
    expect(piece!.alive).toBe(false);
    expect(sim.nutrientPatches.length).toBeGreaterThan(patchesBefore);
  });

  it('tears intact flesh pieces in combat and lets predators & scavengers eat sinking and seabed pieces', () => {
    const sim = new SimulationEngine();
    sim.env.autoGenesisEnabled = false;

    // 1. Combat strike tears off intact edible flesh pieces
    const predGenome = createAnimalGenome('Carnivore', 'fusiform_swimmer');
    predGenome.sizeScale = 0.85;
    predGenome.attackPower = 22;
    const preyGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    preyGenome.sizeScale = 0.55;
    preyGenome.maxHp = 80;
    preyGenome.toxicity = 0;
    preyGenome.integument = 'plated_scales';

    const pred = sim.spawnAnimal(predGenome, new THREE.Vector3(-4, 6, 0), false)!;
    const prey = sim.spawnAnimal(preyGenome, new THREE.Vector3(-3.3, 6, 0), false)!;
    pred.energy = 60;
    pred.attackCooldown = 0;

    for (let i = 0; i < 8; i++) sim.step(0.05);
    expect(prey.hp).toBeLessThan(prey.maxHp);
    const tornFlesh = sim.foodPellets.filter((p) => p.origin === 'flesh');
    expect(tornFlesh.length).toBeGreaterThan(0);
    expect(tornFlesh[0].phase).toBe('sinking');

    // 2. Predator intercepts & eats a sinking flesh chunk mid-water
    const sim2 = new SimulationEngine();
    sim2.env.autoGenesisEnabled = false;
    const hunter = sim2.spawnAnimal(predGenome, new THREE.Vector3(0, 7.0, 0), false)!;
    hunter.energy = 50;
    hunter.biteCooldown = 0;
    hunter.velocity.set(0.8, 0, 0);

    const sinkingPiece = sim2.spawnTornMorsel(
      new THREE.Vector3(1.5, 7.0, 0),
      new THREE.Vector3(0, -0.3, 0),
      0xd9485f,
      'flesh',
      14
    )!;
    sinkingPiece.age = 0.5; // Past brief tear-detach window

    let maxJawGape = 0;
    for (let i = 0; i < 50 && sinkingPiece.alive; i++) {
      sim2.step(0.05);
      maxJawGape = Math.max(maxJawGape, hunter.jawGape);
    }
    expect(sinkingPiece.alive).toBe(false);
    expect(hunter.energy).toBeGreaterThan(50);
    expect(maxJawGape).toBeGreaterThan(0);

    // 3. Scavenger eats a resting flesh chunk off the seabed
    const sim3 = new SimulationEngine();
    sim3.env.autoGenesisEnabled = false;
    const scavGenome = createAnimalGenome('Scavenger', 'armored_trilopod');
    scavGenome.sizeScale = 0.7;
    const scav = sim3.spawnAnimal(scavGenome, new THREE.Vector3(0, 2.0, 0), false)!;
    scav.energy = 45;
    scav.biteCooldown = 0;

    const bottomPiece = sim3.spawnTornMorsel(
      new THREE.Vector3(1.4, 1.0, 0),
      new THREE.Vector3(0, 0, 0),
      0xd9485f,
      'flesh',
      14
    )!;
    bottomPiece.age = 5.0;
    bottomPiece.phase = 'resting';
    bottomPiece.state = 'Resting';

    for (let i = 0; i < 80 && bottomPiece.alive; i++) {
      sim3.step(0.05);
    }
    expect(bottomPiece.alive).toBe(false);
    expect(scav.energy).toBeGreaterThan(45);
  });

  it('progresses egg-laying species through Egg -> Larva -> Adult and Egg -> Instar (I..III) -> Adult with increasing size', () => {
    const sim = new SimulationEngine();
    sim.env.autoGenesisEnabled = false;

    // 1. Soft-bodied fish: Egg -> Larva -> Adult
    const fishGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    fishGenome.integument = 'plated_scales';
    fishGenome.reproduction = 'Egg_Layer';
    fishGenome.sizeScale = 0.72;

    const fishEgg = sim.spawnEgg(fishGenome, new THREE.Vector3(-4, 3, 0))!;
    fishEgg.incubateDuration = 2.0;
    const initialEggScale = fishEgg.scale;

    // Advance incubation partway: egg swells
    for (let i = 0; i < 20; i++) sim.step(0.05);
    expect(fishEgg.alive).toBe(true);
    expect(fishEgg.scale).toBeGreaterThan(initialEggScale);

    // Finish incubation: hatches directly into Larva
    for (let i = 0; i < 30 && fishEgg.alive; i++) sim.step(0.05);
    expect(fishEgg.alive).toBe(false);
    expect(sim.animals.length).toBe(1);
    const fish = sim.animals[0];
    expect(fish.lifeStage).toBe('larva');
    expect(fish.stage).toBe('Larva');
    const larvaScale = fish.scale;
    const larvaMaxHp = fish.maxHp;

    // Feed & grow through Larva -> Adult
    for (let i = 0; i < 500 && fish.lifeStage !== 'adult'; i++) {
      fish.energy = 100;
      sim.step(0.1);
    }
    expect(fish.lifeStage).toBe('adult');
    expect(fish.stage).toBe('Adult');
    expect(fish.scale).toBeGreaterThan(larvaScale * 1.45);
    expect(fish.maxHp).toBeGreaterThan(larvaMaxHp);

    // 2. Armored trilopod: Egg -> Instar I -> Instar II -> Instar III -> Adult
    const sim2 = new SimulationEngine();
    sim2.env.autoGenesisEnabled = false;
    const triloGenome = createAnimalGenome('Scavenger', 'armored_trilopod');
    triloGenome.integument = 'chitin_carapace';
    triloGenome.reproduction = 'Egg_Layer';
    triloGenome.sizeScale = 0.65;

    const triloEgg = sim2.spawnEgg(triloGenome, new THREE.Vector3(2, 2.5, 0))!;
    triloEgg.incubateDuration = 1.5;
    for (let i = 0; i < 40 && triloEgg.alive; i++) sim2.step(0.05);
    expect(triloEgg.alive).toBe(false);
    const trilo = sim2.animals[0];
    expect(trilo.lifeStage).toBe('instar');
    expect(trilo.stage).toBe('Instar I');

    const seenStages = new Set<string>([trilo.stage]);
    const stageScales: Record<string, number> = { [trilo.stage]: trilo.scale };
    for (let i = 0; i < 600 && trilo.lifeStage !== 'adult'; i++) {
      trilo.energy = 100;
      sim2.step(0.1);
      if (!seenStages.has(trilo.stage)) {
        seenStages.add(trilo.stage);
        stageScales[trilo.stage] = trilo.scale;
      }
    }
    expect(seenStages.has('Instar I')).toBe(true);
    expect(seenStages.has('Instar II')).toBe(true);
    expect(seenStages.has('Instar III')).toBe(true);
    expect(seenStages.has('Adult')).toBe(true);
    expect(stageScales['Instar II']).toBeGreaterThan(stageScales['Instar I']);
    expect(stageScales['Instar III']).toBeGreaterThan(stageScales['Instar II']);
    expect(stageScales['Adult']).toBeGreaterThan(stageScales['Instar III']);
  });

  it('progresses live-born / budded spawn through Live Spawn -> Larva -> Adult and shifts behavior by stage', () => {
    const sim = new SimulationEngine();
    sim.env.autoGenesisEnabled = false;

    // Binary fission parent buds a tiny Live Spawn
    const predGenome = createAnimalGenome('Carnivore', 'fusiform_swimmer');
    predGenome.integument = 'smooth_mucus';
    predGenome.reproduction = 'Binary_Fission';
    predGenome.sizeScale = 0.82;
    predGenome.combat = 'Melee_Ram';
    const parent = sim.spawnAnimal(predGenome, new THREE.Vector3(-4, 6, 0), 'adult')!;
    parent.energy = 110;
    parent.reproCooldown = 0;

    sim.step(0.05);
    expect(sim.animals.length).toBe(2);
    const neonate = sim.animals.find((a) => a.id !== parent.id)!;
    expect(neonate.lifeStage).toBe('spawn');
    expect(neonate.stage).toBe('Live Spawn');
    const spawnScale = neonate.scale;
    expect(spawnScale).toBeLessThan(parent.scale * 0.45);

    // Behavioral check: a Live Spawn carnivore flees a large non-conspecific instead of hunting it!
    const sim2 = new SimulationEngine();
    sim2.env.autoGenesisEnabled = false;
    const babyPred = sim2.spawnAnimal(predGenome, new THREE.Vector3(0, 6, 0), 'spawn')!;
    const bigHerbGenome = createAnimalGenome('Herbivore', 'winged_manta');
    bigHerbGenome.sizeScale = 0.8;
    const bigHerb = sim2.spawnAnimal(bigHerbGenome, new THREE.Vector3(1.6, 6, 0), 'adult')!;
    bigHerb.energy = 100;

    for (let i = 0; i < 6; i++) sim2.step(0.05);
    expect(babyPred.state).toBe('Fleeing');
    expect(babyPred.activeTarget?.role).toBe('threat');

    // Remove the big herbivore and add safe kelp: Live Spawn seeks shelter near flora!
    sim2.disposeEntity(bigHerb);
    const kelpG = createPlantGenome('Photosynthetic', 'spiral_kelp');
    sim2.spawnPlant(kelpG, 2.5, 0, 1.0);
    babyPred.energy = 115; // Sated so it looks for cover
    babyPred.position.set(0, 3.5, 0);
    for (let i = 0; i < 6; i++) sim2.step(0.05);
    expect(babyPred.state).toBe('Sheltering');

    // Grow the Live Spawn through Larva -> Adult and verify strict monotonic stage scaling
    let larvaScale = 0;
    for (let i = 0; i < 800 && babyPred.lifeStage !== 'adult'; i++) {
      babyPred.energy = 105;
      sim2.step(0.1);
      if (babyPred.lifeStage === 'larva' && larvaScale === 0) {
        larvaScale = babyPred.scale;
      }
    }
    expect(larvaScale).toBeGreaterThan(spawnScale * 1.25);
    expect(babyPred.lifeStage).toBe('adult');
    expect(babyPred.scale).toBeGreaterThan(larvaScale * 1.45);

    // Now as an Adult, the carnivore actively hunts appropriately sized prey!
    const preyGenome = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    preyGenome.sizeScale = 0.55;
    preyGenome.toxicity = 0;
    preyGenome.integument = 'plated_scales';
    sim2.spawnAnimal(preyGenome, babyPred.position.clone().add(new THREE.Vector3(1.8, 0, 0)), 'adult')!;
    babyPred.energy = 60;
    for (let i = 0; i < 4; i++) sim2.step(0.05);
    expect(['Hunting', 'Attacking']).toContain(babyPred.state);
    expect(babyPred.activeTarget?.role).toBe('prey');
  });

  it('applies soft weighted horizontal reef bounds for creatures and plant placement', () => {
    // Verify smooth weighting gradients: free inside coreRadius, tapering strongly beyond radius
    expect(computeHorizontalBoundWeight(0, 0)).toBe(0);
    expect(computeHorizontalBoundWeight(TANK.coreRadius * 0.9, 0)).toBe(0);
    expect(computeHorizontalBoundWeight(TANK.radius, 0)).toBeGreaterThan(0.8);
    expect(computeHorizontalBoundWeight(TANK.maxRadius, 0)).toBeGreaterThan(
      computeHorizontalBoundWeight(TANK.radius, 0) * 2.0
    );
    expect(computePlantPlacementWeight(0, 0)).toBe(1);
    expect(computePlantPlacementWeight(TANK.radius + 3.0, 0)).toBeLessThan(0.15);

    const sim = new SimulationEngine();
    sim.seedPreset('balanced_reef');

    // Seeded plants should be heavily weighted within the reef core/soft horizon
    let innerPlants = 0;
    for (const pl of sim.plants) {
      const r = Math.hypot(pl.position.x, pl.position.z);
      expect(r).toBeLessThanOrEqual(TANK.radius + 0.5);
      if (r <= TANK.coreRadius + 1.5) innerPlants++;
    }
    expect(innerPlants / sim.plants.length).toBeGreaterThan(0.75);

    // A creature placed beyond the soft horizontal boundary smoothly curves back inward toward the reef
    const animalG = createAnimalGenome('Herbivore', 'fusiform_swimmer');
    const stray = sim.spawnAnimal(animalG, new THREE.Vector3(TANK.maxRadius - 1.5, 6, 0), 'adult')!;
    stray.velocity.set(3.5, 0, 0);
    const startR = Math.hypot(stray.position.x, stray.position.z);
    for (let i = 0; i < 90; i++) {
      sim.step(0.05);
    }
    const endR = Math.hypot(stray.position.x, stray.position.z);
    expect(endR).toBeLessThan(startR - 1.5);

    // All simulated entities stay safely within the far open-water ceiling
    const allBounded = [
      ...sim.animals,
      ...sim.plants,
      ...sim.eggs,
      ...sim.propagules,
      ...sim.foodPellets,
      ...sim.corpses,
    ];
    for (const e of allBounded) {
      const r = Math.hypot(e.position.x, e.position.z);
      expect(r).toBeLessThanOrEqual(TANK.maxRadius);
    }
  });

  it('keeps the Genesis Vent dark between pulses, ramps up shortly before genesis, peaks, and extinguishes', () => {
    const sim = new SimulationEngine();
    sim.env.autoGenesisEnabled = true;
    sim.env.genesisInterval = 18.0;
    sim.genesisCountdown = 14.0;
    sim.ventPulseEnergy = 0.0;

    // Dormant well before the upcoming genesis pulse
    expect(sim.getVentGlowLevel()).toBe(0);

    // Step into the pre-genesis charge-up window (within ~4.8s of genesis)
    sim.genesisCountdown = 3.6;
    const earlyCharge = sim.getVentGlowLevel();
    expect(earlyCharge).toBeGreaterThan(0);
    expect(earlyCharge).toBeLessThan(0.5);

    // Closer to genesis: significantly brighter
    sim.genesisCountdown = 0.8;
    const lateCharge = sim.getVentGlowLevel();
    expect(lateCharge).toBeGreaterThan(earlyCharge * 2.0);
    expect(lateCharge).toBeLessThan(1.0);

    // Step across the genesis trigger -> peaks at 1.0
    for (let i = 0; i < 18; i++) sim.step(0.05);
    const peakGlow = sim.getVentGlowLevel();
    expect(peakGlow).toBeGreaterThan(0.8);

    // Advance ~1.5s after pulse -> dimming
    for (let i = 0; i < 30; i++) sim.step(0.05);
    const dimmingGlow = sim.getVentGlowLevel();
    expect(dimmingGlow).toBeLessThan(peakGlow);
    expect(dimmingGlow).toBeGreaterThan(0);

    // Advance another ~3.5s -> completely extinguished until the next genesis event
    for (let i = 0; i < 70; i++) sim.step(0.05);
    expect(sim.getVentGlowLevel()).toBe(0);

    // Manual biogenesis also flares immediately
    sim.triggerBiogenesis();
    expect(sim.getVentGlowLevel()).toBeCloseTo(1.0, 4);
  });
});
