import type { ObjectInstanceId } from './types';

// ──────────────────────────────────────────────
// Kategori navigasi AR + Alur Urutan Komponen.
//
// Semua id objek mengacu ke data nyata di arObjects.ts.
// Generasi II dan III belum memiliki model 3D di proyek ini,
// sehingga kategorinya bersifat informasi (generationId →
// generations.ts) dan TIDAK memalsukan model.
// ──────────────────────────────────────────────

export type CategoryId =
  | 'all'
  | 'generasi1'
  | 'generasi2'
  | 'generasi3'
  | 'generasi4'
  | 'mikroprosesor'
  | 'storage'
  | 'studi_kasus';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  color: string;
  /** null = semua objek */
  ids: ObjectInstanceId[] | null;
  /** Jika ada, kategori ini membuka materi generasi (generations.ts). */
  generationId?: number;
}

export const categories: CategoryDef[] = [
  { id: 'all', label: 'SEMUA', color: '#3a4658', ids: null },
  { id: 'generasi1', label: 'GENERASI I', color: '#ef6b4a', ids: ['vacuum_tube'], generationId: 1 },
  { id: 'generasi2', label: 'GENERASI II', color: '#18a999', ids: [], generationId: 2 },
  { id: 'generasi3', label: 'GENERASI III', color: '#f3a712', ids: [], generationId: 3 },
  {
    id: 'generasi4',
    label: 'GENERASI IV',
    color: '#8452d6',
    ids: ['intel_4004', 'semiconductors', 'floppy_disk', 'intel_8086', 'ibm_pc_xt_5150', 'macintosh_classic', 'power_mac_g3'],
    generationId: 4,
  },
  { id: 'mikroprosesor', label: 'MIKROPROSESOR', color: '#2563eb', ids: ['intel_4004', 'intel_8086'] },
  { id: 'storage', label: 'STORAGE', color: '#0e7490', ids: ['floppy_disk'] },
  { id: 'studi_kasus', label: 'STUDI KASUS', color: '#d63960', ids: ['macintosh_classic', 'power_mac_g3'] },
];

export function getCategory(id: CategoryId): CategoryDef {
  return categories.find((c) => c.id === id)!;
}

export interface FlowItem {
  key: string;
  label: string;
  /** Membuka objek 3D (Info Message objek). */
  objectId?: ObjectInstanceId;
  /** Membuka materi generasi (tanpa model 3D). */
  generationId?: number;
}

// Urutan belajar Modul 1: Generasi I → II → III → IV, lalu komponen
// Generasi IV (semikonduktor/LSI → mikroprosesor → storage → evolusi
// Intel → PC) dan ditutup studi kasus Pentium vs PowerPC.
// Ini BUKAN timeline kronologis objek (urutan scene tetap di arObjects.ts).
export const learningFlow: FlowItem[] = [
  { key: 'g1', label: 'Generasi I · Tabung Hampa', objectId: 'vacuum_tube', generationId: 1 },
  { key: 'g2', label: 'Generasi II · Transistor', generationId: 2 },
  { key: 'g3', label: 'Generasi III · IC', generationId: 3 },
  { key: 'g4', label: 'Generasi IV · MOSFET/LSI', generationId: 4 },
  { key: 'semi', label: 'Semikonduktor', objectId: 'semiconductors' },
  { key: '4004', label: 'Intel 4004', objectId: 'intel_4004' },
  { key: 'floppy', label: 'Floppy Disk · Storage', objectId: 'floppy_disk' },
  { key: '8086', label: 'Intel 8086', objectId: 'intel_8086' },
  { key: 'ibm', label: 'IBM PC XT 5150', objectId: 'ibm_pc_xt_5150' },
  { key: 'mac', label: 'Macintosh Classic', objectId: 'macintosh_classic' },
  { key: 'pmg3', label: 'Power Mac G3 · PowerPC', objectId: 'power_mac_g3' },
];
