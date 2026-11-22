import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TimelineObject } from '@/data/types';
import { createPlaceholderMesh } from './PlaceholderFactory';

// ──────────────────────────────────────────────
// ModelLoader
//
// Memuat GLB/GLTF ASLI proyek. Hasilnya selalu berupa PIVOT group
// (tidak diskalakan, berpusat di origin) yang berisi model yang
// sudah dinormalisasi. Pivot inilah yang dipindah/diputar/di-zoom
// pengguna, sehingga cincin seleksi & label memakai satuan nyata.
//
// Penanganan file pendukung glTF:
// - .bin hilang  → geometri tidak ada → model GAGAL → kotak penanda
//   (placeholder) dipakai sementara dan DILAPORKAN (bukan disamarkan).
// - tekstur hilang → model tetap dimuat dengan tekstur kosong dan
//   dilaporkan sebagai file hilang.
// ──────────────────────────────────────────────

const loader = new GLTFLoader();

interface CacheEntry {
  scene: THREE.Group;
  missing: string[];
}

const modelCache = new Map<string, CacheEntry>();
const failedLoads = new Map<string, string>();

// PNG 1x1 putih, pengganti tekstur yang tidak ditemukan.
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

export interface LoadResult {
  /** Pivot: posisi/rotasi/skala pengguna dipasang di sini. */
  pivot: THREE.Group;
  isPlaceholder: boolean;
  /** Ukuran model (satuan scene) setelah normalisasi. */
  size: THREE.Vector3;
  error?: string;
  /** File pendukung yang tidak ditemukan (tekstur). */
  missingFiles: string[];
}

async function fileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    // Dev server mengembalikan index.html untuk path yang tidak ada.
    return !type.includes('text/html');
  } catch {
    return false;
  }
}

async function loadScene(url: string): Promise<CacheEntry> {
  if (!url.toLowerCase().endsWith('.gltf')) {
    const gltf = await loader.loadAsync(url);
    return { scene: gltf.scene, missing: [] };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = JSON.parse(await res.text());
  const base = url.slice(0, url.lastIndexOf('/') + 1);

  // Buffer (.bin) wajib ada.
  for (const b of json.buffers ?? []) {
    if (typeof b.uri === 'string' && !b.uri.startsWith('data:')) {
      if (!(await fileExists(base + b.uri))) {
        throw new Error(`file geometri hilang: ${b.uri}`);
      }
    }
  }

  // Tekstur boleh hilang: diganti tekstur kosong + dilaporkan.
  const missing: string[] = [];
  for (const img of json.images ?? []) {
    if (typeof img.uri === 'string' && !img.uri.startsWith('data:')) {
      if (!(await fileExists(base + img.uri))) {
        missing.push(img.uri);
        img.uri = BLANK_PNG;
      }
    }
  }

  const gltf = await loader.parseAsync(JSON.stringify(json), base);
  return { scene: gltf.scene, missing };
}

function prepare(scene: THREE.Group) {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial && mat.map) {
          mat.map.colorSpace = THREE.SRGBColorSpace;
        }
      }
    }
  });
}

function cloneGroup(source: THREE.Group): THREE.Group {
  const cloned = source.clone(true);
  cloned.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m) => m.clone())
        : child.material.clone();
    }
  });
  return cloned;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/** Normalisasi: sisi terpanjang = targetSize, pusat visual di origin pivot. */
function buildPivot(model: THREE.Group, obj: TimelineObject): { pivot: THREE.Group; size: THREE.Vector3 } {
  const holder = new THREE.Group();
  holder.add(model);
  holder.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  holder.updateMatrixWorld(true);

  _box.setFromObject(holder);
  _box.getSize(_size);
  const longest = Math.max(_size.x, _size.y, _size.z);
  const target = obj.targetSize ?? obj.targetHeight;
  const scale = longest > 1e-6 ? target / longest : 1;
  holder.scale.setScalar(scale);
  holder.updateMatrixWorld(true);

  _box.setFromObject(holder);
  _box.getCenter(_center);
  holder.position.sub(_center);

  const pivot = new THREE.Group();
  pivot.add(holder);
  pivot.userData.baseScale = 1;
  pivot.userData.userScale = 1;
  _box.getSize(_size);
  return { pivot, size: _size.clone() };
}

export async function loadObjectModel(obj: TimelineObject): Promise<LoadResult> {
  const ref = obj.modelPath;

  const fail = (reason: string): LoadResult => {
    const placeholder = createPlaceholderMesh(obj);
    const { pivot, size } = buildPivot(placeholder, obj);
    return { pivot, isPlaceholder: true, size, error: reason, missingFiles: [] };
  };

  if (failedLoads.has(ref)) return fail(failedLoads.get(ref)!);

  try {
    let entry = modelCache.get(ref);
    if (!entry) {
      entry = await loadScene(ref);
      prepare(entry.scene);
      modelCache.set(ref, entry);
    }
    const { pivot, size } = buildPivot(cloneGroup(entry.scene), obj);
    return { pivot, isPlaceholder: false, size, missingFiles: entry.missing };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'gagal dimuat';
    failedLoads.set(ref, reason);
    console.warn(`[M1 GARML] Model gagal dimuat: ${ref}`, err);
    return fail(reason);
  }
}

export function clearModelCache() {
  modelCache.clear();
  failedLoads.clear();
}
