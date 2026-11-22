import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ObjectInstanceId } from '@/data/types';
import { getAllTimelineObjects } from '@/data/arObjects';
import {
  OBJECT_ACCENT,
  OBJECT_SHORT_LABEL,
  GRID_COLUMNS,
  CELL_X,
  CELL_Z,
  HOME_EULER,
  DIM_OPACITY,
  BASE_FOV,
  FIT_FILL,
} from '@/data/arLayout';
import { loadObjectModel, clearModelCache } from './ModelLoader';
import { ARInteractionController, type InteractionMode } from './ARInteractionController';
import { TransformService, type TransformSnapshot } from './TransformService';

// ──────────────────────────────────────────────
// ARSceneManager
//
// Scene Three.js untuk tampilan AR Modul 1 (camera preview +
// overlay 3D, BUKAN tracking AR/WebXR).
//
// - 8 model asli ditata 2 baris x 4 kolom pada "meja" miring
//   (komposisi gaya Modul 8) dan dibingkai otomatis ke area
//   bebas di antara kontrol atas dan panel bawah (view insets).
// - Setiap model berada di PIVOT group sendiri; interaksi
//   individual hanya menyentuh pivot itu.
// - Label/garis penghubung dirender HTML oleh HotspotLayer.
// - Menutup panel info TIDAK menghapus seleksi.
// ──────────────────────────────────────────────

export interface ScenePart {
  id: ObjectInstanceId;
  group: THREE.Group;
  half: THREE.Vector3;
  anchor: THREE.Vector3;
  label: string;
  color: string;
  isPlaceholder: boolean;
  missingFiles: string[];
  loadError?: string;
  home: TransformSnapshot;
}

export interface LoadReport {
  failed: { id: ObjectInstanceId; reason: string }[];
  missingTextures: { id: ObjectInstanceId; files: string[] }[];
}

interface Callbacks {
  onObjectSelect: (id: ObjectInstanceId | null) => void;
  onModeChange?: (mode: InteractionMode) => void;
  onLoadReport?: (report: LoadReport) => void;
  onReady?: () => void;
  onFrame?: () => void;
  /** Dipanggil tiap frame dengan XRFrame (hanya saat sesi WebXR berjalan). */
  onXRFrame?: (frame?: XRFrame) => void;
}

export class ARSceneManager {
  private container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private callbacks: Callbacks;
  private resizeObserver: ResizeObserver;

  /** Akar susunan (target mode GROUP). */
  readonly root = new THREE.Group();
  private rootHome: TransformSnapshot | null = null;
  readonly parts: ScenePart[] = [];

  private selectedId: ObjectInstanceId | null = null;
  private highlight: Set<ObjectInstanceId> | null = null;
  private ring: THREE.Mesh | null = null;
  private mode: InteractionMode = 'group';

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private interaction: ARInteractionController;

