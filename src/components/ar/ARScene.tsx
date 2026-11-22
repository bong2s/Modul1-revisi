import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Move, ZoomIn, X } from 'lucide-react';
import { useAppState } from '@/state/AppContext';
import { ARSceneManager, type LoadReport } from '@/three/ARSceneManager';
import { HotspotLayer } from '@/three/HotspotLayer';
import { ARSession, type ARState } from '@/three/ARSession';
import { getTimelineObjectById } from '@/data/arObjects';
import { generations } from '@/data/generations';
import { categories, getCategory, learningFlow, type CategoryId, type FlowItem } from '@/data/learningFlow';
import type { ObjectInstanceId } from '@/data/types';
import { ARCameraHUD, type CameraStatus } from './ARCameraHUD';
import { ARObjectInfoPanel, type PanelState } from './ARObjectInfoPanel';
import { ARFlowPanel } from './ARFlowPanel';
import { CameraPermission } from './CameraPermission';


type PanelKey = { kind: 'object'; id: ObjectInstanceId } | { kind: 'generation'; id: number } | null;


export function ARScene() {
  const { setScreen, setSelectedObject, setInfoOpen, setARSessionState } = useAppState();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const hotspotHostRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const managerRef = useRef<ARSceneManager | null>(null);
  const sessionRef = useRef<ARSession | null>(null);
  const startCameraRef = useRef<() => Promise<boolean>>(async () => false);
  const arStateRef = useRef<ARState>('idle');
  const hotspotsRef = useRef<HotspotLayer | null>(null);
  const categoryRef = useRef<CategoryId>('all');
  const panelKeyRef = useRef<PanelKey>(null);
  const insetsRef = useRef({ top: 0, bottom: 0, left: 0, right: 0 });

  const [category, setCategoryState] = useState<CategoryId>('all');
  const [panelKey, setPanelKeyState] = useState<PanelKey>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('off');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [ready, setReady] = useState(false);
  const [warnDismissed, setWarnDismissed] = useState(false);
  const [report, setReport] = useState<LoadReport | null>(null);
  const [isViewAR, setIsViewAR] = useState(false);
  const [arState, setArStateUi] = useState<ARState>('idle');
  const [arXR, setArXR] = useState(false);
  const [arFallback, setArFallback] = useState(false);
  const [arNotice, setArNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<ObjectInstanceId | null>(null);

  const setCategory = useCallback((c: CategoryId) => {
    categoryRef.current = c;
    setCategoryState(c);
  }, []);
  const setPanelKey = useCallback((k: PanelKey) => {
    panelKeyRef.current = k;
    setPanelKeyState(k);
  }, []);

  const applyHighlight = useCallback((c: CategoryId) => {
    const ids = getCategory(c).ids;
    // Kategori informasi (Generasi II/III) tidak meredupkan apa pun:
    // tidak ada model yang dipalsukan sebagai wakilnya.
    managerRef.current?.setHighlight(ids === null || ids.length === 0 ? null : ids);
  }, []);

  // ───────── framing: area bebas (logika measureInsets Modul 8) ─────────
  const shown = (el: HTMLElement | null) => !!el && el.offsetParent !== null;
  const recomputeInsets = useCallback(() => {
    const stage = stageRef.current;
    const mgr = managerRef.current;
    const flow = flowRef.current;
    if (!stage || !mgr || !flow) return;
    const rect = stage.getBoundingClientRect();
    const panelOffset = Math.max(rect.bottom - flow.getBoundingClientRect().top + 8, 0);
    stage.style.setProperty('--panel-bottom', `${panelOffset}px`);

    let top = topRef.current ? topRef.current.getBoundingClientRect().bottom : rect.top;
    top = Math.max(top - rect.top + 8, 0);

    let bottomEdge = rect.bottom;
    const consider = (el: HTMLElement | null) => {
      if (shown(el)) bottomEdge = Math.min(bottomEdge, el!.getBoundingClientRect().top);
    };
    consider(flow);
    consider(hintsRef.current);
    consider(hudRef.current);

    let right = 0;
    const panel = panelRef.current;
    const sideSheet = window.matchMedia('(orientation: landscape) and (min-width: 700px)').matches;
    const panelOpen = !!panelKeyRef.current && !!panel;
    if (panelOpen) {
      if (sideSheet) right = panel!.offsetWidth + 10 + 8;
      else bottomEdge = Math.min(bottomEdge, rect.bottom - panelOffset - panel!.offsetHeight);
    }
    if (hudRef.current) hudRef.current.style.bottom = panelOpen && !sideSheet ? `${panelOffset + panel!.offsetHeight + 8}px` : '';
    const bottom = Math.max(rect.bottom - bottomEdge + 8, 0);
    insetsRef.current = { top, bottom, left: 0, right };
    mgr.setViewInsets(top, bottom, 0, right, true);
  }, []);

  // ───────── kamera (preview kamera + overlay 3D; BUKAN WebXR) ─────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setCameraStatus('unsupported');
      setARSessionState('unsupported');
      return false;
    }
    setCameraStatus('requesting');
    setARSessionState('requesting_permission');
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        if ((e as DOMException).name === 'NotAllowedError' || (e as DOMException).name === 'SecurityError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // tanpa kamera belakang
      }
      stopCamera();
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setCameraStatus('active');
      setARSessionState('placed');
      setBannerDismissed(false);
      return true;
    } catch (e) {
      const name = (e as DOMException).name;
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      setCameraStatus(denied ? 'denied' : 'unsupported');
      setARSessionState(denied ? 'permission_denied' : 'unsupported');
      setBannerDismissed(false);
      return false;
    }
  }, [setARSessionState, stopCamera]);
  startCameraRef.current = startCamera;

  // Mulai AR: sesi AR sungguhan (WebXR immersive-ar; cadangan kamera + gyro), sama seperti Modul 8.
  const startAR = useCallback(() => {
    if (arStateRef.current !== 'idle') return;
    setArNotice(null);
    void sessionRef.current?.start();
  }, []);

  // ───────── buat scene ─────────
  useEffect(() => {
    const host = canvasHostRef.current;
    const hsHost = hotspotHostRef.current;
    if (!host || !hsHost) return;

    const mgr = new ARSceneManager(host, {
      onObjectSelect: (id) => {
        setSelected(id);
        setSelectedObject(id);
        if (id) {
          const cat = getCategory(categoryRef.current);
          if (cat.ids !== null && cat.ids.length > 0 && !cat.ids.includes(id)) {
            setCategory('all');
            mgr.setHighlight(null);
          }
          setPanelKey({ kind: 'object', id });
          setInfoOpen(true);
        } else {
          if (panelKeyRef.current?.kind === 'object') setPanelKey(null);
          setInfoOpen(false);
        }
      },
      onLoadReport: (r) => setReport(r),
      onXRFrame: (frame) => sessionRef.current?.onFrame(frame),
      onFrame: () => {
        const layer = hotspotsRef.current;
        if (!layer || !stageRef.current) return;
        const m = managerRef.current;
        if (!m) return;
        layer.update(m.activeCamera, host, {
          selected: m.getSelected(),
          isActive: (id) => m.isActive(id),
          hidden: m.isOrbit() || (m.arMode && arStateRef.current !== 'placed'),
          gesture: m.isGestureActive(),
          bounds: {
            top: insetsRef.current.top,
            bottom: host.clientHeight - insetsRef.current.bottom,
            left: insetsRef.current.left,
            right: host.clientWidth - insetsRef.current.right,
          },
          rootScale: m.root.scale.x,
        });
      },
    });
    managerRef.current = mgr;
    // Hook baca-saja untuk pengujian: aktif hanya dengan ?debug di URL.
    if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as Record<string, unknown>).__garml = mgr;
    setARSessionState('loading');

    let cancelled = false;
    mgr.load().then(() => {
      if (cancelled) return;
      hotspotsRef.current = new HotspotLayer(hsHost, mgr.parts, (id) => mgr.selectObject(id));
      sessionRef.current = new ARSession(
        mgr,
        stageRef.current as HTMLElement,
        {
          start: () => startCameraRef.current(),
          stop: () => {
            stopCamera();
            setCameraStatus('off');
          },
        },
        {
          onState: (st) => {
            arStateRef.current = st;
            setArStateUi(st);
            setArFallback(sessionRef.current?.isFallbackActive ?? false);
            if (st === 'starting') {
              setPanelKey(null);
              setInfoOpen(false);
              setArNotice(null);
            }
          },
          onModeInfo: (info) => {
            setArXR(info.mode === 'WebXR');
            setArFallback(info.mode !== 'WebXR');
          },
          onEnded: (error) => {
            setArXR(false);
            setArFallback(false);
            setPanelKey(null);
            void startCameraRef.current();
            if (error) setArNotice(`Sesi AR gagal dimulai: ${error}. Pratinjau 3D tetap aktif.`);
          },
        },
      );
      setReady(true);
      setARSessionState('demo');
      void startCamera();
    });

    return () => {
      cancelled = true;
      hotspotsRef.current?.dispose();
      hotspotsRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      stopCamera();
      mgr.dispose();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hitung ulang area bingkai saat layout/panel berubah.
  useEffect(() => {
    if (!ready) return;
    recomputeInsets();
    const ro = new ResizeObserver(() => recomputeInsets());
    [topRef.current, flowRef.current, panelRef.current, hudRef.current, stageRef.current].forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [ready, panelKey, arState, recomputeInsets]);

  // ───────── aksi ─────────
  const openGeneration = useCallback(
    (genId: number) => {
      managerRef.current?.clearSelection();
      const cat = categories.find((c) => c.generationId === genId);
      if (cat) {
        setCategory(cat.id);
        applyHighlight(cat.id);
      }
      setPanelKey({ kind: 'generation', id: genId });
    },
    [applyHighlight, setCategory, setPanelKey],
  );

  const onCategory = useCallback(
    (id: CategoryId) => {
      managerRef.current?.clearSelection();
      setCategory(id);
      applyHighlight(id);
      const def = getCategory(id);
      if (def.generationId) setPanelKey({ kind: 'generation', id: def.generationId });
      else setPanelKey(null);
    },
    [applyHighlight, setCategory, setPanelKey],
  );

  const onFlowPick = useCallback(
    (item: FlowItem) => {
      if (item.objectId) managerRef.current?.selectObject(item.objectId);
      else if (item.generationId) openGeneration(item.generationId);
    },
    [openGeneration],
  );

  const onResetView = useCallback(() => {
    setCategory('all');
    managerRef.current?.setHighlight(null);
    setPanelKey(null);
    managerRef.current?.resetView();
  }, [setCategory, setPanelKey]);

  const startViewAR = useCallback(() => {
    managerRef.current?.enterOrbit();
    setIsViewAR(true);
  }, []);
  const exitViewAR = useCallback(() => {
    managerRef.current?.exitOrbit();
    setIsViewAR(false);
  }, []);

  const closePanel = useCallback(() => {
    setPanelKey(null);
    setInfoOpen(false);
  }, [setPanelKey, setInfoOpen]);

  // ───────── turunan tampilan ─────────
  let panel: PanelState = null;
  let activeFlowKey: string | null = null;
  if (panelKey?.kind === 'object') {
    const obj = getTimelineObjectById(panelKey.id);
    const part = managerRef.current?.getPart(panelKey.id);
    if (obj) {
      const note = part?.isPlaceholder
        ? `Model 3D asli belum termuat (${part.loadError ?? 'file hilang'}); yang tampil adalah kotak penanda sementara, bukan model asli.`
        : part?.missingFiles.length
          ? 'Model dimuat tanpa tekstur karena file tekstur tidak ditemukan.'
          : undefined;
      panel = { kind: 'object', obj, modelNote: note };
      activeFlowKey = learningFlow.find((f) => f.objectId === panelKey.id)?.key ?? null;
    }
  } else if (panelKey?.kind === 'generation') {
    const gen = generations.find((g) => g.id === panelKey.id);
    if (gen) {
      panel = { kind: 'generation', gen, modelIds: getCategory(categories.find((c) => c.generationId === gen.id)!.id).ids ?? [] };
      activeFlowKey = learningFlow.find((f) => f.generationId === gen.id && !f.objectId)?.key ?? learningFlow.find((f) => f.generationId === gen.id)?.key ?? null;
    }
  }

  const showBanner = !bannerDismissed && (cameraStatus === 'denied' || cameraStatus === 'unsupported');
  const failedCount = report?.failed.length ?? 0;

  return (
    <div ref={stageRef} className={`ar8-stage ${isViewAR ? "ar8-orbit" : ""} ${arState !== "idle" ? "ar8-ar" : ""} ${arXR ? "xr-active" : ""}`}>
      <video ref={videoRef} className="ar8-video" playsInline muted autoPlay style={{ opacity: cameraStatus === 'active' ? 1 : 0 }} />
      <div className="ar8-bg" style={{ opacity: cameraStatus === 'active' ? 0 : 1 }} />
      <div ref={canvasHostRef} className="ar8-canvas" />
      <div ref={hotspotHostRef} className="ar8-hotspot-host" />

      {!ready && <div className="ar8-loading">Memuat model 3D…</div>}

      <div ref={topRef} className="ar8-top-bar">
        <ARCameraHUD
          category={category}
          cameraStatus={cameraStatus}
          onCategory={onCategory}
          onResetView={onResetView}
          onToggleAR={startAR}
          inAR={arState === 'placing' || arState === 'placed' || arState === 'starting'}
          onViewAR={startViewAR}
        />
        {arNotice && (
          <div className="ar8-note" onClick={() => setArNotice(null)} title="Ketuk untuk menutup">
            {arNotice}
          </div>
        )}
        {ready && failedCount > 0 && !warnDismissed && panelKey === null && (
          <div className="ar8-note" onClick={() => setWarnDismissed(true)} title="Ketuk untuk menutup">
            {failedCount} model belum termuat — lihat README-MODEL.txt
          </div>
        )}
      </div>

      {showBanner && (
        <CameraPermission
          status={cameraStatus === 'denied' ? 'denied' : 'unsupported'}
          onRetry={() => void startCamera()}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <div ref={hintsRef} className="ar8-gesture-hints">
        <span className="ar8-gesture-hint"><RotateCw /> <strong>PUTAR</strong> <small>1 JARI</small></span>
        <span className="ar8-gesture-hint"><Move /> <strong>PINDAH</strong> <small>2 JARI</small></span>
        <span className="ar8-gesture-hint"><ZoomIn /> <strong>ZOOM</strong> <small>PINCH</small></span>
        {selected && (
          <button className="ar8-hint-reset" onClick={() => managerRef.current?.resetSelectedObject()}>
            <RotateCcw size={12} /> Reset objek
          </button>
        )}
      </div>

      {(arState === 'placing' || arState === 'placed') && (
        <div ref={hudRef} className="ar8-hud">
          {(() => {
            const msg =
              arState === 'placing'
                ? arFallback
                  ? 'Memulai AR...'
                  : 'Gerakkan HP perlahan sampai susunan komponen muncul.'
                : arFallback
                  ? 'Mode cadangan (BUKAN tracking AR): model hanya mengikuti putaran HP; posisi/langkah tidak terlacak.'
                  : '';
            return msg ? <p className="ar8-hud-message">{msg}</p> : null;
          })()}
          <div className="ar8-hud-buttons">
            {arState === 'placed' && (
              <>
                <button onClick={() => sessionRef.current?.replace()}>Tempatkan ulang</button>
                <button onClick={() => managerRef.current?.resetView()}>Reset</button>
              </>
            )}
            <button className="danger" onClick={() => sessionRef.current?.end()}>
              Keluar AR
            </button>
          </div>
        </div>
      )}

      <ARObjectInfoPanel
        panelRef={panelRef}
        panel={panel}
        onClose={closePanel}
        onResetSelected={() => managerRef.current?.resetSelectedObject()}
        onOpenObject={(id) => managerRef.current?.selectObject(id)}
        onOpenGeneration={openGeneration}
        onOpenCaseStudy={() => setScreen('comparison')}
      />

      <ARFlowPanel flowRef={flowRef} activeKey={activeFlowKey} onPick={onFlowPick} />

      {isViewAR && (
        <>
          <button className="ar8-orbit-back" onClick={exitViewAR}>
            <X size={16} /> KEMBALI
          </button>
          <div className="ar8-orbit-hint">GESER UNTUK MELIHAT SUDUT • PINCH UNTUK ZOOM</div>
        </>
      )}
    </div>
  );
}
