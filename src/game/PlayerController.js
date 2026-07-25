import * as THREE from 'three';
import { clamp, damp, moveToward } from './math.js';
import { createWeaponModel, WEAPONS } from './weapons.js';

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const WISH = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class PlayerController {
  constructor(camera, arena, audio) {
    this.camera = camera;
    this.arena = arena;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.wallRunTime = 0;
    this.wallNormal = new THREE.Vector3();
    this.wallSide = 0;
    this.cameraHeight = 1.64;
    this.cameraRoll = 0;
    this.stepCycle = 0;
    this.lastStepCycle = 0;
    this.bob = 0;
    this.landKick = 0;
    this.recoil = 0;
    this.recoilSide = 0;
    this.weaponKick = 0;
    this.inspect = 0;
    this.sway = new THREE.Vector2();
    this.mouseDelta = new THREE.Vector2();
    this.shake = 0;
    this.shakeTime = 0;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.buttonPressed = new Set();
    this.sensitivity = Number(localStorage.getItem('shootem-sensitivity') || 0.85);
    this.weaponType = 'sidearm';
    this.ammo = WEAPONS.sidearm.ammo;
    this.lastShotAt = -Infinity;
    this.focused = false;
    this.inputEnabled = false;

    this.viewRoot = new THREE.Group();
    this.viewRoot.name = 'first-person-view-model';
    this.camera.add(this.viewRoot);
    this.createHands();
    this.setWeaponModel('sidearm', false);
    this.bindInput();
  }

  bindInput() {
    window.addEventListener('keydown', (event) => {
      const code = event.code;
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC', 'KeyR'].includes(code)
      ) {
        event.preventDefault();
      }
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('mousedown', (event) => {
      if (!this.buttons.has(event.button)) this.buttonPressed.add(event.button);
      this.buttons.add(event.button);
    });
    window.addEventListener('mouseup', (event) => {
      this.buttons.delete(event.button);
    });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement && this.inputEnabled) {
        const scalar = 0.00165 * this.sensitivity;
        this.yaw -= event.movementX * scalar;
        this.pitch -= event.movementY * scalar;
        this.pitch = clamp(this.pitch, -1.49, 1.49);
        this.mouseDelta.x += event.movementX;
        this.mouseDelta.y += event.movementY;
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.pressed.clear();
      this.buttonPressed.clear();
    });
  }

  createHands() {
    const skin = new THREE.MeshStandardMaterial({
      color: 0xb78765,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
    });
    const glove = new THREE.MeshStandardMaterial({
      color: 0x1e241f,
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });
    this.hands = new THREE.Group();
    const rightForearm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.62), glove);
    rightForearm.position.set(0.22, -0.36, 0.24);
    rightForearm.rotation.set(-0.2, 0.08, -0.08);
    const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.22), glove);
    rightHand.position.set(0.03, -0.18, -0.02);
    rightHand.rotation.set(-0.08, 0.08, -0.08);
    const rightKnuckles = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 0.13), skin);
    rightKnuckles.position.set(0.03, -0.11, -0.075);
    rightKnuckles.rotation.copy(rightHand.rotation);
    const leftForearm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.55), glove);
    leftForearm.position.set(-0.31, -0.29, -0.08);
    leftForearm.rotation.set(-0.25, -0.18, 0.28);
    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.21), glove);
    leftHand.position.set(-0.18, -0.12, -0.32);
    leftHand.rotation.set(0.08, -0.12, 0.18);
    const leftKnuckles = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.12), skin);
    leftKnuckles.position.set(-0.18, -0.045, -0.37);
    leftKnuckles.rotation.copy(leftHand.rotation);
    for (const mesh of [rightForearm, rightHand, rightKnuckles, leftForearm, leftHand, leftKnuckles]) {
      mesh.castShadow = false;
      mesh.renderOrder = 4;
      this.hands.add(mesh);
    }
    this.viewRoot.add(this.hands);
  }

  setWeaponModel(type, animate = true) {
    if (this.weaponModel) this.viewRoot.remove(this.weaponModel);
    this.weaponModel = createWeaponModel(type, { viewModel: true });
    const longWeapon = ['scatter', 'carbine', 'burst', 'rail', 'rocket'].includes(type);
    this.weaponModel.scale.setScalar(longWeapon ? 0.57 : 0.66);
    this.viewRoot.add(this.weaponModel);
    if (animate) this.inspect = 1;
  }

  setSensitivity(value) {
    this.sensitivity = Number(value);
    localStorage.setItem('shootem-sensitivity', String(this.sensitivity));
  }

  reset(position, yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.wallRunTime = 0;
    this.cameraHeight = 1.64;
    this.cameraRoll = 0;
    this.stepCycle = 0;
    this.landKick = 0;
    this.recoil = 0;
    this.recoilSide = 0;
    this.weaponKick = 0;
    this.shake = 0;
    this.equip('sidearm', false);
    this.syncCamera(0.016);
  }

  equip(type, announce = true) {
    this.weaponType = type in WEAPONS ? type : 'sidearm';
    this.ammo = WEAPONS[this.weaponType].ammo;
    this.lastShotAt = -Infinity;
    this.setWeaponModel(this.weaponType, announce);
    if (announce) this.audio.pickup();
  }

  discard() {
    if (this.weaponType === 'sidearm') return false;
    this.equip('sidearm', true);
    return true;
  }

  get definition() {
    return WEAPONS[this.weaponType];
  }

  wantsToFire() {
    if (!this.inputEnabled || this.dead) return false;
    return this.definition.automatic ? this.buttons.has(0) : this.buttonPressed.has(0);
  }

  canFire(time) {
    return (
      !this.dead &&
      this.ammo > 0 &&
      time - this.lastShotAt >= this.definition.interval
    );
  }

  registerShot(time) {
    this.lastShotAt = time;
    this.ammo = Math.max(0, this.ammo - 1);
    const definition = this.definition;
    const groundedScale = this.grounded ? 1 : 1.12;
    this.recoil += definition.recoil * groundedScale;
    this.recoilSide += (Math.random() - 0.5) * definition.recoil * 0.44;
    this.weaponKick = Math.min(2.5, this.weaponKick + definition.recoil);
    this.pitch = clamp(this.pitch + definition.recoil * 0.0062, -1.49, 1.49);
    this.shake = Math.max(this.shake, definition.recoil * 0.075);
    this.shakeTime = 0.11;
  }

  dryFire(time) {
    if (time - this.lastShotAt < 0.26) return false;
    this.lastShotAt = time;
    this.weaponKick += 0.08;
    this.audio.empty();
    return true;
  }

  getAim(originTarget = new THREE.Vector3(), directionTarget = new THREE.Vector3()) {
    this.camera.getWorldPosition(originTarget);
    this.camera.getWorldDirection(directionTarget);
    return { origin: originTarget, direction: directionTarget };
  }

  getMuzzlePosition(target = new THREE.Vector3()) {
    this.weaponModel.userData.muzzle.getWorldPosition(target);
    return target;
  }

  getCasingPosition(target = new THREE.Vector3()) {
    this.weaponModel.userData.casingPort.getWorldPosition(target);
    return target;
  }

  getRightDirection(target = new THREE.Vector3()) {
    target.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return target;
  }

  addShake(amount, duration = 0.2) {
    this.shake = Math.max(this.shake, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  damage(amount) {
    if (this.dead) return 0;
    const applied = Math.min(this.health, Math.max(0, amount));
    this.health -= applied;
    this.shake = Math.max(this.shake, 0.18 + applied * 0.008);
    this.shakeTime = Math.max(this.shakeTime, 0.26);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.velocity.multiplyScalar(0.3);
    }
    return applied;
  }

  update(delta, canMove = true) {
    const dt = Math.min(delta, 0.034);
    this.inputEnabled = canMove;
    this.wasGrounded = this.grounded;
    const wasAirTime = this.airTime;
    const moveX =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const moveZ =
      (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const wantsSprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const wantsSlide =
      this.pressed.has('ControlLeft') ||
      this.pressed.has('ControlRight') ||
      this.pressed.has('KeyC');
    const wantsJump = this.pressed.has('Space');
    const jumpHeld = this.keys.has('Space');
    this.focused = this.buttons.has(2) && canMove;

    FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    WISH.set(0, 0, 0)
      .addScaledVector(FORWARD, moveZ)
      .addScaledVector(RIGHT, moveX);
    if (WISH.lengthSq() > 1) WISH.normalize();

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (
      canMove &&
      wantsSlide &&
      this.grounded &&
      horizontalSpeed > 5.4 &&
      this.slideCooldown <= 0
    ) {
      this.slideTime = 0.72;
      this.slideCooldown = 0.95;
      const slideDirection =
        horizontalSpeed > 0.1
          ? new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize()
          : FORWARD;
      this.velocity.x = slideDirection.x * Math.max(9.4, horizontalSpeed * 1.07);
      this.velocity.z = slideDirection.z * Math.max(9.4, horizontalSpeed * 1.07);
      this.audio.movement('slide');
    }

    if (this.slideTime > 0) {
      this.slideTime = Math.max(0, this.slideTime - dt);
    }
    const sliding = this.slideTime > 0;
    const bodyHeight = sliding ? 1.15 : 1.8;

    const wall = !this.grounded
      ? this.arena.getWallContact(this.position, 0.44, bodyHeight)
      : null;
    const canWallRun =
      canMove &&
      wall &&
      jumpHeld &&
      horizontalSpeed > 5.2 &&
      this.airTime > 0.08 &&
      this.wallRunTime < 1.15;

    if (canWallRun) {
      this.wallNormal.copy(wall.normal);
      const tangent = new THREE.Vector3(-wall.normal.z, 0, wall.normal.x);
      if (tangent.dot(FORWARD) < 0) tangent.negate();
      const alongSpeed = Math.max(6.4, this.velocity.dot(tangent));
      this.velocity.x = damp(this.velocity.x, tangent.x * alongSpeed, 9, dt);
      this.velocity.z = damp(this.velocity.z, tangent.z * alongSpeed, 9, dt);
      this.velocity.y = Math.max(this.velocity.y - 5.5 * dt, -1.7);
      this.wallRunTime += dt;
      this.wallSide = Math.sign(RIGHT.dot(wall.normal));
      if (Math.floor(this.wallRunTime * 9) !== Math.floor((this.wallRunTime - dt) * 9)) {
        this.audio.movement('wall');
      }
    } else {
      if (this.grounded) this.wallRunTime = 0;
      this.wallSide = 0;
      this.velocity.y -= 22.5 * dt;
    }

    if (canMove && wantsJump) {
      if (this.grounded) {
        this.velocity.y = sliding ? 7.1 : 7.55;
        this.grounded = false;
        this.slideTime = 0;
        this.audio.movement('jump');
      } else if (wall && this.wallRunTime > 0.03) {
        this.velocity
          .addScaledVector(wall.normal, 7.2)
          .addScaledVector(FORWARD, 2.2);
        this.velocity.y = 7.15;
        this.wallRunTime = 1.15;
        this.cameraRoll += this.wallSide * 0.08;
        this.audio.movement('jump');
      }
    }

    if (canMove && !sliding) {
      const targetSpeed = wantsSprint && moveZ > 0 && !this.focused ? 8.4 : this.focused ? 4.5 : 6.4;
      const targetX = WISH.x * targetSpeed;
      const targetZ = WISH.z * targetSpeed;
      const acceleration = this.grounded ? (WISH.lengthSq() ? 36 : 25) : 8.5;
      this.velocity.x = moveToward(this.velocity.x, targetX, acceleration * dt);
      this.velocity.z = moveToward(this.velocity.z, targetZ, acceleration * dt);
    } else if (!canMove) {
      this.velocity.x = moveToward(this.velocity.x, 0, 18 * dt);
      this.velocity.z = moveToward(this.velocity.z, 0, 18 * dt);
    } else if (sliding) {
      this.velocity.x += WISH.x * 2.4 * dt;
      this.velocity.z += WISH.z * 2.4 * dt;
      const slideFriction = this.grounded ? 2.2 : 0.4;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const next = Math.max(0, speed - slideFriction * dt);
      if (speed > 0.001) {
        this.velocity.x *= next / speed;
        this.velocity.z *= next / speed;
      }
    }

    const movement = this.arena.moveBody(this, dt, {
      radius: 0.42,
      height: bodyHeight,
      stepHeight: 0.47,
    });
    if (movement.hitWall && sliding) {
      this.slideTime = Math.min(this.slideTime, 0.15);
      this.addShake(0.08, 0.1);
    }

    if (this.grounded) {
      this.airTime = 0;
      if (!this.wasGrounded && wasAirTime > 0.18) {
        const strength = clamp(wasAirTime / 0.9, 0.4, 1.3);
        this.landKick = Math.min(0.24, 0.055 * strength);
        this.audio.movement('land', strength);
        this.addShake(0.025 * strength, 0.08);
      }
    } else {
      this.airTime += dt;
    }

    const newHorizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && newHorizontalSpeed > 1 && !sliding) {
      const stride = wantsSprint ? 1.42 : 1;
      this.stepCycle += dt * newHorizontalSpeed * 0.32 * stride;
      if (Math.floor(this.stepCycle * 2) > Math.floor(this.lastStepCycle * 2)) {
        this.audio.movement('step', clamp(newHorizontalSpeed / 7, 0.45, 1));
      }
      this.lastStepCycle = this.stepCycle;
    }

    this.updateView(dt, {
      speed: newHorizontalSpeed,
      sprinting: wantsSprint && moveZ > 0 && !this.focused && newHorizontalSpeed > 5,
      sliding,
      wallRunning: canWallRun,
      moving: WISH.lengthSq() > 0,
    });
    this.syncCamera(dt);

    const actions = {
      fire: this.wantsToFire(),
      discard: this.pressed.has('KeyR'),
      sliding,
      wallRunning: canWallRun,
      sprinting: wantsSprint && moveZ > 0 && newHorizontalSpeed > 5,
      speed: newHorizontalSpeed,
    };
    this.pressed.clear();
    this.buttonPressed.clear();
    this.mouseDelta.set(0, 0);
    return actions;
  }

  updateView(delta, movement) {
    const bobStrength = movement.moving && this.grounded ? clamp(movement.speed / 7, 0, 1) : 0;
    const bobFrequency = movement.sprinting ? 1.28 : 1;
    const phase = this.stepCycle * Math.PI * 2 * bobFrequency;
    const targetBob = Math.sin(phase) * 0.018 * bobStrength;
    this.bob = damp(this.bob, targetBob, 13, delta);
    this.landKick = damp(this.landKick, 0, 13, delta);
    this.recoil = damp(this.recoil, 0, 14, delta);
    this.recoilSide = damp(this.recoilSide, 0, 12, delta);
    this.weaponKick = damp(this.weaponKick, 0, 18, delta);
    this.inspect = Math.max(0, this.inspect - delta * 1.8);

    this.sway.x = damp(this.sway.x, clamp(-this.mouseDelta.x * 0.0005, -0.045, 0.045), 15, delta);
    this.sway.y = damp(this.sway.y, clamp(-this.mouseDelta.y * 0.00045, -0.04, 0.04), 15, delta);

    const focusAmount = this.focused ? 1 : 0;
    const targetX = 0.45 * (1 - focusAmount) + 0.01 * focusAmount;
    const targetY = -0.31 * (1 - focusAmount) - 0.215 * focusAmount;
    const targetZ = -0.66 + this.weaponKick * 0.042 + (movement.sprinting ? 0.09 : 0);
    const inspectRotation = this.inspect > 0
      ? Math.sin((1 - this.inspect) * Math.PI) * 0.48
      : 0;
    this.viewRoot.position.x = damp(this.viewRoot.position.x, targetX + this.sway.x, 15, delta);
    this.viewRoot.position.y = damp(
      this.viewRoot.position.y,
      targetY + this.bob - this.landKick + this.sway.y,
      15,
      delta,
    );
    this.viewRoot.position.z = damp(this.viewRoot.position.z, targetZ, 18, delta);
    this.viewRoot.rotation.x = damp(
      this.viewRoot.rotation.x,
      -0.035 - this.recoil * 0.065 + (movement.sprinting ? -0.25 : 0) + this.sway.y * 0.8,
      15,
      delta,
    );
    this.viewRoot.rotation.y = damp(
      this.viewRoot.rotation.y,
      -0.035 + this.recoilSide * 0.055 + inspectRotation + this.sway.x,
      15,
      delta,
    );
    this.viewRoot.rotation.z = damp(
      this.viewRoot.rotation.z,
      movement.sprinting ? -0.22 : inspectRotation * 0.22 - this.sway.x * 0.5,
      13,
      delta,
    );
    this.hands.visible = this.weaponType !== 'rocket' || !this.focused;
  }

  syncCamera(delta) {
    const sliding = this.slideTime > 0;
    const targetHeight = sliding ? 0.88 : 1.64;
    this.cameraHeight = damp(this.cameraHeight, targetHeight, sliding ? 18 : 10, delta);
    const targetRoll = this.wallSide * -0.17;
    this.cameraRoll = damp(this.cameraRoll, targetRoll, 8, delta);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      this.shake = damp(this.shake, 0, 8, delta);
    } else {
      this.shake = damp(this.shake, 0, 18, delta);
    }
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;
    const shakeZ = (Math.random() - 0.5) * this.shake * 0.5;
    const bobY = Math.abs(this.bob) * 0.45;
    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + this.cameraHeight + bobY + shakeY,
      this.position.z + shakeZ,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      this.pitch + this.recoil * 0.003,
      this.yaw,
      this.cameraRoll + Math.sin(this.stepCycle * Math.PI * 2) * 0.008 + shakeZ,
    );
    const targetFov = this.focused
      ? this.weaponType === 'rail'
        ? 48
        : 59
      : this.slideTime > 0 || Math.hypot(this.velocity.x, this.velocity.z) > 7.7
        ? 79
        : 73;
    this.camera.fov = damp(this.camera.fov, targetFov, 9, delta);
    this.camera.updateProjectionMatrix();
  }
}
