import { useEffect, useRef } from 'react';
import { learningFlow, type FlowItem } from '@/data/learningFlow';

interface Props {
  flowRef?: React.Ref<HTMLElement>;
  activeKey: string | null;
  onPick: (item: FlowItem) => void;
}

export function ARFlowPanel({ flowRef, activeKey, onPick }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeKey]);

  return (
    <section className="ar8-component-flow" ref={flowRef as React.Ref<HTMLElement>}>
      <h2>ALUR URUTAN KOMPONEN</h2>
      <div className="ar8-component-flow-list" ref={listRef}>
        {learningFlow.map((item, i) => (
          <button
            key={item.key}
            data-active={activeKey === item.key}
            className={`ar8-component-flow-item ${activeKey === item.key ? 'active' : ''}`}
            onClick={() => onPick(item)}
          >
            <span className="ar8-component-flow-number">{i + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