  private homePoints: THREE.Vector3[] = [];
  private insets = { top: 0, bottom: 0, left: 0, right: 0 };
  private viewCenter = new THREE.Vector3();
  private viewDistance = 2;
  private viewTween: number | null = null;
  private resetTween: number | null = null;
  private orbit: OrbitControls | null = null;
  private ambient!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  private loaded = false;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: Callbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    // Kanvas transparan: video kamera tetap terlihat di bawahnya.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.zIndex = '1';
    el.style.touchAction = 'none';
    container.appendChild(el);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, width / height, 0.01, 100);
    this.camera.position.set(0, 0, 2);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.2, 2.4, 1.6);
    this.keyLight = key;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.35);
    fill.position.set(-1.5, 0.8, -1);
    this.scene.add(fill);

    this.root.rotation.set(HOME_EULER.x, HOME_EULER.y, 0, HOME_EULER.order);
    this.scene.add(this.root);

    this.interaction = new ARInteractionController(container, this.camera, this.raycaster, {
      onTap: (x, y) => this.handleTap(x, y),
      onModeChange: (m) => {
        this.mode = m;
        this.callbacks.onModeChange?.(m);
      },
    });

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    this.renderer.setAnimationLoop(this.animate);
  }

  // ───────── render loop ─────────

  private animate = (_time?: number, frame?: XRFrame) => {
    if (this.disposed) return;
    this.callbacks.onXRFrame?.(frame);
    if (this.ring) {
      const m = this.ring.material as THREE.MeshBasicMaterial;
      m.opacity = 0.65 + Math.sin(performance.now() * 0.004) * 0.2;
    }
    this.orbit?.update();
    this.renderer.render(this.scene, this.camera);
    this.callbacks.onFrame?.();
  };

  private onResize() {
    if (this.renderer.xr.isPresenting) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.arMode) return; // AR: kamera dikendalikan WebXR / gyro
    if (this.loaded) this.setViewInsets(this.insets.top, this.insets.bottom, this.insets.left, this.insets.right, false);
  }

  isGestureActive(): boolean {
    return this.interaction.isGestureActive();
  }

  // ───────── loading + layout ─────────

  async load() {
    const objects = getAllTimelineObjects();
    const results = await Promise.all(objects.map((o) => loadObjectModel(o)));
    if (this.disposed) return;

    const rows = Math.ceil(objects.length / GRID_COLUMNS);
    const report: LoadReport = { failed: [], missingTextures: [] };

    results.forEach((res, i) => {
      const obj = objects[i];
      const col = i % GRID_COLUMNS;
      const row = Math.floor(i / GRID_COLUMNS);
      const pivot = res.pivot;
      pivot.userData.objectId = obj.id;
      pivot.position.set(
        (col - (GRID_COLUMNS - 1) / 2) * CELL_X,
        res.size.y / 2,
        (row - (rows - 1) / 2) * CELL_Z,
      );
      pivot.traverse((c) => {
        c.userData.objectId = obj.id;
      });
      this.root.add(pivot);

      const half = res.size.clone().multiplyScalar(0.5);
      this.parts.push({
        id: obj.id,
        group: pivot,
        half,
        anchor: new THREE.Vector3(0, half.y, 0),
        label: OBJECT_SHORT_LABEL[obj.id],
        color: OBJECT_ACCENT[obj.id],
        isPlaceholder: res.isPlaceholder,
        missingFiles: res.missingFiles,
        loadError: res.error,
        home: TransformService.snapshot(pivot),
      });
      if (res.isPlaceholder) report.failed.push({ id: obj.id, reason: res.error ?? 'gagal dimuat' });
      if (res.missingFiles.length) report.missingTextures.push({ id: obj.id, files: res.missingFiles });
    });

    for (const p of this.parts) {
      this.arHalfExtent.x = Math.max(this.arHalfExtent.x, Math.abs(p.group.position.x) + p.half.x);
      this.arHalfExtent.z = Math.max(this.arHalfExtent.z, Math.abs(p.group.position.z) + p.half.z);
    }
    this.rootHome = TransformService.snapshot(this.root);
    this.captureHomeHull();
    this.interaction.setMode('group');
    this.interaction.setTarget(this.root);
    this.loaded = true;
    this.setViewInsets(this.insets.top, this.insets.bottom, this.insets.left, this.insets.right, false);
    this.callbacks.onLoadReport?.(report);
    this.callbacks.onReady?.();
  }

  private captureHomeHull() {
    this.root.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    for (const p of this.parts) {
      for (let i = 0; i < 8; i++) {
        pts.push(
          p.group.localToWorld(
            new THREE.Vector3(i & 1 ? p.half.x : -p.half.x, i & 2 ? p.half.y : -p.half.y, i & 4 ? p.half.z : -p.half.z),
          ),
        );
      }
    }
    this.homePoints = pts;
  }

  getPart(id: ObjectInstanceId): ScenePart | undefined {
    return this.parts.find((p) => p.id === id);
  }

  // ───────── framing (area bebas antara kontrol atas & panel bawah) ─────────

  private computeFit(top: number, bottom: number, left: number, right: number) {
    const width = Math.max(this.container.clientWidth - left - right, 160);
    const height = Math.max(this.container.clientHeight, 1);
    const regionH = Math.max(height - top - bottom, 120);
    const center = new THREE.Vector3();
    if (this.homePoints.length === 0) return { center, distance: 2 };
    new THREE.Box3().setFromPoints(this.homePoints).getCenter(center);

    const cam = new THREE.PerspectiveCamera(BASE_FOV, width / regionH, 0.01, 100);
    const v = new THREE.Vector3();
    const fits = (d: number) => {
      cam.position.set(center.x, center.y, center.z + d);
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      for (const p of this.homePoints) {
        v.copy(p).project(cam);
        if (v.z > 1 || Math.abs(v.x) > FIT_FILL || Math.abs(v.y) > FIT_FILL) return false;
      }
      return true;
    };
    let lo = 0.2;
    let hi = 20;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { center, distance: hi };
  }

  private applyInsets(top: number, bottom: number, left: number, right: number) {
    this.insets = { top, bottom, left, right };
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const regionH = Math.max(height - top - bottom, 120);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * (height / regionH);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf));
    this.camera.aspect = width / height;
    const shiftY = (top - bottom) / 2;
    const shiftX = (left - right) / 2;
    if (Math.abs(shiftY) < 0.5 && Math.abs(shiftX) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, -shiftX, -shiftY, width, height);
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(center: THREE.Vector3, distance: number) {
    this.viewCenter.copy(center);
    this.viewDistance = distance;
    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.lookAt(center);
  }

  /** Area bebas kanvas (px dari tiap sisi) tempat model dibingkai. */
  setViewInsets(top: number, bottom: number, left = 0, right = 0, animate = true) {
    if (this.viewTween !== null) {
      cancelAnimationFrame(this.viewTween);
      this.viewTween = null;
    }
    if (!this.loaded || this.orbit || this.arMode || this.renderer.xr.isPresenting) {
      this.insets = { top, bottom, left, right };
      return;
    }
    const target = this.computeFit(top, bottom, left, right);
    if (!animate) {
      this.applyInsets(top, bottom, left, right);
      this.placeCamera(target.center, target.distance);
      return;
    }
    const from = { ...this.insets, distance: this.viewDistance, center: this.viewCenter.clone() };
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - t0) / 350, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const mix = (a: number, b: number) => a + (b - a) * e;
      this.applyInsets(mix(from.top, top), mix(from.bottom, bottom), mix(from.left, left), mix(from.right, right));
      this.placeCamera(from.center.clone().lerp(target.center, e), mix(from.distance, target.distance));
      this.viewTween = p < 1 ? requestAnimationFrame(tick) : null;
    };
    tick();
  }

  // ───────── AR (WebXR / gyro) — port dari Modul 8 ─────────

  /** true selama sesi WebXR atau mode cadangan kamera+gyro berjalan. */
  arMode = false;
  private baseScale = 1;
  readonly floorY = 0; // dasar susunan = y 0 pada root
  placedYaw = 0;
  readonly arHalfExtent = new THREE.Vector3(0.05, 0.05, 0.05);
  private rootBeforeAR: TransformSnapshot | null = null;
  private fallbackActive = false;
  private deviceOrientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  private screenOrientHandler: (() => void) | null = null;
  private readonly fallbackCamPos = new THREE.Vector3(0, 1.4, 0);
  private orientQuat = new THREE.Quaternion();
  private gotOrientation = false;
  private pendingPlace = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly Z_EULER_QUAT = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

  /** Penempatan awal AR (meter / radian): meja di depan & sedikit di bawah garis pandang. */
  static readonly SPAWN = {
    distance: 0.6,
    minElevation: THREE.MathUtils.degToRad(-28),
    maxElevation: THREE.MathUtils.degToRad(-16),
    fill: 0.9,
    width: 0.5,
  };

  get activeCamera(): THREE.PerspectiveCamera {
    return this.renderer.xr.isPresenting
      ? (this.renderer.xr.getCamera() as unknown as THREE.PerspectiveCamera)
      : this.camera;
  }

  get arBaseScale(): number {
    const S = ARSceneManager.SPAWN;
    return S.width / (2 * Math.max(this.arHalfExtent.x, this.arHalfExtent.z, 1e-6));
  }

  get modelWidthMeters(): number {
    if (!this.arMode) return 0;
    const size = new THREE.Box3().setFromObject(this.root).getSize(new THREE.Vector3());
    return Math.max(size.x, size.z);
  }

  get isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  computeSpawn(camPos: THREE.Vector3, camQuat: THREE.Quaternion, tanHalfH: number, tanHalfV: number) {
    const S = ARSceneManager.SPAWN;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat).normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
    const h = new THREE.Vector3(f.x, 0, f.z);
    if (h.lengthSq() < 0.15) {
      h.set(0, 1, 0).applyQuaternion(camQuat);
      h.y = 0;
    }
    if (h.lengthSq() < 1e-6) h.set(0, 0, -1);
    h.normalize();

    const vHalf = Math.atan(Math.max(tanHalfV, 0.2));
    let elev = THREE.MathUtils.clamp(pitch, S.minElevation, S.maxElevation);
    elev = THREE.MathUtils.clamp(elev, pitch - 0.6 * vHalf, pitch + 0.6 * vHalf);

    const center = new THREE.Vector3(
      camPos.x + h.x * S.distance * Math.cos(elev),
      camPos.y + S.distance * Math.sin(elev),
      camPos.z + h.z * S.distance * Math.cos(elev),
    );
    const yaw = Math.atan2(camPos.x - center.x, camPos.z - center.z);
    const t = Math.tan(S.fill * Math.atan(Math.max(tanHalfH, 0.2)));
    const hx = Math.max(this.arHalfExtent.x, 1e-6);
    const hz = Math.max(this.arHalfExtent.z, 1e-6);
    const fitScale = (t * S.distance) / (hx + t * hz);
    const capScale = S.width / (2 * Math.max(hx, hz));
    return { center, yaw, scale: Math.min(fitScale, capScale) };
  }

  placeCenterAt(center: THREE.Vector3, yaw: number, scale: number) {
    if (scale > 0 && Number.isFinite(scale)) this.baseScale = scale;
    this.placeAt(new THREE.Vector3(center.x, center.y + this.floorY * scale, center.z), yaw);
  }

  placeAt(point: THREE.Vector3, yaw: number) {
    this.placedYaw = yaw;
    this.root.scale.setScalar(this.baseScale);
    this.root.rotation.set(0, yaw, 0);
    this.root.position.set(point.x, point.y - this.floorY * this.root.scale.x, point.z);
    this.root.visible = true;
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  /** Reset AR: skala & yaw kembali ke nilai penempatan; posisi dunia tetap. */
  resetAR() {
    this.root.scale.setScalar(this.baseScale);
    this.root.rotation.set(0, this.placedYaw, 0);
  }

  /** Masuk mode AR. Transformasi susunan disimpan dan dipulihkan saat keluar. */
  enterAR(baseScale: number) {
    if (this.orbit) this.exitOrbit();
    if (this.viewTween !== null) {
      cancelAnimationFrame(this.viewTween);
      this.viewTween = null;
    }
    if (!this.rootBeforeAR) this.rootBeforeAR = TransformService.snapshot(this.root);
    this.clearSelection();
    this.arMode = true;
    this.interaction.setEnabled(false); // gesture jari tidak menggerakkan model; kamera = perangkat
    this.baseScale = baseScale;
    this.camera.clearViewOffset();
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    this.root.scale.setScalar(baseScale);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  exitAR() {
    this.stopFallback();
    this.arMode = false;
    this.baseScale = 1;
    this.setLightEstimation(false);
    this.root.visible = true;
    this.root.traverse((o) => {
      o.frustumCulled = true;
    });
    if (this.rootBeforeAR) TransformService.resetToSnapshot(this.root, this.rootBeforeAR);
    this.rootBeforeAR = null;
    this.interaction.setEnabled(true);
    this.onResize();
    const i = this.insets;
    this.setViewInsets(i.top, i.bottom, i.left, i.right, false);
  }

  setLightEstimation(active: boolean, environment?: THREE.Texture | null) {
    this.ambient.intensity = active ? 0.35 : 0.8;
    this.keyLight.intensity = active ? 0.8 : 1.1;
    this.scene.environment = active && environment ? environment : null;
  }

  startFallback(baseScale: number) {
    this.enterAR(baseScale);
    this.fallbackActive = true;
    this.camera.position.copy(this.fallbackCamPos);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 60;
    this.camera.near = 0.01;
    this.camera.aspect = Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    this.camera.updateProjectionMatrix();

    const applyOrientation = () => {
      const so = window.screen?.orientation?.angle ?? ((window.orientation as number | undefined) ?? 0);
      const screenQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(so));
      this.camera.quaternion.copy(this.orientQuat).multiply(ARSceneManager.Z_EULER_QUAT).multiply(screenQuat);
      this.camera.updateMatrixWorld();
    };

    this.gotOrientation = false;
    this.deviceOrientationHandler = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const alpha = e.alpha != null ? THREE.MathUtils.degToRad(e.alpha) : 0;
      this.orientQuat.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(e.beta), alpha, -THREE.MathUtils.degToRad(e.gamma), 'YXZ'));
      applyOrientation();
      if (!this.gotOrientation) {
        this.gotOrientation = true;
        if (this.pendingPlace) {
          this.pendingPlace = false;
          this.fallbackPlace();
        }
      }
    };
    window.addEventListener('deviceorientation', this.deviceOrientationHandler, true);
    this.screenOrientHandler = applyOrientation;
    window.screen?.orientation?.addEventListener?.('change', applyOrientation);
    window.addEventListener('orientationchange', applyOrientation);
    applyOrientation();
  }

  fallbackPlace() {
    if (!this.gotOrientation) {
      this.root.visible = false;
      this.pendingPlace = true;
      if (!this.pendingTimer) {
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          if (!this.pendingPlace) return;
          this.pendingPlace = false;
          this.gotOrientation = true;
          this.fallbackPlace();
        }, 800);
      }
      return;
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * (this.camera.aspect || 1);
    const { center, yaw, scale } = this.computeSpawn(this.fallbackCamPos, this.camera.quaternion, tanH, tanV);
    this.placeCenterAt(center, yaw, scale);
  }

  private stopFallback() {
    if (!this.fallbackActive) return;
    this.fallbackActive = false;
    this.pendingPlace = false;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    if (this.deviceOrientationHandler) {
      window.removeEventListener('deviceorientation', this.deviceOrientationHandler, true);
      this.deviceOrientationHandler = null;
    }
    if (this.screenOrientHandler) {
      window.screen?.orientation?.removeEventListener?.('change', this.screenOrientHandler);
      window.removeEventListener('orientationchange', this.screenOrientHandler);
      this.screenOrientHandler = null;
    }
  }

  // ───────── VIEW AR: orbit kamera (objek tidak disentuh) ─────────

  isOrbit(): boolean {
    return this.orbit !== null;
  }

  /** Kamera mengitari objek terpilih (atau seluruh susunan). Transformasi objek tidak berubah. */
  enterOrbit() {
    if (this.orbit || !this.loaded || this.arMode) return;
    if (this.viewTween !== null) {
      cancelAnimationFrame(this.viewTween);
      this.viewTween = null;
    }
    const part = this.selectedId ? this.getPart(this.selectedId) : undefined;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(part ? part.group : this.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;

    this.interaction.setEnabled(false);
    this.camera.clearViewOffset();
    this.camera.fov = BASE_FOV;
    this.camera.aspect = Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    this.camera.updateProjectionMatrix();

    const dir = this.camera.position.clone().sub(center);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    dir.normalize();
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(BASE_FOV) / 2)) * 1.15;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.lookAt(center);

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(center);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0.02; // tidak terbalik di atas/bawah
    controls.maxPolarAngle = Math.PI - 0.02;
    controls.minDistance = sphere.radius * 0.8;
    controls.maxDistance = dist * 4;
    controls.update();
    this.orbit = controls;
  }

  /** Kembali ke tampilan AR sebelumnya; seleksi dan transformasi dipertahankan. */
  exitOrbit() {
    if (!this.orbit) return;
    this.orbit.dispose();
    this.orbit = null;
    this.interaction.setEnabled(true);
    const i = this.insets;
    this.setViewInsets(i.top, i.bottom, i.left, i.right, false);
  }

  // ───────── tap / selection ─────────

  private handleTap(ndcX: number, ndcY: number) {
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const h of hits) {
      let cur: THREE.Object3D | null = h.object;
      while (cur) {
        if (cur.userData.objectId) {
          this.selectObject(cur.userData.objectId as ObjectInstanceId);
          return;
        }
        cur = cur.parent;
      }
    }
    // Ketuk ruang kosong: lepas seleksi (transformasi dipertahankan).
    this.clearSelection();
  }

  selectObject(id: ObjectInstanceId) {
    const part = this.getPart(id);
    if (!part) return;
    this.removeRing();
    this.selectedId = id;

    const radius = Math.max(part.half.x, part.half.z) * 1.15;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.92, radius, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(part.color), side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -part.half.y + 0.002;
    ring.userData.objectId = id;
    part.group.add(ring);
    this.ring = ring;

    this.mode = 'inspect';
    this.interaction.setMode('inspect');
    this.interaction.setTarget(part.group);
    this.callbacks.onModeChange?.('inspect');
    this.refreshDim();
    this.callbacks.onObjectSelect(id);
  }

  clearSelection() {
    const had = this.selectedId !== null;
    this.removeRing();
    this.selectedId = null;
    this.mode = 'group';
    this.interaction.setMode('group');
    this.interaction.setTarget(this.root);
    this.callbacks.onModeChange?.('group');
    this.refreshDim();
    if (had) this.callbacks.onObjectSelect(null);
  }

  getSelected() {
    return this.selectedId;
  }

  private removeRing() {
    if (!this.ring) return;
    this.ring.parent?.remove(this.ring);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring = null;
  }

  // ───────── highlight / dim ─────────

  /** Objek di luar himpunan diredupkan (tetap terlihat). null = semua normal. */
  setHighlight(ids: ObjectInstanceId[] | null) {
    this.highlight = ids === null ? null : new Set(ids);
    this.refreshDim();
  }

  isActive(id: ObjectInstanceId): boolean {
    if (this.selectedId) return id === this.selectedId;
    return this.highlight === null || this.highlight.has(id);
  }

  private refreshDim() {
    for (const p of this.parts) this.setOpacity(p, this.isActive(p.id) ? 1 : DIM_OPACITY);
  }

  private setOpacity(part: ScenePart, factor: number) {
    part.group.traverse((c) => {
      if (!(c instanceof THREE.Mesh) || c === this.ring) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) {
        if (!m.userData.orig) m.userData.orig = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
        const o = m.userData.orig as { transparent: boolean; opacity: number; depthWrite: boolean };
        m.opacity = o.opacity * factor;
        m.transparent = factor < 1 || o.transparent;
        m.depthWrite = factor < 1 ? false : o.depthWrite;
        m.needsUpdate = true;
      }
    });
  }

  // ───────── mode / reset ─────────

  getMode(): InteractionMode {
    return this.mode;
  }

  /** Reset hanya objek terpilih (seleksi & mode inspect dipertahankan). */
  resetSelectedObject() {
    const part = this.selectedId ? this.getPart(this.selectedId) : undefined;
    if (part) this.tweenTo([{ target: part.group, snap: part.home }], false);
  }

  /** Reset View: semua objek + susunan kembali ke komposisi awal, seleksi dilepas. */
  resetView() {
    this.clearSelection();
    if (this.arMode) {
      this.tweenTo(this.parts.map((p) => ({ target: p.group as THREE.Object3D, snap: p.home })), false);
      this.resetAR();
      return;
    }
    const items = this.parts.map((p) => ({ target: p.group as THREE.Object3D, snap: p.home }));
    if (this.rootHome) items.push({ target: this.root, snap: this.rootHome });
    this.tweenTo(items, true);
  }

  private tweenTo(items: { target: THREE.Object3D; snap: TransformSnapshot }[], refit: boolean) {
    if (this.resetTween !== null) cancelAnimationFrame(this.resetTween);
    const starts = items.map((it) => ({
      ...it,
      pos: it.target.position.clone(),
      quat: it.target.quaternion.clone(),
      scale: TransformService.getUserScale(it.target),
    }));
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - t0) / 300, 1);
      const e = 1 - Math.pow(1 - p, 3);
      for (const s of starts) {
        s.target.position.lerpVectors(s.pos, s.snap.position, e);
        s.target.quaternion.slerpQuaternions(s.quat, s.snap.quaternion, e);
        const us = s.scale + (s.snap.userScale - s.scale) * e;
        s.target.scale.setScalar((s.target.userData.baseScale ?? 1) * us);
        s.target.userData.userScale = us;
      }
      if (p < 1) this.resetTween = requestAnimationFrame(tick);
      else {
        this.resetTween = null;
        for (const s of starts) TransformService.resetToSnapshot(s.target, s.snap);
      }
    };
    tick();
    if (refit) this.setViewInsets(this.insets.top, this.insets.bottom, this.insets.left, this.insets.right, true);
  }

  // ───────── dispose ─────────

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.stopFallback();
    if (this.viewTween !== null) cancelAnimationFrame(this.viewTween);
    if (this.resetTween !== null) cancelAnimationFrame(this.resetTween);
    this.resizeObserver.disconnect();
    this.orbit?.dispose();
    this.orbit = null;
    this.interaction.dispose();
    this.removeRing();
    this.root.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => m.dispose());
      }
    });
    clearModelCache();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement);
  }
}
