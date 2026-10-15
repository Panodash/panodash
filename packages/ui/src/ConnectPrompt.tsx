import { useState } from 'react';
import { BridgeActivationRequiredError } from '@panodash/core/bridge';

/**
 * Pre-connection state for OAuth widgets: one button that runs the consent
 * flow (must stay inside the click gesture) and refreshes on success.
 */
export function ConnectPrompt({
  service,
  onConnect,
  onConnected,
}: {
  service: string;
  onConnect: () => Promise<void>;
  onConnected: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; activationUrl?: string } | null>(null);

  return (
    <div className="connect-prompt">
      <p>Connect your {service} account to start tracking.</p>
      <button
        type="button"
        className="button-primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          onConnect()
            .then(onConnected)
            .catch((err: unknown) =>
              setError({
                message: err instanceof Error ? err.message : String(err),
                ...(err instanceof BridgeActivationRequiredError
                  ? { activationUrl: err.activationUrl }
                  : {}),
              }),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Connecting…' : `Connect ${service}`}
      </button>
      {error && (
        <p className="connect-error">
          <span>{error.message}</span>
          {error.activationUrl && (
            <>
              {' '}
              <a href={error.activationUrl} target="_blank" rel="noreferrer">
                Activate bridge →
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
