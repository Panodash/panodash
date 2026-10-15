import { useMemo, useState } from 'react';
import type { WidgetInstance } from '@panodash/widget-sdk';
import { widgetToSnippet } from '@panodash/core/share';

/** Read-only view of a widget's shareable snippet, with a copy button. */
export function ShareDialog({
  instance,
  onClose,
}: {
  instance: WidgetInstance;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(() => {
    try {
      return JSON.stringify(widgetToSnippet(instance), null, 2);
    } catch {
      return null;
    }
  }, [instance]);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Share widget">
        <div className="dialog-header">
          <h2>Share widget</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {snippet === null ? (
          <p className="feed-empty">This widget type can’t be shared from this build.</p>
        ) : (
          <>
            <p className="share-note">
              API keys, tokens, and references to your other widgets are removed automatically —
              this snippet is safe to post publicly. Others import it via{' '}
              <strong>Add widget → Import a shared widget</strong>.
            </p>
            <textarea
              className="share-code"
              readOnly
              rows={12}
              value={snippet}
              onFocus={(e) => e.target.select()}
              aria-label="Widget snippet"
            />
            <div className="dialog-actions">
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  void navigator.clipboard.writeText(snippet).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
              >
                {copied ? 'Copied ✓' : 'Copy snippet'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
