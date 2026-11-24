import * as THREE from 'three';
import { CAPS, TANK } from '../../core/config';
import {
  clamp,
  clampToTankRadius,
  computeHorizontalBoundWeight,
  computeDaylightFactor,
  getSeabedHeight,
  randRange,
  safeNormalize,
  safeOrientToward,
  sampleWaterCurrent,
} from '../../core/math';
import { recombineAnimalGenomes } from '../../genetics/AnimalGenetics';
import {
  computeStageMaxHp,
  computeStageScale,
  getInstarRank,
  getLifeStageFromMaturity,
  getStageBehaviorModifiers,
  getStageDisplayLabel,
} from '../lifecycle';
import type { AnimalGenome } from '../../genetics/types';
import type { AnimalEntity, Entity, FoodPelletEntity } from '../types';
import type { SimulationContext } from '../SimulationEngine';

export class AnimalBehaviorSystem {
  private readonly _steer = new THREE.Vector3();
  private readonly _desired = new THREE.Vector3();
  private readonly _sep = new THREE.Vector3();
  private readonly _align = new THREE.Vector3();
  private readonly _coh = new THREE.Vector3();
  private readonly _current = new THREE.Vector3();
  private readonly _prevFwd = new THREE.Vector3();
  private readonly _bitePos = new THREE.Vector3();
  private readonly _mouthPos = new THREE.Vector3();
  private readonly _ejectDir = new THREE.Vector3();
  private readonly _scrapVel = new THREE.Vector3();
  private readonly _qAnimals: AnimalEntity[] = [];
  private readonly _qPlants: any[] = [];
  private readonly _qFood: Entity[] = [];

  private computeMouthPos(a: AnimalEntity, out: THREE.Vector3): THREE.Vector3 {
    // Anatomical snout/mouth sits forward along local +Z scaled by entity size & elongation
    const snoutZ = 0.56 * a.scale * (a.genome.bodyElongation ?? 1.0);
    out.set(0, 0, snoutZ).applyQuaternion(a.quaternion).add(a.position);
    return out;
  }

  private wantsFoodItem(g: AnimalGenome, a: AnimalEntity, item: Entity): boolean {
    if (!item.alive) return false;
    if (item.kind === 'pellet') {
      // Brief tear-detachment grace window so newly ripped chunks visibly break free first
      if (item.origin !== 'pellet' && item.age < 0.32) return false;
      if (item.nutrients < 1.5) return false;

      if (item.origin === 'pellet') return true;

      // Live Spawn neonates feed opportunistically on micro-crumbs & drifting scraps regardless of adult diet
      if (a.lifeStage === 'spawn') {
        return item.phase !== 'dissolving' || item.dissolveAge < item.dissolveDuration * 0.4;
      }

      // Arthropod Instars are active benthic scrap & detritus feeders
      if (a.lifeStage === 'instar') {
        return true;
      }

      // Pelagic Larvae readily eat drifting flora shreds and (for carnivores/omnivores/scavengers) flesh chunks
      if (a.lifeStage === 'larva' && item.origin === 'flora') {
        return item.phase !== 'dissolving' || item.dissolveAge < item.dissolveDuration * 0.5;
      }

      if (item.origin === 'flesh') {
        if (g.diet === 'Scavenger') return true;
        if (g.diet === 'Omnivore') return a.energy < 114;
        if (g.diet === 'Carnivore') {
          // Predators eagerly intercept sinking flesh chunks and swoop down for intact resting pieces when hungry
          if (item.phase === 'sinking') return a.energy < 114;
          if (item.phase === 'resting') return a.energy < 98;
          return a.energy < 78 && item.dissolveAge < item.dissolveDuration * 0.45;
        }
        return false;
      }

      // Torn flora shreds: grazers, omnivores & filter feeders eat drifting/resting shreds;
      // scavengers also clean up fallen shreds resting on the seabed
      if (g.diet === 'Herbivore' || g.diet === 'Omnivore' || g.diet === 'Filter_Feeder') {
        return item.phase !== 'dissolving' || item.dissolveAge < item.dissolveDuration * 0.5;
      }
      if (g.diet === 'Scavenger') {
        return item.phase !== 'sinking';
      }
      return false;
    }

    if (a.lifeStage === 'spawn') {
      return item.kind === 'propagule' || (g.diet === 'Scavenger' && item.kind === 'corpse' && a.energy < 70);
    }

    if (a.lifeStage === 'instar') {
      return (
        item.kind === 'corpse' || item.kind === 'propagule' || (item.kind === 'egg' && a.energy < 78)
      );
    }

    return (
      (g.diet === 'Scavenger' && item.kind === 'corpse') ||
      (g.diet === 'Omnivore' &&
        (item.kind === 'corpse' || item.kind === 'egg' || item.kind === 'propagule')) ||
      ((g.diet === 'Herbivore' || g.diet === 'Filter_Feeder') && item.kind === 'propagule') ||
      (g.diet === 'Carnivore' &&
        ((item.kind === 'corpse' && a.energy < 98) ||
          (item.kind === 'egg' && a.energy < 65)))
    );
  }

