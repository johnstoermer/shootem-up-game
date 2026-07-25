import * as THREE from 'three';
import { GameRenderer } from './Renderer.js';
import { Arena } from './Arena.js';
import { AudioSystem } from './AudioSystem.js';
import { BotController } from './BotController.js';
import { Interface } from './Interface.js';
import { PickupManager } from './PickupManager.js';
import { PlayerController } from './PlayerController.js';
import { VFX } from './VFX.js';
import { clamp, seededRandom, shuffle } from './math.js';
import { getArenaLoadout, WEAPONS } from './weapons.js';

const TEMP_ORIGIN = new THREE.Vector3();
const TEMP_DIRECTION = new THREE.Vector3();
const TEMP_POINT = new THREE.Vector3();
const TEMP_POINT_B = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const TEMP_UP = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function spreadDirection(direction, spread) {
  if (spread <= 0) return direction.clone();
  TEMP_RIGHT.crossVectors(direction, WORLD_UP);
  if (TEMP_RIGHT.lengthSq() < 0.001) TEMP_RIGHT.set(1, 0, 0);
  else TEMP_RIGHT.normalize();
  TEMP_UP.crossVectors(TEMP_RIGHT, direction).normalize();
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  return direction
    .clone()
    .addScaledVector(TEMP_RIGHT, Math.cos(angle) * radius)
    .addScaledVector(TEMP_UP, Math.sin(angle) * radius)
    .normalize();
}

function raySphereDistance(origin, direction, center, radius) {
  const ray = new THREE.Ray(origin, direction);
  const point = ray.intersectSphere(new THREE.Sphere(center, radius), TEMP_POINT_B);
  return point ? point.distanceTo(origin) : null;
}

export class Game {
  constructor(canvas) {
    this.ui = new Interface();
    this.weapons = WEAPONS;
    this.rendering = new GameRenderer(canvas);
    this.scene = this.rendering.scene;
    this.camera = this.rendering.camera;
    this.audio = new AudioSystem();
    this.arena = new Arena(this.scene, this.rendering.renderer);
    this.vfx = new VFX(this.scene);
    this.player = new PlayerController(this.camera, this.arena, this.audio);
    this.bot = new BotController(this.scene, this.arena, this.audio);
    this.pickups = new PickupManager(this.scene);
    this.canvas = canvas;
    this.mode = 'title';
    this.phase = 'title';
    this.phaseTimer = 0;
    this.playerRounds = 0;
    this.botRounds = 0;
    this.playerTakes = 0;
    this.botTakes = 0;
    this.roundNumber = 1;
    this.takeNumber = 1;
    this.takeTime = 45;
    this.overtime = false;
    this.overtimeTick = 0;
    this.lastCountdown = 4;
    this.pendingRoundWinner = null;
    this.projectiles = [];
    this.matchSeed = Date.now() & 0xfffffff;
    this.mapOrder = [0, 1, 2];
    this.titleTime = 0;
    this.running = true;
    this.lastFrame = performance.now();
    this.elapsed = 0;
    this.lastMovement = {
      sliding: false,
      wallRunning: false,
      sprinting: false,
      speed: 0,
    };
    this.titleMapTimer = 0;
    this.setupEvents();
    this.setupTitleScene();
    this.ui.setMuted(this.audio.muted);
    this.ui.sensitivity.value = String(this.player.sensitivity);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupEvents() {
    this.ui.startButton.addEventListener('click', () => this.startMatch());
    this.ui.resumeButton.addEventListener('click', () => this.resume());
    this.ui.restartButton.addEventListener('click', () => this.startMatch());
    this.ui.quitButton.addEventListener('click', () => this.returnToTitle());
    this.ui.rematchButton.addEventListener('click', () => this.startMatch());
    this.ui.resultQuitButton.addEventListener('click', () => this.returnToTitle());
    this.ui.audioToggle.addEventListener('click', async () => {
      await this.audio.init();
      this.ui.setMuted(this.audio.toggleMute());
    });
    this.ui.sensitivity.addEventListener('input', (event) => {
      this.player.setSensitivity(event.target.value);
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'match' && this.phase === 'playing' && !document.pointerLockElement) {
        this.requestPointerLock();
      }
    });
    window.addEventListener('resize', () => {
      const ratio = this.rendering.resize();
      this.vfx.resize(ratio);
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') {
        if (this.mode === 'title') this.startMatch();
        else if (this.mode === 'result') this.startMatch();
      }
      if (event.code === 'Escape' && this.mode === 'paused') {
        event.preventDefault();
        this.resume();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (
        !document.pointerLockElement &&
        this.mode === 'match' &&
        this.phase === 'playing'
      ) {
        this.pause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'match' && this.phase === 'playing') {
        this.pause();
      }
      this.lastFrame = performance.now();
    });
  }

