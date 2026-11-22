import { useState, useEffect } from 'react';
import { RotateCcw, GitCompare } from 'lucide-react';
import type { TimelineObject, Generation } from '@/data/types';
import { generations } from '@/data/generations';
import { learningFlow } from '@/data/learningFlow';
import { OBJECT_ACCENT } from '@/data/arLayout';
import type { ObjectInstanceId } from '@/data/types';

export type PanelState =
  | { kind: 'object'; obj: TimelineObject; modelNote?: string }
  | { kind: 'generation'; gen: Generation; modelIds: ObjectInstanceId[] }
  | null;

interface Props {
  panelRef?: React.Ref<HTMLElement>;
  panel: PanelState;
  onClose: () => void;
  onResetSelected: () => void;
  onOpenObject: (id: ObjectInstanceId) => void;
  onOpenGeneration: (id: number) => void;
  onOpenCaseStudy: () => void;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
function generationOf(obj: TimelineObject): Generation | undefined {
  const m = obj.generation.match(/Generasi\s+([IV]+)/i);
  return m ? generations.find((g) => g.id === ROMAN[m[1].toUpperCase()]) : undefined;
}

const CASE_STUDY_IDS: ObjectInstanceId[] = ['macintosh_classic', 'power_mac_g3'];

export function ARObjectInfoPanel({ panelRef, panel, onClose, onResetSelected, onOpenObject, onOpenGeneration, onOpenCaseStudy }: Props) {
  const [tab, setTab] = useState<'komponen' | 'generasi'>('komponen');
  const key = panel ? (panel.kind === 'object' ? panel.obj.id : `gen${panel.gen.id}`) : '';
  useEffect(() => setTab('komponen'), [key]);

  // Panel selalu ter-render; tertutup = di luar layar (transform), sehingga
  // posisi awalnya benar dan geser masuk dari bawah (sama dengan Modul 8).
  const open = panel !== null;
  const objPanel = panel?.kind === 'object' ? panel : null;
  const genPanel = panel?.kind === 'generation' ? panel : null;
  const accent = objPanel ? OBJECT_ACCENT[objPanel.obj.id] : '#8452d6';
  const objGen = objPanel ? generationOf(objPanel.obj) : undefined;
  const romans = ['', 'I', 'II', 'III', 'IV'];

  return (
    <section
      ref={panelRef}
      className={`ar8-info-panel ${open ? 'open' : ''}`}
      style={{ ['--panel-accent' as string]: accent }}
      aria-hidden={!open}
      aria-label="Info Message"
    >
      <div className="ar8-panel-handle" />
      <button className="ar8-panel-close" onClick={onClose} aria-label="Tutup Info Message">
        ×
      </button>
      <div className="ar8-info-category">
        {objPanel ? `${objPanel.obj.generation} · ${objPanel.obj.year}` : genPanel ? genPanel.gen.period : ''}
      </div>
      <h2 className="ar8-info-title">
        {objPanel ? objPanel.obj.name : genPanel ? `${genPanel.gen.name} — ${genPanel.gen.technology}` : ''}
      </h2>

      {objPanel && objGen && (
        <div className="ar8-panel-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'komponen'} className={`ar8-panel-tab ${tab === 'komponen' ? 'active' : ''}`} onClick={() => setTab('komponen')}>
            Komponen
          </button>
          <button role="tab" aria-selected={tab === 'generasi'} className={`ar8-panel-tab ${tab === 'generasi' ? 'active' : ''}`} onClick={() => setTab('generasi')}>
            {objGen.name}
          </button>
        </div>
      )}

      <div className="ar8-info-body">
        {objPanel && tab === 'komponen' && (
          <>
            {objPanel.modelNote && <p className="lesson-note">{objPanel.modelNote}</p>}
            <span className="lesson-meta">{objPanel.obj.technology}</span>
            <h3 className="lesson-heading">Ringkasan</h3>
            <p>{objPanel.obj.educationalInfo.summary}</p>
            <h3 className="lesson-heading">Poin penting</h3>
            <ul className="lesson-list">
              {objPanel.obj.educationalInfo.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            {objPanel.obj.educationalInfo.sourceNote && (
              <p className="lesson-source">Sumber materi: {objPanel.obj.educationalInfo.sourceNote}</p>
            )}
            {CASE_STUDY_IDS.includes(objPanel.obj.id) && (
              <button className="ar8-panel-link" onClick={onOpenCaseStudy}>
                <GitCompare size={14} /> Buka studi kasus Pentium vs PowerPC
              </button>
            )}
          </>
        )}

        {objPanel && tab === 'generasi' && objGen && <GenerationBody gen={objGen} />}

        {genPanel && (
          <>
            <GenerationBody gen={genPanel.gen} />
            <h3 className="lesson-heading">Model 3D terkait</h3>
            {genPanel.modelIds.length === 0 ? (
              <p className="lesson-note">
                Generasi ini belum memiliki model 3D khusus di Modul 1, dan tidak ada model lain yang diklaim
                mewakilinya. Pelajari materinya di sini, lalu lanjutkan ke generasi berikutnya.
              </p>
            ) : (
              <div className="ar8-panel-tabs">
                {genPanel.modelIds.map((id) => (
                  <button key={id} className="ar8-panel-tab" onClick={() => onOpenObject(id)}>
                    {learningFlow.find((f) => f.objectId === id)?.label ?? id}
                  </button>
                ))}
              </div>
            )}
            <div className="ar8-panel-tabs">
              {genPanel.gen.id > 1 && (
                <button className="ar8-panel-tab" onClick={() => onOpenGeneration(genPanel.gen.id - 1)}>
                  ← Generasi {romans[genPanel.gen.id - 1]}
                </button>
              )}
              {genPanel.gen.id < 4 && (
                <button className="ar8-panel-tab" onClick={() => onOpenGeneration(genPanel.gen.id + 1)}>
                  Generasi {romans[genPanel.gen.id + 1]} →
                </button>
              )}
            </div>
          </>
        )}

        {objPanel && (
          <div className="ar8-panel-foot">
            <button onClick={onResetSelected}>
              <RotateCcw size={13} /> Reset objek
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function GenerationBody({ gen }: { gen: Generation }) {
  return (
    <>
      <span className="lesson-meta">{gen.technology}</span>
      <h3 className="lesson-heading">Ringkasan</h3>
      <p>{gen.fullDescription}</p>
      <h3 className="lesson-heading">Poin penting</h3>
      <ul className="lesson-list">
        {gen.keyPoints.map((k, i) => (
          <li key={i}>{k}</li>
        ))}
      </ul>
    </>
  );
}
