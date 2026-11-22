import { RotateCcw, ScanLine, Orbit } from 'lucide-react';
import { categories, type CategoryId } from '@/data/learningFlow';

export type CameraStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unsupported';

interface Props {
  category: CategoryId;
  cameraStatus: CameraStatus;
  onCategory: (id: CategoryId) => void;
  onResetView: () => void;
  onToggleAR: () => void;
  /** true selama sesi AR (starting/placing/placed): tombol mulai & badge disembunyikan. */
  inAR?: boolean;
  onViewAR: () => void;
}

export function statusText(s: CameraStatus): string {
  switch (s) {
    case 'active':
      return 'KAMERA + OVERLAY 3D · bukan AR terlacak';
    case 'requesting':
      return 'MEMINTA IZIN KAMERA…';
    case 'denied':
      return 'PRATINJAU 3D · izin kamera ditolak';
    case 'unsupported':
      return 'PRATINJAU 3D · kamera tidak tersedia';
    default:
      return 'PRATINJAU 3D · bukan AR terlacak';
  }
}

export function countLabel(ids: unknown[] | null, total: number): string {
  const n = ids === null ? total : ids.length;
  return n === 0 ? 'INFO' : String(n);
}

/** Struktur sama dengan Modul 8: .top-bar → .filter-bar + .top-actions + .mode-badge. */
export function ARCameraHUD({ category, cameraStatus, onCategory, onResetView, onToggleAR, inAR = false, onViewAR }: Props) {
  const total = 8;
  return (
    <>
      <div className="ar8-filter-bar" role="tablist" aria-label="Kategori materi">
        {categories.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            className={`ar8-filter-btn ${category === c.id ? 'active' : ''} ${c.id !== 'all' ? 'colored' : ''}`}
            style={{ ['--pill-color' as string]: c.color }}
            onClick={() => onCategory(c.id)}
          >
            {c.label} <small>{countLabel(c.ids, total)}</small>
          </button>
        ))}
      </div>
      <div className="ar8-top-actions">
        <button className="ar8-reset-btn" onClick={onResetView}>
          <RotateCcw size={14} /> Reset View
        </button>
        {!inAR && (
          <>
            <button className="ar8-view-btn" onClick={onViewAR}>
              <Orbit size={14} /> VIEW AR
            </button>
            <button className="ar8-ar-btn" onClick={onToggleAR}>
              <ScanLine size={14} /> Mulai AR
            </button>
          </>
        )}
      </div>
      {!inAR && <div className="ar8-mode-badge">{statusText(cameraStatus)}</div>}
    </>
  );
}
