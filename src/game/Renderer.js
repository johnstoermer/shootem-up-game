import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { damp } from './math.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    damage: { value: 0 },
    focus: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float damage;
    uniform float focus;
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float edge = smoothstep(0.15, 0.82, length(centered * vec2(1.0, resolution.y / resolution.x)));
      float aberration = (0.00045 + damage * 0.0045) * (0.35 + edge);
      vec2 direction = normalize(centered + vec2(0.0001)) * aberration;
      float red = texture2D(tDiffuse, vUv + direction).r;
      float green = texture2D(tDiffuse, vUv).g;
      float blue = texture2D(tDiffuse, vUv - direction).b;
      vec3 color = vec3(red, green, blue);

      color = (color - 0.5) * 1.055 + 0.5;
      color *= vec3(1.025, 1.01, 0.955);
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 0.94 + focus * 0.08);
      color += vec3(0.022, 0.024, 0.021);
      color *= 1.0 - edge * (0.19 + damage * 0.32);
      color += vec3(0.12, -0.035, -0.055) * damage * (0.45 + edge * 0.55);
      float noise = hash(gl_FragCoord.xy + vec2(time * 97.0, time * 31.0)) - 0.5;
      color += noise * 0.012;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(73, 1, 0.045, 180);
    this.scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x121511, 1);
    this.renderer.info.autoReset = true;

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.42,
      0.36,
      0.82,
    );
    this.composer.addPass(this.bloomPass);

    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.damage = 0;
    this.focus = 0;
    this.time = 0;
    this.resize();
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, width < 1000 ? 1.35 : 1.65);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gradePass.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
    return pixelRatio;
  }

  setDamage(amount) {
    this.damage = Math.max(this.damage, amount);
  }

  setFocus(focused) {
    this.focus = focused ? 1 : 0;
  }

  render(delta, time) {
    this.time = time;
    this.damage = damp(this.damage, 0, 4.8, delta);
    this.gradePass.uniforms.time.value = time;
    this.gradePass.uniforms.damage.value = this.damage;
    this.gradePass.uniforms.focus.value = damp(
      this.gradePass.uniforms.focus.value,
      this.focus,
      8,
      delta,
    );
    this.composer.render(delta);
  }
}