  private performCombatStrike(ctx: SimulationContext, attacker: AnimalEntity, defender: AnimalEntity): void {
    const ag = attacker.genome;
    const dg = defender.genome;

    attacker.attackCooldown = ag.physiology === 'hyper_metabolic' ? 0.86 : 1.05;
    attacker.biteCooldown = Math.max(attacker.biteCooldown, 0.72);
    attacker.jawGape = 0; // Jaws clamp shut decisively on impact
    attacker.biteAnim = 1.0;
    attacker.lungeAnim = 1.0;
    attacker.thrashAnim = 1.0;

    const atkMods = getStageBehaviorModifiers(attacker.lifeStage, attacker.maturity);
    let dmg = ag.attackPower * atkMods.attackMult * randRange(0.85, 1.22);
    if (ag.combat === 'Ambush') dmg *= 1.22;
    else if (ag.combat === 'Electric_Pulse') dmg *= 1.12;
    if (ag.functionalPart === 'mandibles') dmg *= 1.1;
    if (ag.functionalPart === 'venom_barbs' && dg.physiology !== 'toxin_resistant') {
      dmg *= 1.16;
    }

    // Defensive armor & integument mitigation
    let mitigation = dg.armorDensity * 0.28;
    if (dg.bodyPlan === 'armored_trilopod') mitigation += 0.2;
    if (dg.integument === 'chitin_carapace') mitigation += 0.14;
    else if (dg.integument === 'plated_scales') mitigation += 0.08;
    if (dg.functionalPart === 'armored_scutes') mitigation += 0.12;
    if (dg.combat === 'Armor_Brace') mitigation += 0.16;
    dmg *= 1.0 - clamp(mitigation, 0, 0.58);

    defender.hp -= dmg;
    defender.hitFlash = 0.28;

    // Physical impact knockback & slight predatory recoil tug
    this._ejectDir.subVectors(defender.position, attacker.position);
    if (safeNormalize(this._ejectDir)) {
      const knock = dg.combat === 'Armor_Brace' ? 0.8 : 1.45;
      defender.velocity.addScaledVector(this._ejectDir, knock);
      attacker.velocity.addScaledVector(this._ejectDir, dg.combat === 'Armor_Brace' ? -0.95 : -0.42);
    }

    const mouthPos = this.computeMouthPos(attacker, this._mouthPos);
    const impactPos = this._bitePos.lerpVectors(mouthPos, defender.position, 0.45);

    // Bioelectric stun discharge (attacker or defender)
    if (ag.combat === 'Electric_Pulse' || ag.functionalPart === 'electro_organs') {
      defender.velocity.multiplyScalar(0.35);
      ctx.events.emit('fx:burst', {
        position: impactPos.clone(),
        colorHex: 0x38f9ff,
        count: 7,
        speed: 1.9,
      });
    }
    if (dg.combat === 'Electric_Pulse') {
      attacker.hp -= 5.5;
      attacker.velocity.multiplyScalar(0.35);
      attacker.hitFlash = 0.24;
      ctx.events.emit('fx:burst', {
        position: defender.position.clone(),
        colorHex: 0x38f9ff,
        count: 8,
        speed: 2.1,
      });
    }

    // Defensive ink cloud bursts when struck
    if (dg.combat === 'Ink_Cloud' && defender.hp > 0) {
      defender.velocity.addScaledVector(this._ejectDir, 1.35);
      ctx.events.emit('fx:burst', {
        position: defender.position.clone(),
        colorHex: 0x1b2640,
        count: 10,
        speed: 1.4,
      });
    }

    // Retaliatory spines / venom / dermal toxicity (countered by toxin_resistant physiology!)
    const hasSpines =
      dg.combat === 'Venom_Spines' ||
      dg.functionalPart === 'venom_barbs' ||
      dg.integument === 'spined_dermal';
    const toxinPotency = dg.toxicity ?? 0;
    if (hasSpines || toxinPotency > 0.35) {
      const resist = ag.physiology === 'toxin_resistant' ? 0.25 : 1.0;
      const recoilDmg = ((hasSpines ? 6.5 : 0) + toxinPotency * 7.5) * resist;
      if (recoilDmg > 0.8) {
        attacker.hp -= recoilDmg;
        attacker.hitFlash = 0.22;
        ctx.events.emit('fx:burst', {
          position: defender.position.clone(),
          colorHex: 0xa8ff4d,
          count: 6,
          speed: 1.6,
        });
      }
    }

    // Fine torn tissue spray + shreds pulled directly into the predator's gulping jaws
    ctx.events.emit('fx:fragments', {
      position: impactPos.clone(),
      colorHex: dg.baseHex,
      accentHex: dg.accentHex,
      kind: 'flesh',
      count: 5,
      speed: 1.9,
      suctionTarget: mouthPos.clone(),
      ejectDir: this._ejectDir.clone(),
    });

    // Subtle organic ichor / bioluminescent blood mist
    ctx.events.emit('fx:burst', {
      position: impactPos.clone(),
      colorHex: 0xe6495c,
      count: 6,
      speed: 1.45,
    });
    ctx.events.emit('audio:cue', { type: 'strike' });

    // Attacker holds a torn piece of the victim in its jaws, chews & swallows it
    attacker.mouthMorselTimer = 1.05;
    attacker.mouthMorselMaxTimer = 1.05;
    attacker.mouthMorselColor = dg.baseHex;
    attacker.mouthMorselKind = 'flesh';

    // Every substantial bite rips loose an intact edible flesh chunk that tumbles & sinks!
    if (dmg >= 4.0 && defender.hp > 0) {
      this._scrapVel.set(
        -this._ejectDir.x * 0.45 + randRange(-0.75, 0.75),
        randRange(0.05, 0.55),
        -this._ejectDir.z * 0.45 + randRange(-0.75, 0.75)
      );
      ctx.spawnTornMorsel(
        impactPos,
        this._scrapVel,
        Math.random() < 0.6 ? dg.baseHex : dg.accentHex,
        'flesh',
        randRange(9, 15),
        clamp(0.72 + defender.scale * 0.46, 0.65, 1.28),
        dg.speciesName
      );
    }

    if (defender.hp <= 0 && defender.alive) {
      attacker.energy = Math.min(
        attacker.maxEnergy,
        attacker.energy + 32 * (ag.metabolicEfficiency ?? 1.0)
      );
      attacker.mouthMorselTimer = 1.55;
      attacker.mouthMorselMaxTimer = 1.55;
      attacker.thrashAnim = 1.0;

      // Dramatic kill tear: blood mist + 2-4 intact sinking edible flesh chunks!
      ctx.events.emit('fx:fragments', {
        position: defender.position.clone(),
        colorHex: dg.baseHex,
        accentHex: dg.accentHex,
        kind: 'flesh',
        count: 7,
        speed: 2.25,
        suctionTarget: mouthPos.clone(),
      });
      ctx.events.emit('audio:cue', { type: 'tear' });

      const scrapCount = defender.scale > 0.8 ? 4 : defender.scale > 0.5 ? 3 : 1;
      for (let s = 0; s < scrapCount; s++) {
        this._scrapVel.set(randRange(-1.15, 1.15), randRange(0.05, 0.78), randRange(-1.15, 1.15));
        ctx.spawnTornMorsel(
          defender.position,
          this._scrapVel,
          s % 2 === 0 ? dg.baseHex : dg.accentHex,
          'flesh',
          randRange(13, 22),
          clamp(randRange(0.8, 1.22) * (0.72 + defender.scale * 0.42), 0.62, 1.55),
          dg.speciesName
        );
      }

      ctx.log(
        `${ag.speciesName} hunted ${dg.speciesName}`,
        'predation',
        'text-rose-300'
      );
      ctx.transitionAnimalToCorpse(defender, `hunted by ${ag.speciesName}`);
    }
  }

