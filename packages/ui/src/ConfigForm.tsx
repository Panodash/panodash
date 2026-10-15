import type { ConfigField } from '@panodash/widget-sdk';

/**
 * Renders a widget provider's declarative config schema as form fields.
 * Widget authors describe fields; they never build settings UI.
 */
export function ConfigForm({
  fields,
  values,
  onChange,
  widgetOptions = [],
}: {
  fields: ConfigField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Options for 'widget'-type fields: the user's other metric widgets. */
  widgetOptions?: { value: string; label: string }[];
}) {
  const visible = fields.filter(
    (f) => !f.visibleWhen || String(values[f.visibleWhen.key] ?? '') === f.visibleWhen.equals,
  );
  return (
    <>
      {visible.map((field) => {
        const raw = values[field.key];
        const common = {
          id: `cfg-${field.key}`,
          required: field.required,
          placeholder: field.placeholder,
        };
        let control;
        switch (field.type) {
          case 'textarea':
            control = (
              <textarea
                {...common}
                rows={3}
                value={String(raw ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            );
            break;
          case 'widget':
            control = (
              <select
                {...common}
                value={String(raw ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                <option value="">— choose a widget —</option>
                {widgetOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            );
            break;
          case 'select':
            control = (
              <select
                {...common}
                value={String(raw ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            );
            break;
          case 'number':
            control = (
              <input
                {...common}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={raw === undefined || raw === '' ? '' : Number(raw)}
                onChange={(e) =>
                  onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            );
            break;
          default:
            control = (
              <input
                {...common}
                type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
                value={String(raw ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
                autoComplete="off"
              />
            );
        }
        return (
          <div className="form-field" key={field.key}>
            <label htmlFor={`cfg-${field.key}`}>{field.label}</label>
            {control}
            {field.help && <p className="form-help">{field.help}</p>}
          </div>
        );
      })}
    </>
  );
}
