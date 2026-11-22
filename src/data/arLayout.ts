import type { ObjectInstanceId } from './types';

// Komposisi scene AR (mengikuti pola Modul 8: label berwarna aksen,
// susunan meja miring, dua baris tanpa tumpang tindih).

export const OBJECT_ACCENT: Record<ObjectInstanceId, string> = {
  vacuum_tube: '#ef6b4a',
  intel_4004: '#3b82f6',
  semiconductors: '#0e9fbf',
  floppy_disk: '#38bdf8',
  intel_8086: '#8452d6',
  ibm_pc_xt_5150: '#94a3b8',
  macintosh_classic: '#f3a712',
  power_mac_g3: '#d63960',
};

export const OBJECT_SHORT_LABEL: Record<ObjectInstanceId, string> = {
  vacuum_tube: 'TABUNG HAMPA',
  intel_4004: 'INTEL 4004',
  semiconductors: 'SEMIKONDUKTOR',
  floppy_disk: 'FLOPPY DISK',
  intel_8086: 'INTEL 8086',
  ibm_pc_xt_5150: 'IBM PC XT',
  macintosh_classic: 'MAC CLASSIC',
  power_mac_g3: 'POWER MAC G3',
};

/** Susunan 2 baris x 4 kolom (urutan timeline: kiri→kanan, belakang→depan). */
export const GRID_COLUMNS = 4;
export const CELL_X = 0.44;
export const CELL_Z = 0.5;

/** Orientasi "meja dilihat dari atas" untuk seluruh susunan. */
export const HOME_EULER = { x: 0.95, y: -0.22, order: 'YXZ' as const };

export const DIM_OPACITY = 0.3;
export const BASE_FOV = 42;
export const FIT_FILL = 0.92;