  async requestPointerLock() {
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        // The player can click the canvas again if the browser rejects the first request.
      }
    }
  }

  setupTitleScene() {
    this.mode = 'title';
    this.phase = 'title';
    this.phaseTimer = 0;
    this.clearProjectiles();
    this.vfx.clear();
    this.titleTime = 0;
    this.arena.load(2, 9124);
    const loadout = getArenaLoadout(9124, 6);
    this.pickups.reset(this.arena.weaponSlots, loadout);
    this.bot.reset(new THREE.Vector3(7.2, 0.02, -4.8), 0.75, 1);
    this.bot.equip('carbine');
    this.bot.root.visible = true;
    this.player.viewRoot.visible = false;
    this.player.inputEnabled = false;
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.ui.showTitle();
  }

  async startMatch() {
    if (this.mode === 'starting') return;
    this.mode = 'starting';
    await this.audio.init();
    this.audio.click(true);
    this.mode = 'match';
    this.phase = 'loading';
    this.playerRounds = 0;
    this.botRounds = 0;
    this.playerTakes = 0;
    this.botTakes = 0;
    this.roundNumber = 1;
    this.takeNumber = 1;
    this.matchSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
    const random = seededRandom(this.matchSeed);
    this.mapOrder = shuffle([0, 1, 2], random);
    while (this.mapOrder.length < 7) {
      this.mapOrder.push(...shuffle([0, 1, 2], random));
    }
    this.ui.showHUD();
    this.player.viewRoot.visible = true;
    this.startRound();
    this.requestPointerLock();
  }

  returnToTitle() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.click();
    this.setupTitleScene();
  }

  pause() {
    if (this.mode !== 'match' || this.phase !== 'playing') return;
    this.mode = 'paused';
    this.player.inputEnabled = false;
    this.ui.showPause();
  }

  async resume() {
    if (this.mode !== 'paused') return;
    await this.audio.init();
    this.mode = 'match';
    this.ui.hidePause();
    this.requestPointerLock();
  }

  startRound() {
    this.clearProjectiles();
    this.vfx.clear();
    const mapIndex = this.mapOrder[(this.roundNumber - 1) % this.mapOrder.length];
    const mapSeed = this.matchSeed + this.roundNumber * 1009;
    const map = this.arena.load(mapIndex, mapSeed);
    const loadout = getArenaLoadout(mapSeed, 6);
    this.roundLoadout = loadout;
    this.pickups.reset(this.arena.weaponSlots, loadout);
    this.playerTakes = 0;
    this.botTakes = 0;
    this.takeNumber = 1;
    this.resetCombatants();
    this.phase = 'roundIntro';
    this.phaseTimer = 2.65;
    this.ui.showHUD();
    this.ui.showAnnouncement(map.code, map.name, map.description);
    this.updateHUD();
  }

  resetCombatants() {
    this.clearProjectiles();
    this.vfx.clear();
    this.pickups.reset(this.arena.weaponSlots, this.roundLoadout);
    this.player.reset(this.arena.getSpawn('player'), this.arena.getSpawnYaw('player'));
    const scorePressure = (this.playerRounds - this.botRounds) * 0.055;
    const difficulty = clamp(0.93 + (this.roundNumber - 1) * 0.035 + scorePressure, 0.82, 1.22);
    this.bot.reset(this.arena.getSpawn('bot'), this.arena.getSpawnYaw('bot'), difficulty);
    this.player.viewRoot.visible = true;
    this.takeTime = 45;
    this.overtime = false;
    this.overtimeTick = 0;
  }

  beginCountdown() {
    this.resetCombatants();
    this.phase = 'countdown';
    this.phaseTimer = 3.15;
    this.lastCountdown = 4;
    this.ui.showAnnouncement(
      `TAKE ${String(this.takeNumber).padStart(2, '0')}`,
      '3',
      'LAST BODY STANDING',
    );
    this.audio.countdown(3);
    this.lastCountdown = 3;
  }

  beginTake() {
    this.phase = 'playing';
    this.phaseTimer = 0;
    this.takeTime = 45;
    this.overtime = false;
    this.ui.hideAnnouncement();
    this.audio.countdown(0);
    if (!document.pointerLockElement) this.requestPointerLock();
  }

  endTake(winner) {
    if (this.phase !== 'playing') return;
    this.phase = 'takeEnd';
    this.phaseTimer = 2.15;
    if (winner === 'player') {
      this.playerTakes += 1;
      this.ui.showAnnouncement('OPPONENT DOWN', 'TAKE SECURED', `${this.playerTakes} / 2`);
      this.audio.roundResult(true);
    } else if (winner === 'bot') {
      this.botTakes += 1;
      this.ui.showAnnouncement('BODY LOST', 'TAKE CONCEDED', `${this.botTakes} / 2`);
      this.audio.roundResult(false);
    } else {
      this.ui.showAnnouncement('SIMULTANEOUS ELIMINATION', 'MUTUAL', 'TAKE REPLAY');
      this.audio.roundResult(false);
    }
    this.player.inputEnabled = false;
    this.updateHUD();
  }

  endRound() {
    const playerWon = this.playerTakes >= 2;
    if (playerWon) this.playerRounds += 1;
    else this.botRounds += 1;
    this.pendingRoundWinner = playerWon ? 'player' : 'bot';
    this.phase = 'roundEnd';
    this.phaseTimer = 2.75;
    this.ui.showAnnouncement(
      playerWon ? 'YARD CONTROLLED' : 'YARD LOST',
      playerWon ? 'ROUND WON' : 'ROUND LOST',
      `${this.playerRounds} — ${this.botRounds}`,
    );
    this.audio.roundResult(playerWon);
    this.updateHUD();
  }

  finishMatch() {
    const won = this.playerRounds >= 4;
    this.mode = 'result';
    this.phase = 'result';
    this.player.inputEnabled = false;
    this.player.viewRoot.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showResult(won, this.playerRounds, this.botRounds);
  }

  updateMatch(delta) {
    if (this.phase === 'roundIntro') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      if (this.phaseTimer <= 0) this.beginCountdown();
    } else if (this.phase === 'countdown') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.update(delta, this.elapsed, this.player, this.pickups.pickups, false);
      const value = Math.max(1, Math.ceil(this.phaseTimer));
      if (value !== this.lastCountdown && this.phaseTimer > 0.08) {
        this.lastCountdown = value;
        this.ui.showAnnouncement(
          `TAKE ${String(this.takeNumber).padStart(2, '0')}`,
          String(value),
          'LAST BODY STANDING',
        );
        this.audio.countdown(value);
      }
      if (this.phaseTimer <= 0) this.beginTake();
    } else if (this.phase === 'playing') {
      this.updatePlaying(delta);
    } else if (this.phase === 'takeEnd') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      this.updateProjectiles(delta);
      if (this.phaseTimer <= 0) {
        if (this.playerTakes >= 2 || this.botTakes >= 2) {
          this.endRound();
        } else {
          this.takeNumber += 1;
          this.beginCountdown();
        }
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      if (this.phaseTimer <= 0) {
        if (this.playerRounds >= 4 || this.botRounds >= 4) {
          this.finishMatch();
        } else {
          this.roundNumber += 1;
          this.startRound();
        }
      }
    }
  }

  updatePlaying(delta) {
    this.takeTime = Math.max(0, this.takeTime - delta);
    if (this.takeTime <= 0 && !this.overtime) {
      this.overtime = true;
      this.overtimeTick = 0;
      this.ui.showAnnouncement('TIME EXPIRED', 'OVERTIME', 'THE YARD IS BURNING');
      window.setTimeout(() => {
        if (this.phase === 'playing' && this.overtime) this.ui.hideAnnouncement();
      }, 950);
      this.audio.countdown(0);
    }

    this.lastMovement = this.player.update(delta, true);
    if (this.lastMovement.discard && this.player.discard()) {
      this.ui.showPickup('SERVICE PISTOL', this.elapsed);
    }

    const botAction = this.bot.update(
      delta,
      this.elapsed,
      this.player,
      this.pickups.pickups,
      true,
    );

    const playerPickup = this.pickups.findPlayerContact(this.player.position);
    if (playerPickup) {
      this.pickups.collect(playerPickup);
      this.player.equip(playerPickup.type);
      this.ui.showPickup(playerPickup.definition.name, this.elapsed);
      this.spawnPickupBurst(playerPickup.position, playerPickup.definition.accent);
    }
    if (botAction.pickup) {
      this.pickups.collect(botAction.pickup);
      this.spawnPickupBurst(botAction.pickup.position, botAction.pickup.definition.accent);
      const pan = this.getPan(botAction.pickup.position);
      this.audio.tone({
        frequency: 390,
        endFrequency: 610,
        duration: 0.09,
        volume: 0.035,
        type: 'square',
        pan,
      });
    }

    if (this.lastMovement.fire) this.firePlayerWeapon();
    if (botAction.fire) this.fireBotWeapon();
    this.updateProjectiles(delta);

    if (this.overtime) {
      this.overtimeTick += delta;
      if (this.overtimeTick >= 0.55) {
        this.overtimeTick -= 0.55;
        if (!this.player.dead) this.damagePlayer(5, this.bot.position, false);
        if (!this.bot.dead) {
          this.bot.damage(5);
          this.vfx.spawnBloodImpact(
            this.bot.getBodyCenter(new THREE.Vector3()),
            new THREE.Vector3(0, 1, 0),
            false,
          );
        }
        this.rendering.setDamage(0.14);
      }
    }

    if (this.player.position.y < -8 && !this.player.dead) {
      this.damagePlayer(999, this.bot.position, false);
    }
    this.resolveDeaths();
    this.updateHUD();
  }

  firePlayerWeapon() {
    const definition = this.player.definition;
    if (!this.player.canFire(this.elapsed)) {
      if (this.player.ammo <= 0) this.player.dryFire(this.elapsed);
      return;
    }

    this.player.registerShot(this.elapsed);
    this.ui.showShot(this.elapsed);
    const { origin, direction } = this.player.getAim(TEMP_ORIGIN, TEMP_DIRECTION);
    const muzzle = this.player.getMuzzlePosition(new THREE.Vector3());
    this.audio.gun(definition.sound);
    this.vfx.spawnMuzzle(
      muzzle,
      direction,
      definition.id === 'rail' ? 0x8feaff : 0xffb23d,
      definition.id === 'scatter' || definition.id === 'rail' ? 1.45 : 1,
    );

    if (definition.projectile) {
      this.spawnProjectile('player', muzzle, direction, definition);
    } else {
      let anyHit = false;
      let headshot = false;
      for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
        const spread = this.player.focused
          ? definition.focusSpread
          : definition.spread *
            (this.player.grounded ? 1 : 1.42) *
            (1 + clamp(this.lastMovement.speed / 12, 0, 0.3));
        const shotDirection = spreadDirection(direction, spread);
        const result = this.traceAgainstBot(origin, shotDirection, definition.range);
        const end = result.point;
        if (result.kind === 'bot') {
          const falloff =
            definition.id === 'scatter'
              ? clamp(1.15 - result.distance / 38, 0.32, 1)
              : 1;
          const damage =
            definition.damage *
            falloff *
            (result.headshot ? definition.headMultiplier : 1);
          this.bot.damage(damage);
          anyHit = true;
          headshot ||= result.headshot;
          this.vfx.spawnBloodImpact(
            end,
            shotDirection.clone().multiplyScalar(0.7),
            result.headshot,
          );
          this.audio.impact(true, result.headshot);
        } else if (result.kind === 'world') {
          this.vfx.spawnImpact(end, result.normal, {
            count: definition.id === 'rail' ? 24 : definition.id === 'scatter' ? 5 : 10,
            color: definition.id === 'rail' ? 0x8feaff : 0xffb043,
          });
          if (pellet === 0 || definition.pellets === 1) this.audio.impact(false);
        }
        if (pellet === 0 || definition.id === 'rail') {
          this.vfx.spawnTracer(
            muzzle,
            end,
            definition.id === 'rail' ? 0x8cefff : 0xffd277,
            definition.id === 'rail' ? 0.045 : 0.012,
            definition.id === 'rail' ? 0.15 : 0.065,
          );
        } else if (definition.id === 'scatter' && pellet < 5) {
          this.vfx.spawnTracer(muzzle, end, 0xffc56b, 0.006, 0.035);
        }
      }
      if (anyHit) this.ui.showHit(headshot, this.elapsed);
    }

    if (definition.id !== 'rocket' && definition.id !== 'rail') {
      const casing = this.player.getCasingPosition(new THREE.Vector3());
      const eject = this.player
        .getRightDirection(new THREE.Vector3())
        .multiplyScalar(1.4)
        .add(new THREE.Vector3(0, 0.25, 0));
      this.vfx.spawnShell(
        casing,
        eject,
        definition.casing,
        definition.id === 'scatter' || definition.id === 'revolver',
      );
    }
    if (definition.id === 'rail' || definition.id === 'scatter') this.ui.flash();
  }

  fireBotWeapon() {
    if (this.bot.dead || this.player.dead) return;
    const definition = this.bot.definition;
    const origin = this.bot.getEyePosition(new THREE.Vector3());
    const muzzle = this.bot.getMuzzlePosition(new THREE.Vector3());
    const baseDirection = this.bot.aimDirection.clone().normalize();
    const pan = this.getPan(muzzle);
    this.audio.gun(definition.sound, pan, true);
    this.vfx.spawnMuzzle(
      muzzle,
      baseDirection,
      definition.id === 'rail' ? 0x8feaff : 0xff8b35,
      definition.id === 'scatter' || definition.id === 'rail' ? 1.35 : 0.9,
    );
    if (definition.projectile) {
      this.spawnProjectile('bot', muzzle, baseDirection, definition);
      return;
    }

    for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
      const botSpread =
        definition.spread *
        (definition.id === 'scatter' ? 0.9 : 0.72) *
        (1.14 - this.bot.difficulty * 0.12);
      const direction = spreadDirection(baseDirection, botSpread);
      const result = this.traceAgainstPlayer(origin, direction, definition.range);
      if (result.kind === 'player') {
        const falloff =
          definition.id === 'scatter'
            ? clamp(1.12 - result.distance / 34, 0.3, 1)
            : 1;
        const damage =
          definition.damage *
          falloff *
          (result.headshot ? definition.headMultiplier : 1) *
          0.9;
        this.damagePlayer(damage, this.bot.position, result.headshot);
      } else if (result.kind === 'world') {
        this.vfx.spawnImpact(result.point, result.normal, {
          count: definition.id === 'scatter' ? 4 : 8,
          color: definition.id === 'rail' ? 0x8feaff : 0xff9b43,
          debris: pellet === 0,
        });
      }
      if (pellet === 0 || definition.id === 'rail') {
        this.vfx.spawnTracer(
          muzzle,
          result.point,
          definition.id === 'rail' ? 0x8cefff : 0xff9d5c,
          definition.id === 'rail' ? 0.04 : 0.011,
          definition.id === 'rail' ? 0.14 : 0.065,
        );
      } else if (definition.id === 'scatter' && pellet < 5) {
        this.vfx.spawnTracer(muzzle, result.point, 0xff9d5c, 0.006, 0.03);
      }
    }
  }

  traceAgainstBot(origin, direction, range) {
    const worldHit = this.arena.raycast(origin, direction, range);
    const worldDistance = worldHit?.distance ?? range;
    if (!this.bot.dead) {
      const headCenter = this.bot.getHeadCenter(new THREE.Vector3());
      const bodyCenter = this.bot.getBodyCenter(new THREE.Vector3());
      const headDistance = raySphereDistance(origin, direction, headCenter, 0.34);
      const bodyDistance = raySphereDistance(origin, direction, bodyCenter, 0.58);
      let distance = null;
      let headshot = false;
      if (headDistance != null && headDistance < worldDistance) {
        distance = headDistance;
        headshot = true;
      }
      if (
        bodyDistance != null &&
        bodyDistance < worldDistance &&
        (distance == null || bodyDistance < distance)
      ) {
        distance = bodyDistance;
        headshot = false;
      }
      if (distance != null) {
        return {
          kind: 'bot',
          distance,
          headshot,
          point: origin.clone().addScaledVector(direction, distance),
          normal: direction.clone().negate(),
        };
      }
    }
    if (worldHit) {
      return {
        kind: 'world',
        distance: worldHit.distance,
        point: worldHit.point.clone(),
        normal: worldHit.normal,
      };
    }
    return {
      kind: 'miss',
      distance: range,
      point: origin.clone().addScaledVector(direction, range),
      normal: direction.clone().negate(),
    };
  }

  traceAgainstPlayer(origin, direction, range) {
    const worldHit = this.arena.raycast(origin, direction, range);
    const worldDistance = worldHit?.distance ?? range;
    if (!this.player.dead) {
      const headCenter = this.player.position
        .clone()
        .add(new THREE.Vector3(0, this.player.cameraHeight, 0));
      const bodyCenter = this.player.position.clone().add(new THREE.Vector3(0, 0.93, 0));
      const headDistance = raySphereDistance(origin, direction, headCenter, 0.31);
      const bodyDistance = raySphereDistance(origin, direction, bodyCenter, 0.56);
      let distance = null;
      let headshot = false;
      if (headDistance != null && headDistance < worldDistance) {
        distance = headDistance;
        headshot = true;
      }
      if (
        bodyDistance != null &&
        bodyDistance < worldDistance &&
        (distance == null || bodyDistance < distance)
      ) {
        distance = bodyDistance;
        headshot = false;
      }
      if (distance != null) {
        return {
          kind: 'player',
          distance,
          headshot,
          point: origin.clone().addScaledVector(direction, distance),
          normal: direction.clone().negate(),
        };
      }
    }
    if (worldHit) {
      return {
        kind: 'world',
        distance: worldHit.distance,
        point: worldHit.point.clone(),
        normal: worldHit.normal,
      };
    }
    return {
      kind: 'miss',
      distance: range,
      point: origin.clone().addScaledVector(direction, range),
      normal: direction.clone().negate(),
    };
  }

  damagePlayer(amount, sourcePosition, headshot = false) {
    if (this.player.dead) return;
    const applied = this.player.damage(amount);
    if (applied <= 0) return;
    const sourceDirection = sourcePosition.clone().sub(this.player.position);
    const sourceYaw = Math.atan2(-sourceDirection.x, -sourceDirection.z);
    const relative = sourceYaw - this.player.yaw;
    this.ui.showDamage(relative, this.elapsed);
    this.audio.hurt(applied, this.getPan(sourcePosition));
    this.audio.impact(true, headshot, this.getPan(sourcePosition));
    this.rendering.setDamage(clamp(0.22 + applied / 80, 0.22, 0.88));
  }

  spawnProjectile(owner, position, direction, definition) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x52604d,
      roughness: 0.6,
      metalness: 0.36,
      flatShading: true,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: owner === 'player' ? 0xffa63c : 0xff6138,
      toneMapped: false,
    });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 0.48, 8),
      bodyMaterial,
    );
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.12), glowMaterial);
    glow.position.z = 0.27;
    group.add(glow);
    const light = new THREE.PointLight(
      owner === 'player' ? 0xff9e3d : 0xff5336,
      3.2,
      5,
      2,
    );
    light.position.z = 0.18;
    group.add(light);
    group.position.copy(position).addScaledVector(direction, 0.58);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    this.scene.add(group);
    this.projectiles.push({
      owner,
      definition,
      mesh: group,
      position: group.position,
      velocity: direction.clone().multiplyScalar(definition.projectileSpeed),
      life: 4.2,
      bodyMaterial,
      glowMaterial,
    });
    this.player.addShake(owner === 'player' ? 0.08 : 0, 0.12);
  }

  updateProjectiles(delta) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      const speed = projectile.velocity.length();
      const direction = projectile.velocity.clone().normalize();
      const distance = speed * delta;
      const worldHit = this.arena.raycast(projectile.position, direction, distance + 0.12);
      let hit = Boolean(worldHit);
      if (!hit && projectile.owner === 'player' && !this.bot.dead) {
        const botDistance = raySphereDistance(
          projectile.position,
          direction,
          this.bot.getBodyCenter(new THREE.Vector3()),
          0.68,
        );
        hit = botDistance != null && botDistance <= distance + 0.24;
      }
      if (!hit && projectile.owner === 'bot' && !this.player.dead) {
        const playerDistance = raySphereDistance(
          projectile.position,
          direction,
          this.player.position.clone().add(new THREE.Vector3(0, 0.95, 0)),
          0.65,
        );
        hit = playerDistance != null && playerDistance <= distance + 0.24;
      }
      if (hit || projectile.life <= 0) {
        if (worldHit) projectile.position.copy(worldHit.point).addScaledVector(worldHit.normal, 0.08);
        this.explodeProjectile(projectile);
        this.removeProjectile(index);
        continue;
      }
      projectile.position.addScaledVector(projectile.velocity, delta);
      projectile.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        direction,
      );
      for (let trail = 0; trail < 3; trail += 1) {
        this.vfx.addParticle(
          projectile.position
            .clone()
            .addScaledVector(direction, 0.18 + trail * 0.08)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.08,
                (Math.random() - 0.5) * 0.08,
                (Math.random() - 0.5) * 0.08,
              ),
            ),
          direction
            .clone()
            .multiplyScalar(-1.8 - Math.random() * 2)
            .add(new THREE.Vector3(0, 0.25, 0)),
          trail === 0 ? 0xffdc7c : 0xff7538,
          0.18 + Math.random() * 0.18,
          0.09 + Math.random() * 0.06,
          -0.4,
          2.4,
        );
      }
    }
  }

  explodeProjectile(projectile) {
    const position = projectile.position.clone();
    const radius = projectile.definition.splashRadius;
    this.vfx.spawnExplosion(position, radius * 0.88);
    this.audio.explosion(this.getPan(position), 0.9);
    const playerCenter = this.player.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    const playerDistance = playerCenter.distanceTo(position);
    if (!this.player.dead && playerDistance < radius) {
      const clear = this.arena.hasLineOfSight(
        position.clone().add(new THREE.Vector3(0, 0.15, 0)),
        playerCenter,
        0.18,
      );
      if (clear || playerDistance < 1.6) {
        const falloff = 1 - clamp(playerDistance / radius, 0, 1);
        const ownerScale = projectile.owner === 'player' ? 0.5 : 0.92;
        this.damagePlayer(
          projectile.definition.damage * falloff * ownerScale,
          position,
          false,
        );
        const impulse = playerCenter
          .clone()
          .sub(position)
          .normalize()
          .multiplyScalar(7.5 * falloff);
        impulse.y = Math.max(3.8 * falloff, impulse.y);
        this.player.velocity.add(impulse);
      }
    }
    const botCenter = this.bot.getBodyCenter(new THREE.Vector3());
    const botDistance = botCenter.distanceTo(position);
    if (!this.bot.dead && botDistance < radius) {
      const clear = this.arena.hasLineOfSight(
        position.clone().add(new THREE.Vector3(0, 0.15, 0)),
        botCenter,
        0.18,
      );
      if (clear || botDistance < 1.6) {
        const falloff = 1 - clamp(botDistance / radius, 0, 1);
        const ownerScale = projectile.owner === 'bot' ? 0.5 : 1;
        this.bot.damage(projectile.definition.damage * falloff * ownerScale);
        const impulse = botCenter
          .clone()
          .sub(position)
          .normalize()
          .multiplyScalar(6 * falloff);
        impulse.y = Math.max(2.5 * falloff, impulse.y);
        this.bot.velocity.add(impulse);
        if (projectile.owner === 'player') {
          this.ui.showHit(false, this.elapsed);
          this.audio.impact(true, false);
        }
      }
    }
    this.player.addShake(clamp(0.65 - playerDistance / 16, 0, 0.65), 0.42);
    this.rendering.setDamage(clamp(0.25 - playerDistance / 35, 0, 0.25));
    this.ui.flash();
  }

  removeProjectile(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    this.scene.remove(projectile.mesh);
    projectile.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    projectile.bodyMaterial.dispose();
    projectile.glowMaterial.dispose();
  }

  clearProjectiles() {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      this.removeProjectile(index);
    }
  }

  resolveDeaths() {
    if (this.phase !== 'playing') return;
    if (this.player.dead && this.bot.dead) {
      this.vfx.spawnDeathBurst(this.bot.position.clone(), new THREE.Vector3(0, 0, 1));
      this.endTake('draw');
    } else if (this.bot.dead) {
      const facing = this.player.position.clone().sub(this.bot.position).normalize();
      this.vfx.spawnDeathBurst(this.bot.position.clone(), facing);
      this.player.addShake(0.08, 0.15);
      this.endTake('player');
    } else if (this.player.dead) {
      this.player.viewRoot.visible = false;
      this.endTake('bot');
    }
  }

  spawnPickupBurst(position, color) {
    const center = position.clone().add(new THREE.Vector3(0, 0.8, 0));
    for (let index = 0; index < 18; index += 1) {
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        1.2 + Math.random() * 3,
        (Math.random() - 0.5) * 3.2,
      );
      this.vfx.addParticle(
        center,
        velocity,
        index % 3 === 0 ? 0xffffff : color,
        0.25 + Math.random() * 0.3,
        0.07 + Math.random() * 0.05,
        5,
        1.4,
      );
    }
  }

  getPan(worldPosition) {
    const direction = worldPosition.clone().sub(this.camera.position).normalize();
    this.camera.getWorldDirection(TEMP_DIRECTION);
    TEMP_RIGHT.crossVectors(TEMP_DIRECTION, WORLD_UP).normalize();
    return clamp(direction.dot(TEMP_RIGHT), -0.8, 0.8);
  }

  updateHUD() {
    this.ui.updateHUD(
      {
        playerRounds: this.playerRounds,
        botRounds: this.botRounds,
        playerTakes: this.playerTakes,
        botTakes: this.botTakes,
        roundNumber: this.roundNumber,
        takeTime: this.takeTime,
        overtime: this.overtime,
      },
      this.player,
      this.bot,
      this.arena.map,
      this.lastMovement,
    );
  }

  updateTitle(delta) {
    this.titleTime += delta;
    this.titleMapTimer += delta;
    const t = this.titleTime;
    const radius = 13.8 + Math.sin(t * 0.17) * 1.2;
    this.camera.position.set(
      Math.sin(t * 0.095) * radius - 0.8,
      3.8 + Math.sin(t * 0.21) * 0.55,
      Math.cos(t * 0.095) * radius - 0.6,
    );
    const target = new THREE.Vector3(
      Math.sin(t * 0.09) * 1.5,
      1.45 + Math.sin(t * 0.15) * 0.2,
      Math.cos(t * 0.08) * 1.2,
    );
    this.camera.lookAt(target);
    this.camera.rotation.z = Math.sin(t * 0.13) * 0.008;
    this.bot.yaw = 0.7 + Math.sin(t * 0.22) * 0.22;
    this.bot.animate(delta, new THREE.Vector3(), true);
  }

  loop(frameTime) {
    if (!this.running) return;
    const rawDelta = (frameTime - this.lastFrame) / 1000;
    const delta = Math.min(Math.max(rawDelta, 0), 0.05);
    this.lastFrame = frameTime;
    this.elapsed += delta;

    if (this.mode === 'title' || this.mode === 'result') {
      this.updateTitle(delta);
    } else if (this.mode === 'match') {
      this.updateMatch(delta);
    } else if (this.mode === 'paused') {
      this.player.syncCamera(delta);
    }

    this.arena.update(this.elapsed, delta);
    this.pickups.update(this.elapsed, delta);
    this.vfx.update(delta);
    this.ui.update(this.elapsed);
    this.rendering.setFocus(this.player.focused && this.mode === 'match');
    this.rendering.render(delta, this.elapsed);
    requestAnimationFrame(this.loop);
  }
}

export { WEAPONS };
