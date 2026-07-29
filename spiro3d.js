/* ============================================================
   SPIROKRAFT · 3D — true three.js rendering
   Solid tube meshes swept along a 3D-lifted spirograph curve,
   physically-shaded, lit, and bloomed. Exposes window.Spiro3D
   so the main (classic) script can drive it.
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/controls/OrbitControls.js';
import { EffectComposer } from './vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const Spiro3D = {
  ready: false, on: false, err: null,
  renderer: null, scene: null, camera: null, controls: null, composer: null, bloom: null,
  mesh: null, mat: null, lights: [], canvas: null,
  params: { depth: 0.9, tube: 0.05, bloom: 0.6, spin: 1 },
  _raf: 0, _rec: null, _recChunks: [], _needsRebuild: false,

  /* ---------- lifecycle ---------- */
  init(canvas) {
    if (this.ready) return true;
    try {
      this.canvas = canvas;
      const r = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: true
      });
      r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      this.renderer = r;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#07070a');
      scene.fog = new THREE.FogExp2('#07070a', 0.0016);
      this.scene = scene;

      const cam = new THREE.PerspectiveCamera(42, 1, 1, 6000);
      cam.position.set(0, -420, 380);
      this.camera = cam;

      const ctrl = new OrbitControls(cam, canvas);
      ctrl.enableDamping = true; ctrl.dampingFactor = 0.07;
      ctrl.rotateSpeed = 0.75; ctrl.panSpeed = 0.6;
      ctrl.autoRotate = true; ctrl.autoRotateSpeed = this.params.spin;
      ctrl.minDistance = 60; ctrl.maxDistance = 2600;
      this.controls = ctrl;

      // lighting: one key, two coloured rims, soft ambient fill
      const amb = new THREE.HemisphereLight('#9fc4dc', '#0b0c10', 0.30);
      const key = new THREE.DirectionalLight('#ffffff', 1.1); key.position.set(220, -260, 420);
      const rimA = new THREE.DirectionalLight('#6ea4c4', 0.85); rimA.position.set(-380, 240, -160);
      const rimB = new THREE.DirectionalLight('#c4a46e', 0.55); rimB.position.set(300, 260, -320);
      scene.add(amb, key, rimA, rimB);
      this.lights = [amb, key, rimA, rimB];

      const composer = new EffectComposer(r);
      composer.addPass(new RenderPass(scene, cam));
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.params.bloom, 0.5, 0.62);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer; this.bloom = bloom;

      this.ready = true;
      return true;
    } catch (e) {
      this.err = String(e && e.message || e);
      return false;
    }
  },

  /* ---------- geometry: a 3D-lifted spirograph ---------- */
  curvePoints(g) {
    const R = Math.max(20, g.R), r = Math.max(4, g.r), d = Math.max(2, g.d);
    const epi = g.curve === 'epi';
    const rr = epi ? R + r : R - r;
    const k = rr / r;
    // closes after r/gcd(R,r) turns
    const Ri = Math.max(1, Math.round(R)), ri = Math.max(1, Math.round(r));
    const turns = clamp(ri / gcd(Ri, ri), 1, 60);
    const N = clamp(Math.round(turns * 260), 600, 9000);
    const zAmp = d * this.params.depth * 1.6;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * TAU * turns;
      const x = epi ? rr * Math.cos(t) - d * Math.cos(k * t) : rr * Math.cos(t) + d * Math.cos(k * t);
      const y = epi ? rr * Math.sin(t) - d * Math.sin(k * t) : rr * Math.sin(t) - d * Math.sin(k * t);
      const z = zAmp * Math.sin(k * t);
      pts.push(new THREE.Vector3(x, y, z));
    }
    return { pts, N, span: rr + d, turns };
  },

  build(gear, pen) {
    if (!this.ready) return;
    const g = gear || { R: 96, r: 33, d: 24, curve: 'hypo' };
    const { pts, N, span, turns } = this.curvePoints(g);
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);

    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    const radius = Math.max(0.35, span * this.params.tube / (1 + turns * 0.12));
    const geo = new THREE.TubeGeometry(curve, Math.min(N * 2, 12000), radius, 10, true);

    const col = new THREE.Color(pen && pen.color || '#e8e6e1');
    if (!this.mat) {
      this.mat = new THREE.MeshStandardMaterial({
        metalness: 0.35, roughness: 0.3
      });
    }
    this.mat.color.copy(col);
    this.mat.emissive.copy(col).multiplyScalar(0.16);
    this.mat.opacity = clamp(pen && pen.opacity != null ? pen.opacity : 1, 0.25, 1);
    this.mat.transparent = this.mat.opacity < 0.99;

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.scene.add(this.mesh);

    // frame it (only when (re)entering 3D, so orbiting survives live rebuilds)
    const dist = span * 5.2;
    this.controls.target.set(0, 0, 0);
    if (this._frame) {
      this._frame = false;
      this.camera.position.set(dist * 0.12, -dist * 0.72, dist * 0.5);
      this.controls.update();
    }
    this.camera.near = Math.max(0.5, span / 80); this.camera.far = dist * 14;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  },

  /* ---------- sizing / loop ---------- */
  resize(w, h) {
    if (!this.ready) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },
  start(gear, pen, w, h) {
    if (!this.ready) return false;
    this.on = true;
    this._frame = true;                 // frame the view on entry
    this.build(gear, pen);
    this.resize(w, h);
    const loop = () => {
      if (!this.on) return;
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      this.composer.render();
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(loop);
    return true;
  },
  stop() {
    this.on = false;
    cancelAnimationFrame(this._raf);
    if (this._rec && this._rec.state === 'recording') this.stopRecord();
  },
  set(k, v) {
    this.params[k] = v;
    if (k === 'bloom' && this.bloom) this.bloom.strength = v;
    if (k === 'spin' && this.controls) { this.controls.autoRotateSpeed = v; this.controls.autoRotate = v > 0.001; }
    if (k === 'depth' || k === 'tube') this._needsRebuild = true;
  },
  applyIfNeeded(gear, pen) {
    if (this._needsRebuild) { this._needsRebuild = false; this.build(gear, pen); }
  },

  /* ---------- export ---------- */
  // high-resolution still: render offscreen at `scale`, restore afterwards
  async snapshot(scale = 2) {
    if (!this.ready) return null;
    const w = this.canvas.width, h = this.canvas.height;
    const dpr = this.renderer.getPixelRatio();
    const cssW = w / dpr, cssH = h / dpr;
    const target = clamp(scale, 1, 4);
    this.renderer.setPixelRatio(Math.min(dpr * target, 4));
    this.resize(cssW, cssH);
    this.composer.render();
    const blob = await new Promise(res => this.canvas.toBlob(res, 'image/png'));
    this.renderer.setPixelRatio(dpr);
    this.resize(cssW, cssH);
    this.composer.render();
    return blob;
  },
  // record exactly one full auto-rotation → a seamless loop
  startRecord(onDone, onTick) {
    if (!this.ready || (this._rec && this._rec.state === 'recording')) return false;
    const stream = this.canvas.captureStream(30);
    let mime = '';
    for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }
    if (!window.MediaRecorder) return false;
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
    this._recChunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) this._recChunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(this._recChunks, { type: mime || 'video/webm' });
      this._recChunks = [];
      onDone && onDone(blob);
    };
    this._rec = rec;
    // OrbitControls autoRotateSpeed: 1 ≈ 2π/60s → seconds for a full turn
    const spin = Math.max(0.05, this.controls.autoRotateSpeed);
    const secs = clamp(60 / spin, 3, 30);
    this.controls.autoRotate = true;
    rec.start();
    const t0 = performance.now();
    const tick = () => {
      if (!this._rec || this._rec.state !== 'recording') return;
      const p = (performance.now() - t0) / (secs * 1000);
      onTick && onTick(clamp(p, 0, 1));
      if (p >= 1) this.stopRecord(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  },
  stopRecord() {
    if (this._rec && this._rec.state === 'recording') this._rec.stop();
  },
  recording() { return !!(this._rec && this._rec.state === 'recording'); }
};

window.Spiro3D = Spiro3D;
window.dispatchEvent(new Event('spiro3d-ready'));