  private performFeedingBite(ctx: SimulationContext, a: AnimalEntity, food: Entity, bitePoint: THREE.Vector3): void {
    const ag = a.genome;
    const mouthPos = this.computeMouthPos(a, this._mouthPos);
    this._ejectDir.subVectors(a.position, bitePoint);
    safeNormalize(this._ejectDir);
    const cdMult = ag.physiology === 'hyper_metabolic' ? 0.84 : 1.0;
    const eff = ag.metabolicEfficiency ?? 1.0;

    // Jaws snap decisively shut at the moment of bite contact
    a.jawGape = 0;

    if (food.kind === 'plant') {
      const pg = food.genome;
      // Herbivore bite-and-tug: whips the plant fronds, rips fluttering leaf/kelp ribbons!
      let chunkScale = 1.0;
      if (pg.defense === 'calcified_thorns' || pg.leafMorphology === 'crystalline_lattice') {
        chunkScale *= 0.64;
      } else if (pg.defense === 'mucus_sheath' || pg.leafMorphology === 'serrated_frond') {
        chunkScale *= 0.82;
      }

      const chunk = Math.min(food.biomass, randRange(7.5, 11.5) * chunkScale);
      food.biomass -= chunk;
      food.rustleAnim = 1.0;

      a.energy = Math.min(a.maxEnergy, a.energy + chunk * 1.95 * eff);
      a.biteCooldown = randRange(0.66, 0.96) * cdMult;
      a.biteAnim = 1.0;
      a.lungeAnim = 0.88;
      a.thrashAnim = 0.8;
      a.mouthMorselTimer = 1.25;
      a.mouthMorselMaxTimer = 1.25;
      a.mouthMorselColor = pg.accentHex;
      a.mouthMorselKind = 'flora';

      // Plant anti-herbivory defenses driving herbivore co-evolution!
      if (pg.defense === 'alkaloid_toxin' || (pg.toxicity ?? 0) > 0.45) {
        if (ag.physiology !== 'toxin_resistant') {
          const toxDmg = 2.5 + (pg.toxicity ?? 0.4) * 5.2;
          a.hp -= toxDmg;
          a.hitFlash = 0.22;
          a.velocity.addScaledVector(this._ejectDir, 1.4);
          ctx.events.emit('fx:burst', {
            position: bitePoint.clone(),
            colorHex: 0xb9ff4a,
            count: 5,
            speed: 1.4,
          });
        }
      } else if (pg.defense === 'calcified_thorns') {
        const thornDmg = 3.6 * (1.0 - clamp(ag.armorDensity * 0.7, 0, 0.7));
        a.hp -= thornDmg;
        a.hitFlash = 0.16;
      } else if (pg.defense === 'biolum_flash') {
        a.velocity.addScaledVector(this._ejectDir, 1.35);
        ctx.events.emit('fx:burst', {
          position: bitePoint.clone(),
          colorHex: pg.glowHex,
          count: 9,
          speed: 2.0,
        });
      }

      // Tug-back recoil as the frond tears free
      a.velocity.addScaledVector(this._ejectDir, 0.58);

      ctx.events.emit('fx:fragments', {
        position: bitePoint.clone(),
        colorHex: pg.baseHex,
        accentHex: pg.accentHex,
        kind: 'flora',
        count: 5,
        speed: 1.45,
        suctionTarget: mouthPos.clone(),
        ejectDir: this._ejectDir.clone(),
      });
      // Delicate botanical sap/chlorophyll sparkle mist
      ctx.events.emit('fx:burst', {
        position: bitePoint.clone(),
        colorHex: pg.glowHex,
        count: 3,
        speed: 0.9,
      });
      ctx.events.emit('audio:cue', { type: 'tear' });

      // Frequently tear loose an intact drifting kelp/leaf shred that flutters down & settles on the seabed
      if (Math.random() < 0.65 && food.biomass > 8) {
        food.biomass = Math.max(0, food.biomass - 3.0);
        this._scrapVel.set(
          this._ejectDir.x * 0.55 + randRange(-0.45, 0.45),
          randRange(0.18, 0.55),
          this._ejectDir.z * 0.55 + randRange(-0.45, 0.45)
        );
        ctx.spawnTornMorsel(
          bitePoint,
          this._scrapVel,
          Math.random() < 0.5 ? pg.accentHex : pg.baseHex,
          'flora',
          randRange(10, 15),
          randRange(0.9, 1.25),
          pg.speciesName
        );
      }
    } else if (food.kind === 'corpse') {
      // Scavenger/predator tear: clamps down, shakes head violently, jolts carcass, rips intact chunks loose!
      const chunk = Math.min(food.nutrients, randRange(10, 15));
      food.nutrients -= chunk;
      food.joltAnim = 1.0;

      // Physically tug & nudge the carcass slightly toward the feeder's pull
      food.velocity.addScaledVector(this._ejectDir, 0.48);
      food.velocity.y += 0.18;

      a.energy = Math.min(a.maxEnergy, a.energy + chunk * 2.1 * eff);
      a.biteCooldown = randRange(0.72, 1.06) * cdMult;
      a.biteAnim = 1.0;
      a.lungeAnim = 0.95;
      a.thrashAnim = 1.0;
      a.mouthMorselTimer = 1.38;
      a.mouthMorselMaxTimer = 1.38;
      a.mouthMorselColor = food.genome.baseHex;
      a.mouthMorselKind = 'flesh';

      // Residual flesh toxicity slightly wears down non-resistant scavengers
      if ((food.genome.toxicity ?? 0) > 0.42 && ag.physiology !== 'toxin_resistant') {
        a.hp -= food.genome.toxicity * 3.5;
        a.hitFlash = 0.16;
      }

      // Recoil pull-back as a strip of flesh rips loose
      a.velocity.addScaledVector(this._ejectDir, 0.72);

      ctx.events.emit('fx:fragments', {
        position: bitePoint.clone(),
        colorHex: food.genome.baseHex,
        accentHex: food.genome.accentHex,
        kind: 'flesh',
        count: 6,
        speed: 1.75,
        suctionTarget: mouthPos.clone(),
        ejectDir: this._ejectDir.clone(),
      });
      ctx.events.emit('fx:burst', {
        position: bitePoint.clone(),
        colorHex: 0xd9485f,
        count: 5,
        speed: 1.15,
      });
      ctx.events.emit('audio:cue', { type: 'tear' });

      // Reliably rip loose 1-2 intact edible chunks that tumble, sink, and attract other scavengers & predators!
      if (food.nutrients > 4 && Math.random() < 0.85) {
        const pieces = food.nutrients > 22 && Math.random() < 0.3 ? 2 : 1;
        for (let s = 0; s < pieces; s++) {
          const scrapNutr = Math.min(food.nutrients, randRange(10, 17));
          food.nutrients = Math.max(0, food.nutrients - scrapNutr * 0.55);
          this._scrapVel.set(
            this._ejectDir.x * 0.65 + randRange(-0.62, 0.62),
            randRange(0.22, 0.72),
            this._ejectDir.z * 0.65 + randRange(-0.62, 0.62)
          );
          ctx.spawnTornMorsel(
            bitePoint,
            this._scrapVel,
            (s === 0 ? Math.random() < 0.55 : false) ? food.genome.baseHex : food.genome.accentHex,
            'flesh',
            scrapNutr,
            clamp(0.82 + food.genome.sizeScale * 0.35, 0.8, 1.38),
            food.genome.speciesName
          );
        }
      }
    } else if (food.kind === 'pellet') {
      // Intact torn chunk or pellet: small feeders tear a bite off big flesh chunks; larger feeders gulp whole!
      const isLargeChunk = food.origin === 'flesh' && food.nutrients > 14 && a.scale < 0.56;

      if (isLargeChunk) {
        const biteNutr = Math.min(food.nutrients - 4, randRange(9, 13));
        food.nutrients -= biteNutr;
        // Physically yank & spin the remaining intact chunk so it tumbles/re-settles!
        food.velocity.addScaledVector(this._ejectDir, 0.55);
        food.velocity.y += 0.28;
        food.angularVelocity.set(randRange(-3.4, 3.4), randRange(-3.4, 3.4), randRange(-3.4, 3.4));

        a.energy = Math.min(a.maxEnergy, a.energy + biteNutr * 1.15 * eff);
        a.hp = Math.min(a.maxHp, a.hp + 3.5);
        a.biteCooldown = randRange(0.58, 0.85) * cdMult;
        a.biteAnim = 1.0;
        a.lungeAnim = 0.86;
        a.thrashAnim = 0.82;
        a.mouthMorselTimer = 1.18;
        a.mouthMorselMaxTimer = 1.18;
        a.mouthMorselColor = food.colorHex;
        a.mouthMorselKind = food.origin;
        a.velocity.addScaledVector(this._ejectDir, 0.45);

        ctx.events.emit('fx:fragments', {
          position: food.position.clone(),
          colorHex: food.colorHex,
          kind: food.origin,
          count: 4,
          speed: 1.25,
          suctionTarget: mouthPos.clone(),
          ejectDir: this._ejectDir.clone(),
        });
        ctx.events.emit('fx:burst', {
          position: food.position.clone(),
          colorHex: 0xd9485f,
          count: 3,
          speed: 0.9,
        });
        ctx.events.emit('audio:cue', { type: 'tear' });
      } else {
        // Decisive full gulp & chew of the intact piece
        a.energy = Math.min(a.maxEnergy, a.energy + Math.max(4, food.nutrients) * eff);
        a.hp = Math.min(a.maxHp, a.hp + 5);
        a.biteCooldown = 0.5 * cdMult;
        a.biteAnim = 1.0;
        a.lungeAnim = 0.84;
        a.thrashAnim = food.origin === 'flesh' ? 0.62 : 0.32;
        a.mouthMorselTimer = food.origin === 'flesh' ? 1.15 : 0.88;
        a.mouthMorselMaxTimer = a.mouthMorselTimer;
        a.mouthMorselColor = food.colorHex;
        a.mouthMorselKind = food.origin;

        ctx.events.emit('fx:fragments', {
          position: food.position.clone(),
          colorHex: food.colorHex,
          kind: food.origin,
          count: 5,
          speed: 1.25,
          suctionTarget: mouthPos.clone(),
        });
        ctx.events.emit('fx:burst', {
          position: food.position.clone(),
          colorHex: food.colorHex,
          count: 3,
          speed: 0.95,
        });
        ctx.events.emit('audio:cue', { type: 'tear' });
        ctx.disposeEntity(food);
      }
    } else if (food.kind === 'egg' || food.kind === 'propagule') {
      const col = food.genome.glowHex;
      a.energy = Math.min(a.maxEnergy, a.energy + food.nutrients * eff);
      a.biteCooldown = 0.52 * cdMult;
      a.biteAnim = 1.0;
      a.lungeAnim = 0.78;
      a.mouthMorselTimer = 0.8;
      a.mouthMorselMaxTimer = 0.8;
      a.mouthMorselColor = col;
      a.mouthMorselKind = food.kind === 'propagule' ? 'flora' : 'flesh';

      ctx.events.emit('fx:fragments', {
        position: food.position.clone(),
        colorHex: col,
        kind: food.kind === 'propagule' ? 'flora' : 'flesh',
        count: 5,
        speed: 1.2,
        suctionTarget: mouthPos.clone(),
      });
      ctx.events.emit('audio:cue', { type: 'tear' });
      ctx.disposeEntity(food);
    }
  }

