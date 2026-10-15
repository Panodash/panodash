import { useRef, useState } from 'react';
import type { WidgetInstance } from '@panodash/widget-sdk';
import { WidgetShell } from './WidgetShell';

/**
 * The widget grid. Rearranging is drag-to-reorder: grab a card's grip and
 * hover over another card — the dragged card slots in live, and dropping
 * commits the order.
 */
export function Dashboard({
  widgets,
  onReorder,
  onCommitOrder,
  onEdit,
  onRemove,
  onResize,
  onShowHistory,
  onShare,
  onUpdateInstance,
}: {
  widgets: WidgetInstance[];
  onReorder: (fromId: string, toId: string) => void;
  onCommitOrder: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, w: number, h: number) => void;
  onShowHistory: (id: string) => void;
  onShare: (id: string) => void;
  onUpdateInstance: (updated: WidgetInstance) => Promise<void> | void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const lastSwap = useRef(0);

  return (
    <div className="dashboard">
      {widgets.map((instance) => (
        <WidgetShell
          key={instance.id}
          instance={instance}
          onEdit={() => onEdit(instance.id)}
          onRemove={() => onRemove(instance.id)}
          onResize={(w, h) => onResize(instance.id, w, h)}
          onShowHistory={() => onShowHistory(instance.id)}
          onShare={() => onShare(instance.id)}
          onUpdateInstance={onUpdateInstance}
          dragHandlers={{
            isDragging: dragId === instance.id,
            onDragStart: (e) => {
              setDragId(instance.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', instance.id);
            },
            onDragEnter: (e) => {
              if (dragId && dragId !== instance.id) e.preventDefault();
            },
            onDragOver: (e) => {
              if (!dragId || dragId === instance.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              // Throttle live re-slotting so fast pointer moves don't thrash.
              const now = performance.now();
              if (now - lastSwap.current > 120) {
                lastSwap.current = now;
                onReorder(dragId, instance.id);
              }
            },
            onDrop: (e) => {
              e.preventDefault();
              setDragId(null);
              onCommitOrder();
            },
            onDragEnd: () => {
              setDragId(null);
              onCommitOrder();
            },
          }}
        />
      ))}
    </div>
  );
}
