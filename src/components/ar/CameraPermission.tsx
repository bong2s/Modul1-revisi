interface Props {
  status: 'denied' | 'unsupported';
  onRetry: () => void;
  onDismiss: () => void;
}

// Banner non-blokir bergaya .ar-status Modul 8: scene 3D tetap hidup di belakangnya.
export function CameraPermission({ status, onRetry, onDismiss }: Props) {
  return (
    <div className="ar8-status" role="alert">
      <span>
        {status === 'denied'
          ? 'Izin kamera ditolak — pratinjau 3D tanpa kamera.'
          : 'Kamera tidak tersedia di perangkat/peramban ini — pratinjau 3D tanpa kamera.'}
      </span>
      <div className="ar8-status-actions">
        {status === 'denied' && <button onClick={onRetry}>Coba lagi</button>}
        <button onClick={onDismiss}>Buka viewer 3D</button>
      </div>
    </div>
  );
}