  update(ctx: SimulationContext, dt: number): void {
    const steer = this._steer;
    const desired = this._desired;
    const sep = this._sep;
    const align = this._align;
    const coh = this._coh;
    const cur = this._current;
    const daylight = computeDaylightFactor(ctx.env.timeOfDay);

    for (let i = ctx.animals.length - 1; i >= 0; i--) {
      const a = ctx.animals[i];
      if (!a.alive) {
        ctx.animals.splice(i, 1);
        continue;
      }

      const g = a.genome;
      a.age += dt;
      a.reproCooldown = Math.max(0, a.reproCooldown - dt);
      a.attackCooldown = Math.max(0, a.attackCooldown - dt);
      a.biteCooldown = Math.max(0, a.biteCooldown - dt);
      a.hitFlash = Math.max(0, a.hitFlash - dt);
      a.biteAnim = Math.max(0, a.biteAnim - dt * 2.8);
      a.thrashAnim = Math.max(0, a.thrashAnim - dt * 1.65);
      a.lungeAnim = Math.max(0, a.lungeAnim - dt * 2.45);
      a.mouthMorselTimer = Math.max(0, a.mouthMorselTimer - dt);
      a.moltAnim = Math.max(0, a.moltAnim - dt * 1.35);
      if (a.mouthMorselTimer > 0.01) {
        a.chewPhase = (a.chewPhase + dt * 15.5) % (Math.PI * 200);
      }

      let targetJawGape = 0;

      // Defined lifecycle progression: Live Spawn -> Larva / Instar (I..III) -> Adult
      if (a.maturity < 1.0) {
        const nutritionRate = a.energy > 58 ? 1.25 : a.energy > 30 ? 0.92 : 0.36;
        const physRate = g.physiology === 'hyper_metabolic' ? 1.16 : 1.0;
        const baseGrowthRate =
          a.lifeStage === 'spawn' ? 0.024 : a.lifeStage === 'adult' ? 0.016 : 0.021;
        a.maturity = clamp(a.maturity + dt * baseGrowthRate * nutritionRate * physRate, 0.02, 1.0);

        const nextStage = getLifeStageFromMaturity(g, a.maturity);
        const nextInstar = getInstarRank(a.maturity);

        if (nextStage !== a.lifeStage) {
          const becameAdult = nextStage === 'adult';
          const wasInstar = a.lifeStage === 'instar';
          a.lifeStage = nextStage;
          a.instarRank = nextInstar;
          a.stage = getStageDisplayLabel(g, nextStage, a.maturity);
          a.moltAnim = 1.0;

          const hpRatio = clamp(a.hp / Math.max(1, a.maxHp), 0.15, 1.0);
          a.maxHp = computeStageMaxHp(g, nextStage, a.maturity);
          a.hp = Math.min(a.maxHp, a.maxHp * hpRatio + a.maxHp * 0.1);
          if (becameAdult) {
            a.reproCooldown = Math.min(a.reproCooldown, 8.0);
          }

          ctx.events.emit('fx:burst', {
            position: a.position.clone(),
            colorHex: becameAdult && wasInstar ? 0xd6f5ff : g.glowHex,
            count: becameAdult ? 9 : 5,
            speed: becameAdult ? 1.4 : 1.0,
          });
        } else if (a.lifeStage === 'instar' && nextInstar > a.instarRank) {
          // Arthropod ecdysis molt step (Instar I -> II -> III)
          a.instarRank = nextInstar;
          a.stage = getStageDisplayLabel(g, a.lifeStage, a.maturity);
          a.moltAnim = 0.85;
          const newMaxHp = computeStageMaxHp(g, a.lifeStage, a.maturity);
          if (newMaxHp > a.maxHp) {
            a.hp = Math.min(newMaxHp, a.hp + (newMaxHp - a.maxHp) + 3);
            a.maxHp = newMaxHp;
          }
          ctx.events.emit('fx:burst', {
            position: a.position.clone(),
            colorHex: 0xc7eeff,
            count: 6,
            speed: 1.1,
          });
        } else {
          const newMaxHp = computeStageMaxHp(g, a.lifeStage, a.maturity);
          if (newMaxHp > a.maxHp) {
            a.hp = Math.min(newMaxHp, a.hp + (newMaxHp - a.maxHp));
            a.maxHp = newMaxHp;
          }
        }
      }
      a.scale = computeStageScale(g, a.lifeStage, a.maturity);

      const stageMods = getStageBehaviorModifiers(a.lifeStage, a.maturity);
      const stageSpeed = g.speed * stageMods.speedMult;
      const seabedH = getSeabedHeight(a.position.x, a.position.z);

      // Passive niche energy gains (Filter_Feeder + feather_plumes + photosymbiotic + thermophilic + larval plankton)
      let passiveGain =
        g.diet === 'Filter_Feeder' ? 1.15 + ctx.env.currentStrength * 0.25 : 0;
      if (a.lifeStage === 'spawn') {
        // Neonates absorb yolk-sac reserves & suspended micro-plankton while sheltering
        passiveGain += 0.68 + ctx.env.currentStrength * 0.14;
      } else if (a.lifeStage === 'larva') {
        passiveGain += 0.26 + ctx.env.currentStrength * 0.08;
      } else if (a.lifeStage === 'instar' && a.position.y < seabedH + 1.6) {
        // Benthic instars graze substrate biofilm while scuttling along the seabed
        passiveGain += 0.3;
      }
      if (g.appendage === 'feather_plumes') {
        passiveGain += 0.28 + ctx.env.currentStrength * 0.16;
      }
      if (g.physiology === 'photosymbiotic') {
        const sunDepth = clamp(a.position.y / Math.max(1, TANK.waterY), 0, 1);
        passiveGain += (0.45 + 1.35 * daylight) * (0.4 + 0.6 * sunDepth);
      }
      if (g.physiology === 'thermophilic' || g.sensoryOrgan === 'thermal_pits') {
        const ventDistSq = a.position.distanceToSquared(TANK.ventPos);
        const ventWarmth = Math.exp(-ventDistSq / 26.0);
        if (g.physiology === 'thermophilic') {
          passiveGain += 1.45 * ventWarmth;
          if (ventWarmth > 0.35 && a.hp < a.maxHp) {
            a.hp = Math.min(a.maxHp, a.hp + 1.2 * ventWarmth * dt);
          }
        }
      }

      // Metabolic burn scaled by physiology, armor density, toxin synthesis & metabolicEfficiency
      let physBurnMult = 1.0 / clamp(g.metabolicEfficiency ?? 1.0, 0.72, 1.34);
      if (g.physiology === 'ectothermic') physBurnMult *= 0.78;
      else if (g.physiology === 'hyper_metabolic') physBurnMult *= 1.24;
      const armorCost = (g.armorDensity ?? 0.2) * 0.14 + (g.toxicity ?? 0) * 0.1;
      const burn =
        (0.56 + stageSpeed * 0.14 + a.scale * 0.28 + armorCost) * physBurnMult * stageMods.metabolicMult;
      a.energy = clamp(a.energy + (passiveGain - burn) * dt, 0, a.maxEnergy);

      if (a.energy <= 0.1) {
        a.hp -= 3.6 * dt;
      } else if (a.energy > 65 && a.hp < a.maxHp) {
        a.hp = Math.min(a.maxHp, a.hp + 1.45 * dt);
      }

      if (a.hp <= 0 || a.age >= g.maxAge) {
        ctx.transitionAnimalToCorpse(a, a.hp <= 0 ? 'starvation/injuries' : 'old age');
        ctx.animals.splice(i, 1);
        continue;
      }

      // Sensory organ effective vision range
      const hasElectro =
        g.sensoryOrgan === 'electroreception' || g.functionalPart === 'electro_organs';
      let effectiveVision = g.visionRange * stageMods.visionMult;
      if (g.sensoryOrgan === 'binocular_optics') {
        effectiveVision *= 0.92 + daylight * 0.24;
      } else if (hasElectro) {
        effectiveVision *= 1.12;
      } else if (g.sensoryOrgan === 'lateral_sonar') {
        effectiveVision *= 1.06;
      }

      const nearAnimals = ctx.animalGrid.query(
        a.position.x,
        a.position.y,
        a.position.z,
        effectiveVision,
        this._qAnimals
      );

      let threat: AnimalEntity | null = null;
      let threatDistSq = Infinity;
      let prey: AnimalEntity | null = null;
      let preyDistSq = Infinity;
      let rival: AnimalEntity | null = null;
      let rivalDistSq = Infinity;
      let mate: AnimalEntity | null = null;
      let mateDistSq = Infinity;
      let kinAdult: AnimalEntity | null = null;
      let kinAdultDistSq = Infinity;

      sep.set(0, 0, 0);
      align.set(0, 0, 0);
      coh.set(0, 0, 0);
      let flockN = 0;

      const canBreed =
        stageMods.canBreed &&
        a.energy > 86 &&
        a.reproCooldown <= 0 &&
        ctx.animals.length < CAPS.maxAnimals;

      for (let j = 0; j < nearAnimals.length; j++) {
        const o = nearAnimals[j];
        if (o === a || !o.alive) continue;
        const dSq = a.position.distanceToSquared(o.position);
        if (dSq < 1e-6) continue;

        if (dSq < 2.25) {
          desired.subVectors(a.position, o.position);
          if (safeNormalize(desired)) {
            sep.addScaledVector(desired, 1.0 / Math.max(0.35, Math.sqrt(dSq)));
          }
        }

        const sameSpecies = o.genome.speciesId === g.speciesId;
        if (sameSpecies) {
          // Live Spawn and Larvae school with kin for protection even if solitary as adults
          const shouldSchool =
            a.lifeStage === 'spawn' ||
            a.lifeStage === 'larva' ||
            g.social === 'Schooling_Boids' ||
            g.social === 'Pack_Hunter';
          if (shouldSchool) {
            align.add(o.velocity);
            coh.add(o.position);
            flockN++;
          }
          if (canBreed && o.lifeStage === 'adult' && o.energy > 72 && dSq < mateDistSq) {
            mate = o;
            mateDistSq = dSq;
          }
          if (a.lifeStage === 'spawn' && o.lifeStage === 'adult' && dSq < kinAdultDistSq) {
            kinAdult = o;
            kinAdultDistSq = dSq;
          }
        } else {
          // Translucent gel integument confers camouflage stealth against visual predators
          const camouflaged = o.genome.integument === 'translucent_gel' && !hasElectro;
          const detectLimitSq = camouflaged
            ? effectiveVision * effectiveVision * 0.52
            : effectiveVision * effectiveVision;
          if (dSq > detectLimitSq) continue;

          // Stage-aware threat assessment using actual current body scale
          const otherPred =
            a.lifeStage === 'spawn'
              ? o.scale > a.scale * stageMods.threatScaleRatio
              : a.lifeStage === 'larva' || a.lifeStage === 'instar'
              ? o.scale > a.scale * stageMods.threatScaleRatio ||
                ((o.genome.diet === 'Carnivore' || o.genome.diet === 'Omnivore') &&
                  o.scale > a.scale * 0.95)
              : (o.genome.diet === 'Carnivore' ||
                  (o.genome.diet === 'Omnivore' && o.scale > a.scale * 1.05)) &&
                o.scale > a.scale * 0.72 &&
                o.lifeStage !== 'spawn';

          // Predators without toxin_resistant avoid overtly toxic prey when not starving
          const avoidToxic =
            (o.genome.toxicity ?? 0) > 0.55 &&
            g.physiology !== 'toxin_resistant' &&
            a.energy > 42;

          const canHunt =
            stageMods.canHunt &&
            !avoidToxic &&
            ((g.diet === 'Carnivore' && o.scale <= a.scale * stageMods.maxPreyScaleRatio) ||
              (g.diet === 'Omnivore' &&
                a.energy < 80 &&
                o.scale <= a.scale * Math.min(0.9, stageMods.maxPreyScaleRatio)));

          // Thermal pits spot fast-moving warm prey more readily
          const huntDistScore =
            g.sensoryOrgan === 'thermal_pits' && o.speedRatio > 0.6 ? dSq * 0.8 : dSq;

          if (otherPred && dSq < threatDistSq) {
            threat = o;
            threatDistSq = dSq;
          } else if (canHunt && huntDistScore < preyDistSq) {
            prey = o;
            preyDistSq = huntDistScore;
          } else if (
            stageMods.canTerritorial &&
            g.social === 'Territorial' &&
            dSq < 10.0 &&
            o.lifeStage === 'adult' &&
            o.scale < a.scale * 1.25 &&
            dSq < rivalDistSq
          ) {
            rival = o;
            rivalDistSq = dSq;
          }
        }
      }

      // Check for nearby fresh sinking flesh chunks so predators can dart in & snatch torn pieces mid-water!
      let opportunisticSinkingScrap: FoodPelletEntity | null = null;
      let opportunisticScrapDistSq = Infinity;
      if (prey && (g.diet === 'Carnivore' || g.diet === 'Omnivore') && a.energy < 110) {
        const nearScraps = ctx.foodGrid.query(
          a.position.x,
          a.position.y,
          a.position.z,
          Math.min(effectiveVision * 1.15, 7.5),
          this._qFood
        );
        for (let k = 0; k < nearScraps.length; k++) {
          const item = nearScraps[k];
          if (
            item.kind === 'pellet' &&
            item.origin === 'flesh' &&
            item.phase === 'sinking' &&
            this.wantsFoodItem(g, a, item)
          ) {
            const dSq = a.position.distanceToSquared(item.position);
            if (dSq < opportunisticScrapDistSq) {
              opportunisticScrapDistSq = dSq;
              opportunisticSinkingScrap = item;
            }
          }
        }
      }

      const preferSinkingScrap =
        opportunisticSinkingScrap !== null &&
        opportunisticScrapDistSq < Math.min(preyDistSq * 0.78, 32.0);

      steer.set(0, 0, 0);
      let targetSpeed = stageSpeed * 0.76;
      a.state =
        a.lifeStage === 'spawn'
          ? 'Sheltering'
          : a.lifeStage === 'instar'
          ? 'Scuttling'
          : a.lifeStage === 'larva' && flockN > 0
          ? 'Schooling'
          : g.diet === 'Filter_Feeder'
          ? 'Filter Feeding'
          : 'Foraging';
      a.activeTarget = null;

      // Binary fission asexual reproduction (buds a tiny Live Spawn!)
      if (canBreed && g.reproduction === 'Binary_Fission' && a.energy > 96) {
        a.energy *= 0.5;
        a.reproCooldown = 28;
        a.offspringCount++;
        const { genome: cg, speciated } = recombineAnimalGenomes(
          g,
          null,
          ctx.env.mutationRateMultiplier
        );
        const childPos = a.position
          .clone()
          .add(new THREE.Vector3(randRange(-0.5, 0.5), randRange(-0.2, 0.2), randRange(-0.5, 0.5)));
        ctx.spawnAnimal(cg, childPos, 'spawn');
        ctx.events.emit('fx:burst', {
          position: a.position,
          colorHex: 0x56f7ff,
          count: 8,
          speed: 1.8,
        });
        if (speciated) {
          ctx.log(`Fission speciation: ${cg.speciesName}`, 'speciation', 'text-cyan-200');
          ctx.events.emit('audio:cue', { type: 'speciation' });
        }
      }

      // Priority behavioral state machine
      if (
        threat &&
        (a.lifeStage !== 'adult' ||
          a.hp < a.maxHp * 0.55 ||
          g.combat === 'Evasive_Dart' ||
          g.combat === 'Ink_Cloud' ||
          g.diet === 'Herbivore' ||
          g.diet === 'Filter_Feeder')
      ) {
        a.state = 'Fleeing';
        a.activeTarget = { entity: threat, role: 'threat' };
        desired.subVectors(a.position, threat.position);
        if (safeNormalize(desired)) {
          const fleeMult =
            a.lifeStage === 'spawn' ? 1.45 : g.combat === 'Evasive_Dart' ? 1.42 : 1.3;
          steer.addScaledVector(desired.multiplyScalar(stageSpeed * fleeMult).sub(a.velocity), 2.35);
          targetSpeed = stageSpeed * fleeMult;
        }
      } else if (prey && !preferSinkingScrap && (a.energy < 96 || g.diet === 'Carnivore')) {
        const dist = Math.sqrt(preyDistSq);
        a.state = dist < 1.85 ? 'Attacking' : 'Hunting';
        a.activeTarget = { entity: prey, role: 'prey' };
        desired.subVectors(prey.position, a.position);
        if (safeNormalize(desired)) {
          // Explosive strike lunge burst right before jaws connect
          const lungeMult = dist < 2.2 ? 1.42 : 1.2;
          steer.addScaledVector(desired.multiplyScalar(stageSpeed * lungeMult).sub(a.velocity), 2.25);
          targetSpeed = stageSpeed * lungeMult;
        }
        const strikeReach = Math.max(0.85, (a.scale + prey.scale) * 0.98);
        // Smooth anticipatory jaw gape opening wider as predator closes in on prey
        if (dist < strikeReach * 2.4 && a.attackCooldown <= 0.24) {
          targetJawGape = clamp(
            1.0 - (dist - strikeReach) / Math.max(0.45, strikeReach * 1.4),
            0.22,
            1.0
          );
        }
        if (dist <= strikeReach && a.attackCooldown <= 0) {
          this.performCombatStrike(ctx, a, prey);
          targetJawGape = 0;
        }
      } else if (rival && a.hp > a.maxHp * 0.45) {
        const dist = Math.sqrt(rivalDistSq);
        a.state = 'Territorial Fight';
        a.activeTarget = { entity: rival, role: 'threat' };
        desired.subVectors(rival.position, a.position);
        if (safeNormalize(desired)) {
          steer.addScaledVector(desired.multiplyScalar(stageSpeed * 1.08).sub(a.velocity), 1.6);
        }
        targetSpeed = stageSpeed * 1.08;
        const strikeReach = Math.max(0.85, (a.scale + rival.scale) * 0.96);
        if (dist < strikeReach * 2.1 && a.attackCooldown <= 0.22) {
          targetJawGape = clamp(1.0 - (dist - strikeReach) / Math.max(0.4, strikeReach), 0.2, 0.9);
        }
        if (dist <= strikeReach && a.attackCooldown <= 0) {
          this.performCombatStrike(ctx, a, rival);
          targetJawGape = 0;
        }
      } else if (mate && canBreed && !preferSinkingScrap) {
        const dist = Math.sqrt(mateDistSq);
        a.state = 'Breeding';
        a.activeTarget = { entity: mate, role: 'mate' };
        desired.subVectors(mate.position, a.position);
        if (safeNormalize(desired)) {
          steer.addScaledVector(desired.multiplyScalar(stageSpeed * 0.94).sub(a.velocity), 1.55);
        }
        if (dist < Math.max(0.95, (a.scale + mate.scale) * 1.2)) {
          a.energy -= 30;
          mate.energy = Math.max(40, mate.energy - 20);
          a.reproCooldown = 26;
          mate.reproCooldown = 22;
          a.offspringCount++;
          mate.offspringCount++;
          const { genome: cg, speciated } = recombineAnimalGenomes(
            g,
            mate.genome,
            ctx.env.mutationRateMultiplier
          );
          if (g.reproduction === 'Egg_Layer') {
            // Lay 1-2 incubating eggs that hatch into Larva or Instar
            ctx.spawnEgg(cg, a.position.clone().add(new THREE.Vector3(0, -0.15, 0)));
            if (Math.random() < 0.45 && ctx.eggs.length < CAPS.maxEggs) {
              ctx.spawnEgg(
                cg,
                a.position.clone().add(new THREE.Vector3(randRange(-0.28, 0.28), -0.22, randRange(-0.28, 0.28)))
              );
            }
          } else {
            // Live birth spawns tiny Live Spawn neonates that grow into Larva / Instar -> Adult
            ctx.spawnAnimal(
              cg,
              a.position.clone().add(new THREE.Vector3(randRange(-0.4, 0.4), 0, randRange(-0.4, 0.4))),
              'spawn'
            );
          }
          ctx.events.emit('fx:burst', {
            position: a.position,
            colorHex: 0xff85c8,
            count: 7,
            speed: 1.5,
          });
          if (speciated) {
            ctx.log(`Hybrid species evolved: ${cg.speciesName}`, 'speciation', 'text-pink-300');
            ctx.events.emit('audio:cue', { type: 'speciation' });
          }
        }
      } else if (a.energy < 114 || preferSinkingScrap) {
        let food: Entity | null = preferSinkingScrap ? opportunisticSinkingScrap : null;
        let bestSq = preferSinkingScrap ? opportunisticScrapDistSq * 0.36 : Infinity;

        // Chemosensory barbels greatly expand scent detection of flora, carcasses & torn scraps
        const scentMult =
          g.sensoryOrgan === 'chemo_barbels' || g.appendage === 'sensory_barbels' ? 1.42 : 1.0;

        const canGrazePlants =
          g.diet === 'Herbivore' ||
          g.diet === 'Omnivore' ||
          (a.lifeStage === 'spawn' && g.diet !== 'Carnivore') ||
          (a.lifeStage === 'larva' && g.diet === 'Filter_Feeder');

        if (!preferSinkingScrap && canGrazePlants) {
          const nearPlants = ctx.plantGrid.query(
            a.position.x,
            a.position.y,
            a.position.z,
            effectiveVision * scentMult,
            this._qPlants
          );
          for (let k = 0; k < nearPlants.length; k++) {
            const pl = nearPlants[k];
            if (!pl.alive || pl.wilting || pl.biomass < 16) continue;
            // Non-resistant grazers prefer non-toxic, non-thorny flora when available
            let penalty = 1.0;
            if (pl.genome.defense === 'alkaloid_toxin' && g.physiology !== 'toxin_resistant') {
              penalty = 2.6;
            } else if (pl.genome.defense === 'calcified_thorns' && g.armorDensity < 0.45) {
              penalty = 1.65;
            }
            const dSq = a.position.distanceToSquared(pl.position) * penalty;
            if (dSq < bestSq) {
              bestSq = dSq;
              food = pl;
            }
          }
        }

        if (!preferSinkingScrap) {
          const nearFood = ctx.foodGrid.query(
            a.position.x,
            a.position.y,
            a.position.z,
            effectiveVision * 1.25 * scentMult,
            this._qFood
          );
          for (let k = 0; k < nearFood.length; k++) {
            const item = nearFood[k];
            if (!this.wantsFoodItem(g, a, item)) continue;

            // Prioritize sinking torn chunks & pellets for exciting mid-water feeding interceptions;
            // scavengers also strongly prioritize intact seabed scraps & carcasses!
            let weight = 1.0;
            if (item.kind === 'pellet') {
              if (item.phase === 'sinking') {
                weight = item.origin === 'flesh' ? 0.38 : 0.48;
              } else if (item.phase === 'resting') {
                weight = g.diet === 'Scavenger' ? 0.55 : 0.72;
              } else {
                weight = g.diet === 'Scavenger' ? 0.85 : 1.25;
              }
            }
            const dSq = a.position.distanceToSquared(item.position) * weight;
            if (dSq < bestSq) {
              bestSq = dSq;
              food = item;
            }
          }
        }

        if (food) {
          a.state =
            food.kind === 'corpse'
              ? 'Scavenging'
              : food.kind === 'pellet'
              ? food.phase === 'sinking'
                ? 'Intercepting'
                : 'Feeding'
              : 'Grazing';
          a.activeTarget = { entity: food, role: 'food' };

          // Aim cleanly at frond canopy for plants, body center for corpses, or predicted intercept for sinking chunks
          this._bitePos.copy(food.position);
          if (food.kind === 'plant') {
            this._bitePos.y += food.genome.maxHeight * food.growth * 0.48;
          } else if (food.kind === 'corpse') {
            this._bitePos.y += 0.12;
          } else if (food.kind === 'pellet' && food.phase === 'sinking') {
            const rawDist = a.position.distanceTo(food.position);
            const leadT = clamp(rawDist / Math.max(1.4, stageSpeed * 1.2), 0, 0.55);
            this._bitePos.addScaledVector(food.velocity, leadT);
            const bedFloor = getSeabedHeight(this._bitePos.x, this._bitePos.z) + 0.08;
            if (this._bitePos.y < bedFloor) this._bitePos.y = bedFloor;
          }

          desired.subVectors(this._bitePos, a.position);
          const dist = desired.length();
          if (safeNormalize(desired)) {
            const mult =
              food.kind === 'pellet'
                ? food.phase === 'sinking'
                  ? 1.28
                  : 1.08
                : dist < 1.55 && a.biteCooldown > 0.25
                ? 0.45 // Hover/circle slightly while chewing between discrete bites!
                : 1.02;
            steer.addScaledVector(desired.multiplyScalar(stageSpeed * mult).sub(a.velocity), 1.95);
            targetSpeed = stageSpeed * Math.max(0.55, mult);
          }

          const biteReach = Math.max(0.85, 0.78 + a.scale * 0.55);
          // Smooth anticipatory jaw gape opening wider as mouth approaches the food piece
          if (dist < biteReach * 2.35 && a.biteCooldown <= 0.24) {
            targetJawGape = clamp(
              1.0 - (dist - biteReach) / Math.max(0.4, biteReach * 1.35),
              0.2,
              1.0
            );
          }

          // Use actual current distance to food (not lead point) for accurate bite contact!
          const actualDist =
            food.kind === 'pellet' ? a.position.distanceTo(food.position) : dist;
          if (actualDist < biteReach && a.biteCooldown <= 0) {
            this.performFeedingBite(
              ctx,
              a,
              food,
              food.kind === 'pellet' ? food.position : this._bitePos
            );
            targetJawGape = 0;
          }
        }
      }

      // Smoothly animate anticipatory jaw gape (opens smoothly on approach, snaps shut fast on bite)
      const gapeRate = targetJawGape > a.jawGape ? 7.5 : 14.0;
      a.jawGape += (targetJawGape - a.jawGape) * clamp(dt * gapeRate, 0, 1);

      // Flocking cohesion + alignment (lateral_sonar tightens schooling! Larvae & Spawn school more tightly)
      if (flockN > 0 && a.state !== 'Fleeing' && a.state !== 'Attacking') {
        const sonarBoost =
          (g.sensoryOrgan === 'lateral_sonar' ? 1.35 : 1.0) * stageMods.schoolingMult;
        align.divideScalar(flockN);
        if (safeNormalize(align)) {
          steer.addScaledVector(align.multiplyScalar(stageSpeed).sub(a.velocity), 0.48 * sonarBoost);
        }
        coh.divideScalar(flockN).sub(a.position);
        if (safeNormalize(coh)) {
          steer.addScaledVector(coh.multiplyScalar(stageSpeed).sub(a.velocity), 0.36 * sonarBoost);
        }
      }
      steer.addScaledVector(sep, 2.25);

      // Gentle wandering + vertical depth niche preference (+ vent affinity for thermophiles)
      a.wanderTimer -= dt;
      if (a.wanderTimer <= 0) {
        a.wanderTimer = randRange(1.8, 4.2);
        a.wanderDir.set(randRange(-1, 1), randRange(-0.24, 0.24), randRange(-1, 1));
        // Softly weight new wander headings back toward the productive reef core near/beyond soft bounds
        const wr = Math.hypot(a.position.x, a.position.z);
        if (wr > TANK.coreRadius * 0.8 && wr > 1e-4) {
          const inwardBias = clamp((wr - TANK.coreRadius * 0.8) / (TANK.radius - TANK.coreRadius * 0.5), 0, 1.35);
          a.wanderDir.x -= (a.position.x / wr) * inwardBias;
          a.wanderDir.z -= (a.position.z / wr) * inwardBias;
        }
        safeNormalize(a.wanderDir);
      }
      if (!a.activeTarget) {
        if (a.lifeStage === 'spawn') {
          // Live Spawn neonates seek shelter near safe flora canopies or trail conspecific adults
          let shelterPlant: any = null;
          let shelterDistSq = Infinity;
          const nearCover = ctx.plantGrid.query(
            a.position.x,
            a.position.y,
            a.position.z,
            effectiveVision * 1.4,
            this._qPlants
          );
          for (let k = 0; k < nearCover.length; k++) {
            const pl = nearCover[k];
            if (!pl.alive || pl.wilting || pl.genome.metabolism === 'Carnivorous_Flora') continue;
            const dSq = a.position.distanceToSquared(pl.position);
            if (dSq < shelterDistSq) {
              shelterDistSq = dSq;
              shelterPlant = pl;
            }
          }
          if (shelterPlant && shelterDistSq > 1.3) {
            a.state = 'Sheltering';
            desired.set(
              shelterPlant.position.x - a.position.x,
              shelterPlant.position.y + Math.max(0.55, shelterPlant.scale * 0.8) - a.position.y,
              shelterPlant.position.z - a.position.z
            );
            if (safeNormalize(desired)) steer.addScaledVector(desired, 0.85);
          } else if (kinAdult && kinAdultDistSq > 1.8) {
            a.state = 'Following Kin';
            desired.subVectors(kinAdult.position, a.position);
            if (safeNormalize(desired)) steer.addScaledVector(desired, 0.78);
          } else {
            steer.addScaledVector(a.wanderDir, 0.55);
          }
        } else {
          steer.addScaledVector(a.wanderDir, 0.65);
          // Stage-specific depth niche: Larvae disperse in pelagic plankton layers; Instars hug benthic cover!
          const prefY =
            a.lifeStage === 'instar'
              ? seabedH + 0.68
              : a.lifeStage === 'larva'
              ? TANK.waterY * 0.64
              : g.physiology === 'photosymbiotic'
              ? TANK.waterY - 2.3
              : g.depthPref === 'surface'
              ? TANK.waterY - 2.6
              : g.depthPref === 'benthic'
              ? seabedH + 1.45
              : TANK.waterY * 0.52;
          steer.y += clamp((prefY - a.position.y) * (a.lifeStage === 'instar' ? 0.26 : 0.16), -0.62, 0.62);

          if (g.physiology === 'thermophilic' && a.energy < 85) {
            desired.subVectors(TANK.ventPos, a.position);
            desired.y += 2.2;
            if (desired.lengthSq() > 12.0 && safeNormalize(desired)) {
              steer.addScaledVector(desired, 0.55);
            }
          }
        }
      }

      // 3D Underwater current advection (ventral_keels stabilizes against current drift!)
      sampleWaterCurrent(
        a.position.x,
        a.position.y,
        a.position.z,
        ctx.simTime,
        ctx.env.currentStrength,
        cur
      );
      const baseDrag = g.bodyPlan === 'radial_medusa' ? 0.55 : 0.22;
      const currentDrag =
        (g.appendage === 'ventral_keels' ? baseDrag * 0.58 : baseDrag) * stageMods.currentDragMult;
      steer.addScaledVector(cur, currentDrag);

      // Invisible soft horizontal ecological bounds: smooth weighted reef-homing gradient
      // (zero pull inside coreRadius; ramps progressively past radius with gentle curved arc)
      const horizR = Math.hypot(a.position.x, a.position.z);
      const boundWeight = computeHorizontalBoundWeight(a.position.x, a.position.z);
      if (boundWeight > 0 && horizR > 1e-4) {
        const nx = a.position.x / horizR;
        const nz = a.position.z / horizR;
        const homingForce = boundWeight * 2.45;
        steer.x -= nx * homingForce;
        steer.z -= nz * homingForce;
        const crossDir = a.position.x * a.velocity.z - a.position.z * a.velocity.x >= 0 ? 1 : -1;
        const arcGlide = Math.min(boundWeight, 1.6) * 0.72 * crossDir;
        steer.x += -nz * arcGlide;
        steer.z += nx * arcGlide;
      }

      // Allow any creature actively feeding on seabed scraps/corpses to swoop down close to the sand
      const divingForBottomFood =
        a.activeTarget?.role === 'food' &&
        (a.activeTarget.entity.kind === 'pellet' || a.activeTarget.entity.kind === 'corpse') &&
        a.activeTarget.entity.position.y < seabedH + 1.25;
      const floorOffset = divingForBottomFood
        ? 0.26
        : a.lifeStage === 'instar'
        ? 0.38
        : a.lifeStage === 'spawn'
        ? 0.45
        : g.diet === 'Scavenger'
        ? 0.48
        : 1.12;
      const floorY = seabedH + floorOffset;
      if (a.position.y < floorY) steer.y += (floorY - a.position.y) * 3.9;
      else if (a.position.y > TANK.waterY - 1.15) steer.y -= (a.position.y - (TANK.waterY - 1.15)) * 3.9;

      // Record previous horizontal heading for smooth banking during turns
      this._prevFwd.copy(a.velocity);
      safeNormalize(this._prevFwd);

      const steerAgility = g.appendage === 'ventral_keels' ? 2.18 : 1.92;
      a.velocity.addScaledVector(steer, dt * steerAgility);
      const spd = a.velocity.length();
      if (spd > targetSpeed) {
        a.velocity.multiplyScalar(targetSpeed / spd);
      } else if (spd < stageSpeed * 0.26 && spd > 1e-4) {
        a.velocity.multiplyScalar((stageSpeed * 0.26) / spd);
      }

      // Compute gentle banking roll proportional to lateral turn rate (+ vigorous roll shake while tearing!)
      const nextFwd = desired.copy(a.velocity);
      safeNormalize(nextFwd);
      const turnCrossY = this._prevFwd.x * nextFwd.z - this._prevFwd.z * nextFwd.x;
      const thrashRoll =
        a.thrashAnim > 0.01 ? Math.sin(a.thrashAnim * Math.PI * 5.0) * a.thrashAnim * 0.56 : 0;
      const targetBank =
        (g.bodyPlan === 'winged_manta' || g.bodyPlan === 'fusiform_swimmer'
          ? clamp(turnCrossY * 6.5, -0.42, 0.42)
          : 0) + thrashRoll;
      a.bankAngle += (targetBank - a.bankAngle) * clamp(dt * 8.5, 0, 1);

      a.position.addScaledVector(a.velocity, dt);
      clampToTankRadius(a.position, 0.55);
      a.position.y = clamp(
        a.position.y,
        getSeabedHeight(a.position.x, a.position.z) + 0.24,
        TANK.waterY - 0.45
      );

      safeOrientToward(a.quaternion, a.velocity, clamp(dt * 5.6, 0, 1), a.bankAngle);
      ctx.enforceFiniteTransform(a);

      // Continuous phase integration for hydrodynamic articulation (boosted during lunge/thrash & faster in neonates)
      a.speedRatio = spd / Math.max(0.35, stageSpeed);
      const mod = clamp((0.86 + a.speedRatio * 0.28 + a.thrashAnim * 0.55) * stageMods.swimFreqMult, 0.84, 2.25);
      a.wingPhase = (a.wingPhase + dt * g.wingFreq * mod) % (Math.PI * 200);
      a.swimPhase = (a.swimPhase + dt * g.swimFreq * mod) % (Math.PI * 200);
      a.paddlePhase = (a.paddlePhase + dt * g.paddleFreq * mod) % (Math.PI * 200);
    }
  }
}
