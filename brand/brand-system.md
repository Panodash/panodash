# Panodash Signal Brand System

Version 1.0 · July 2026

Panodash is a calm instrument for seeing the signals that matter. The identity combines terminal heritage, local-first trust, and precise data visualization without drifting into generic developer-tool aesthetics.

## Core idea

**Signal in. Noise out.**

The system is mostly quiet ink and mist. Signal green identifies the one live, positive, or actionable thing in a view. It is a laser, not wallpaper.

## Identity

### Primary mark: The Cursor

The Cursor is a green block inside an Ink 800 rounded square, with one Mist 300 pixel. It evokes a terminal prompt, an active reading, and a locally running tool.

- Use the complete mark at 24 px and larger.
- At 16 px, use the green block cursor alone inside the dark container.
- The cursor may blink in product brand moments using stepped motion. Keep it static in print and routine product chrome.
- Never outline, skew, rotate, gradient-fill, or place the mark in a pill.

### Wordmark

The wordmark is lowercase `panodash_` in JetBrains Mono ExtraBold. Set `pano` in the surrounding text color and `dash_` in Signal green. The underscore belongs to the wordmark, not to ordinary buttons or navigation.

### Secondary mark: The Panes

Use an asymmetric four-pane grid when a broader systems metaphor is useful. Exactly one pane is Signal green; the others remain in the Ink ramp.

## Color

| Token | Hex | Role |
|---|---:|---|
| Ink 950 | `#060906` | App background |
| Ink 900 | `#0A0F0B` | Page sections |
| Ink 800 | `#0E1510` | Widget surface |
| Ink 700 | `#142017` | Raised and hover surfaces |
| Ink 600 | `#1C2B1F` | Borders and dividers |
| Ink 500 | `#2A4030` | Active borders and sparkline base |
| Mist 400 | `#5F7A66` | Disabled states and placeholders |
| Mist 300 | `#8FA894` | Secondary text |
| Mist 200 | `#C2D4C6` | Body text |
| Mist 100 | `#EAFBEA` | Headlines and metrics |
| Signal 500 | `#37FF8B` | Brand accent and positive delta |
| Signal 600 | `#23D96F` | Accent hover |
| Signal 700 | `#149E4E` | Accent pressed and light-mode signal |
| Alert 500 | `#FF5D5D` | Negative delta and error |
| Amber 500 | `#FFC53D` | Warning |
| Cyan 500 | `#4DD8E6` | Chart series 2 |
| Violet 500 | `#A78BFA` | Chart series 3 |

Follow the **90 / 9 / 1 rule**: roughly 90% Ink, 9% Mist, and 1% Signal. Do not use pure black, pure white, green body text, green paragraph backgrounds, or green gradients.

Components reference semantic tokens (`--page`, `--surface`, `--text-primary`, `--accent`, `--danger`) rather than raw primitives. The root-menu palette editor owns primitive customization and includes live contrast checks.

## Typography

### Data and brand voice

Use **JetBrains Mono** for the wordmark, metrics, numbers, labels, code, and compact navigation. Numeric values use tabular figures.

| Style | Weight | Size / line | Tracking |
|---|---:|---:|---:|
| Display | 800 | 40 / 44 | `-0.03em` |
| Metric large | 700 | 30 / 34 | `-0.02em` |
| Metric medium | 700 | 20 / 24 | `-0.01em` |
| Label | 500 | 11 / 14 | `0.18em`, uppercase |

### Explanatory voice

Use **Archivo** for body copy, settings, help text, and documentation. Default body copy is 15 / 24 at weight 400; captions are 12.5 / 18.

Both families are bundled in the extension under the SIL Open Font License so the MV3 package never requests remote font resources.

## Shape and spacing

- Base spacing unit: 4 px. Preferred steps: 4, 8, 12, 16, 20, 24, 32, 48.
- Chips and compact controls: 6 px radius.
- Widgets: 10 px radius.
- Modals and feature cards: 14 px radius.
- `999px` is reserved for status dots or truly circular controls, never default buttons.

## Effects and motion

- Signal glow: `0 0 24px rgba(55,255,139,.28)`, only for brand moments.
- Raised shadow: `0 8px 28px rgba(0,0,0,.5)`.
- Hover: 80 ms.
- State transition: 160 ms.
- Number roll-up: up to 600 ms.
- Brand cursor motion: `steps(6)`; utility motion uses a restrained cubic-bezier curve.
- Honor `prefers-reduced-motion`.

## Voice

Write with direct, compact confidence. Prefer instrument language—signal, view, local, history, snapshot—over surveillance or optimization language. Avoid “life OS,” fear-based privacy claims, and promises that imply Panodash controls outcomes.

Approved lines:

- Signal in. Noise out.
- Your whole signal, locally.
- Every metric you care about. One private new tab.
- See what matters. Keep it yours.

## Product expression

The dark product theme is the canonical brand expression. Light mode is an accessible inversion built from the same Ink, Mist, and Signal primitives. In either mode, give Signal green one job per view. Metrics remain monospaced; explanatory UI remains in Archivo; cards stay quiet until the user interacts with them.
