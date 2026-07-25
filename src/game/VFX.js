import * as THREE from 'three';
import { clamp } from './math.js';

const MAX_PARTICLES = 700;
const UP = new THREE.Vector3(0, 1, 0);

function createParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float pixelRatio;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio * (160.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = 1.0 - smoothstep(0.12, 0.5, d);
        if (core <= 0.0) discard;
        gl_FragColor = vec4(vColor * (1.0 + core * 0.8), vAlpha * core);
      }
    `,
  });
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'effects';
    this.scene.add(this.root);
    this.particles = [];
    this.transients = [];
    this.debris = [];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3),
    );
    geometry.setAttribute(
      'size',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1),
    );
    geometry.setAttribute(
      'alpha',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1),
    );
    geometry.setDrawRange(0, 0);
    this.particlePoints = new THREE.Points(geometry, createParticleMaterial());
    this.particlePoints.frustumCulled = false;
    this.root.add(this.particlePoints);

    this.chunkGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    this.shellGeometry = new THREE.BoxGeometry(0.035, 0.035, 0.11);
  }

  clear() {
    this.particles.length = 0;
    for (const entry of this.transients) {
      this.root.remove(entry.object);
      entry.dispose?.();
    }
    for (const entry of this.debris) {
      this.root.remove(entry.mesh);
      entry.mesh.material.dispose();
    }
    this.transients.length = 0;
    this.debris.length = 0;
    this.particlePoints.geometry.setDrawRange(0, 0);
  }

  addParticle(position, velocity, color, life, size = 0.08, gravity = 6, drag = 0.7) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      position: position.clone(),
      velocity: velocity.clone(),
      color: new THREE.Color(color),
      life,
      maxLife: life,
      size,
      gravity,
      drag,
    });
  }

  spawnMuzzle(position, direction, color = 0xffb342, power = 1) {
    const flash = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.13 * power, 0),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flash.position.copy(position);
    flash.scale.set(0.55, 0.55, 2.6);
    flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    this.root.add(flash);
    this.transients.push({
      object: flash,
      age: 0,
      life: 0.055,
      update: (amount) => {
        flash.material.opacity = 1 - amount;
        flash.scale.multiplyScalar(1 + amount * 0.08);
      },
      dispose: () => {
        flash.geometry.dispose();
        flash.material.dispose();
      },
    });

    const light = new THREE.PointLight(color, 4.5 * power, 7 * power, 2);
    light.position.copy(position);
    this.root.add(light);
    this.transients.push({
      object: light,
      age: 0,
      life: 0.075,
      update: (amount) => {
        light.intensity = (1 - amount) * 4.5 * power;
      },
    });

    for (let index = 0; index < 4 + power * 2; index += 1) {
      const velocity = direction
        .clone()
        .multiplyScalar(2.5 + Math.random() * 5)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 1.8,
            (Math.random() - 0.5) * 1.8,
            (Math.random() - 0.5) * 1.8,
          ),
        );
      this.addParticle(position, velocity, color, 0.08 + Math.random() * 0.08, 0.05, 0, 4);
    }
  }

  spawnTracer(start, end, color = 0xffcf68, thickness = 0.015, life = 0.075) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.05) return;
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(thickness, thickness, length, 4, 1),
      material,
    );
    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    this.root.add(mesh);
    this.transients.push({
      object: mesh,
      age: 0,
      life,
      update: (amount) => {
        material.opacity = (1 - amount) * 0.9;
        mesh.scale.x = mesh.scale.z = 1 - amount * 0.55;
      },
      dispose: () => {
        mesh.geometry.dispose();
        material.dispose();
      },
    });
  }

  spawnImpact(point, normal, options = {}) {
    const color = options.color ?? 0xffb247;
    const count = options.count ?? 13;
    for (let index = 0; index < count; index += 1) {
      const tangent = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.2,
        Math.random() - 0.5,
      ).normalize();
      const velocity = normal
        .clone()
        .multiplyScalar(1.4 + Math.random() * 5.2)
        .add(tangent.multiplyScalar(Math.random() * 3.2));
      this.addParticle(
        point,
        velocity,
        index % 3 === 0 ? 0xffffff : color,
        0.2 + Math.random() * 0.35,
        0.06 + Math.random() * 0.06,
        12,
        1.7,
      );
    }
    if (options.debris !== false) {
      for (let index = 0; index < Math.min(5, Math.ceil(count / 3)); index += 1) {
        this.spawnChunk(
          point,
          normal
            .clone()
            .multiplyScalar(1 + Math.random() * 2.8)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                Math.random() * 2,
                (Math.random() - 0.5) * 2,
              ),
            ),
          options.chunkColor ?? 0x52564e,
          0.07 + Math.random() * 0.08,
          0.6 + Math.random() * 0.6,
        );
      }
    }
  }

  spawnBloodImpact(point, direction, headshot = false) {
    const count = headshot ? 22 : 12;
    for (let index = 0; index < count; index += 1) {
      const velocity = direction
        .clone()
        .multiplyScalar(0.7 + Math.random() * 3.5)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3.2,
            (Math.random() - 0.5) * 4,
          ),
        );
      this.addParticle(
        point,
        velocity,
        index % 4 === 0 ? 0xff8b49 : 0xc3412e,
        0.28 + Math.random() * 0.42,
        0.075 + Math.random() * 0.08,
        13,
        1.3,
      );
    }
  }

  spawnShell(position, direction, color = 0xc99a43, large = false) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.32,
      metalness: 0.76,
      emissive: new THREE.Color(color).multiplyScalar(0.08),
    });
    const mesh = new THREE.Mesh(this.shellGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(large ? 1.4 : 1);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.root.add(mesh);
    this.debris.push({
      mesh,
      velocity: direction
        .clone()
        .multiplyScalar(1.7 + Math.random() * 1.8)
        .add(new THREE.Vector3(0, 1.1 + Math.random(), 0)),
      angular: new THREE.Vector3(
        Math.random() * 16,
        Math.random() * 18,
        Math.random() * 14,
      ),
      age: 0,
      life: 1.6,
      gravity: 9,
      floor: position.y - 1.2,
      bounce: 0.25,
    });
  }

  spawnChunk(position, velocity, color, size = 0.15, life = 1.2) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.04,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(this.chunkGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(size / 0.18);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.castShadow = true;
    this.root.add(mesh);
    this.debris.push({
      mesh,
      velocity: velocity.clone(),
      angular: new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      ),
      age: 0,
      life,
      gravity: 15,
      floor: 0.04,
      bounce: 0.24,
    });
  }

  spawnDeathBurst(position, facing = new THREE.Vector3(0, 0, 1)) {
    const colors = [0xb84a34, 0x343933, 0xd0b58c, 0x1a1d19, 0xe39d2e];
    for (let index = 0; index < 28; index += 1) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.9,
        Math.random() * 1.65,
        (Math.random() - 0.5) * 0.9,
      );
      const velocity = offset
        .clone()
        .normalize()
        .multiplyScalar(2.4 + Math.random() * 5)
        .add(facing.clone().multiplyScalar(1.2))
        .add(new THREE.Vector3(0, 2.5, 0));
      this.spawnChunk(
        position.clone().add(offset),
        velocity,
        colors[index % colors.length],
        0.11 + Math.random() * 0.2,
        1.2 + Math.random() * 1.1,
      );
    }
    for (let index = 0; index < 35; index += 1) {
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        Math.random() * 7,
        (Math.random() - 0.5) * 9,
      );
      this.addParticle(
        position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        velocity,
        index % 4 ? 0xc9442e : 0xffae48,
        0.45 + Math.random() * 0.6,
        0.1 + Math.random() * 0.12,
        14,
        1.2,
      );
    }
  }

  spawnExplosion(position, radius = 5, color = 0xff7435) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      toneMapped: false,
    });
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
    sphere.position.copy(position);
    sphere.scale.setScalar(0.1);
    this.root.add(sphere);
    this.transients.push({
      object: sphere,
      age: 0,
      life: 0.38,
      update: (amount) => {
        const scale = 0.15 + Math.sin(Math.min(1, amount) * Math.PI * 0.5) * radius;
        sphere.scale.setScalar(scale);
        material.opacity = Math.pow(1 - amount, 2) * 0.58;
      },
      dispose: () => {
        sphere.geometry.dispose();
        material.dispose();
      },
    });

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc86a,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 5, 32), ringMaterial);
    ring.position.copy(position);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(0.1);
    this.root.add(ring);
    this.transients.push({
      object: ring,
      age: 0,
      life: 0.52,
      update: (amount) => {
        ring.scale.setScalar(0.1 + amount * radius * 1.35);
        ringMaterial.opacity = (1 - amount) * 0.75;
      },
      dispose: () => {
        ring.geometry.dispose();
        ringMaterial.dispose();
      },
    });

    const light = new THREE.PointLight(color, 18, radius * 2.7, 2);
    light.position.copy(position);
    this.root.add(light);
    this.transients.push({
      object: light,
      age: 0,
      life: 0.42,
      update: (amount) => {
        light.intensity = Math.pow(1 - amount, 2) * 18;
      },
    });

    for (let index = 0; index < 85; index += 1) {
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.2) * 1.4,
        (Math.random() - 0.5) * 2,
      )
        .normalize()
        .multiplyScalar(3 + Math.random() * 12);
      this.addParticle(
        position,
        velocity,
        index % 5 === 0 ? 0xfff0c2 : color,
        0.32 + Math.random() * 0.7,
        0.09 + Math.random() * 0.18,
        8,
        0.7,
      );
    }
    for (let index = 0; index < 18; index += 1) {
      this.spawnChunk(
        position,
        new THREE.Vector3(
          (Math.random() - 0.5) * 9,
          2 + Math.random() * 6,
          (Math.random() - 0.5) * 9,
        ),
        index % 3 ? 0x31362f : 0x9b4930,
        0.08 + Math.random() * 0.17,
        0.8 + Math.random() * 1.1,
      );
    }
  }

  update(delta) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      particle.velocity.y -= particle.gravity * delta;
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * delta));
      particle.position.addScaledVector(particle.velocity, delta);
    }

    const geometry = this.particlePoints.geometry;
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    const size = geometry.attributes.size;
    const alpha = geometry.attributes.alpha;
    const count = Math.min(this.particles.length, MAX_PARTICLES);
    for (let index = 0; index < count; index += 1) {
      const particle = this.particles[index];
      const amount = clamp(particle.life / particle.maxLife, 0, 1);
      position.setXYZ(index, particle.position.x, particle.position.y, particle.position.z);
      color.setXYZ(index, particle.color.r, particle.color.g, particle.color.b);
      size.setX(index, particle.size * (0.65 + amount * 0.35));
      alpha.setX(index, Math.min(1, amount * 2.5));
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    geometry.setDrawRange(0, count);

    for (let index = this.transients.length - 1; index >= 0; index -= 1) {
      const entry = this.transients[index];
      entry.age += delta;
      const amount = clamp(entry.age / entry.life, 0, 1);
      entry.update?.(amount, delta);
      if (entry.age >= entry.life) {
        this.root.remove(entry.object);
        entry.dispose?.();
        this.transients.splice(index, 1);
      }
    }

    for (let index = this.debris.length - 1; index >= 0; index -= 1) {
      const entry = this.debris[index];
      entry.age += delta;
      entry.velocity.y -= entry.gravity * delta;
      entry.mesh.position.addScaledVector(entry.velocity, delta);
      entry.mesh.rotation.x += entry.angular.x * delta;
      entry.mesh.rotation.y += entry.angular.y * delta;
      entry.mesh.rotation.z += entry.angular.z * delta;
      if (entry.mesh.position.y < entry.floor) {
        entry.mesh.position.y = entry.floor;
        entry.velocity.y = Math.abs(entry.velocity.y) * entry.bounce;
        entry.velocity.x *= 0.68;
        entry.velocity.z *= 0.68;
        entry.angular.multiplyScalar(0.72);
      }
      if (entry.age > entry.life - 0.35) {
        const amount = clamp((entry.life - entry.age) / 0.35, 0, 1);
        entry.mesh.scale.multiplyScalar(0.92 + amount * 0.08);
      }
      if (entry.age >= entry.life) {
        this.root.remove(entry.mesh);
        entry.mesh.material.dispose();
        this.debris.splice(index, 1);
      }
    }
  }

  resize(pixelRatio) {
    this.particlePoints.material.uniforms.pixelRatio.value = Math.min(pixelRatio, 2);
  }
}
