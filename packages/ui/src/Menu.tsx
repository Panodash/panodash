import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  checked?: boolean;
  danger?: boolean;
}

/** A non-interactive label that names the group of items beneath it. */
export interface MenuHeading {
  heading: string;
}

export type MenuEntry = MenuItem | MenuHeading | 'divider';

function isHeading(entry: MenuEntry): entry is MenuHeading {
  return entry !== 'divider' && 'heading' in entry;
}

/** Minimal dependency-free dropdown, closes on outside click and Escape. */
export function Menu({
  trigger,
  items,
  align = 'end',
  ariaLabel,
}: {
  trigger: ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A heading opens a section that runs until the next heading; a divider
  // closes one. Callers describe the menu as a flat list and still get
  // grouped semantics, with trailing items free of any group.
  const sections: { heading?: string; entries: (MenuItem | 'divider')[] }[] = [];
  for (const entry of items) {
    if (isHeading(entry)) {
      sections.push({ heading: entry.heading, entries: [] });
      continue;
    }
    if (entry === 'divider') {
      sections.push({ entries: ['divider'] });
      continue;
    }
    if (sections.length === 0) sections.push({ entries: [] });
    sections.at(-1)!.entries.push(entry);
  }

  function renderEntry(entry: MenuItem | 'divider', index: number) {
    if (entry === 'divider') return <div key={`divider-${index}`} className="menu-divider" />;
    return (
      <button
        key={entry.label}
        type="button"
        role="menuitem"
        className={`menu-item${entry.danger ? ' danger' : ''}`}
        onClick={() => {
          setOpen(false);
          entry.onSelect();
        }}
      >
        <span className="menu-check">{entry.checked ? '✓' : ''}</span>
        {entry.label}
      </button>
    );
  }

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        type="button"
        className="menu-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu-panel align-${align}`} role="menu">
          {sections.map((section, sectionIndex) =>
            section.heading === undefined ? (
              <Fragment key={`s${sectionIndex}`}>{section.entries.map(renderEntry)}</Fragment>
            ) : (
              <div
                key={`s${sectionIndex}`}
                className="menu-group"
                role="group"
                aria-label={section.heading}
              >
                <div className="menu-heading" aria-hidden="true">
                  {section.heading}
                </div>
                {section.entries.map(renderEntry)}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
