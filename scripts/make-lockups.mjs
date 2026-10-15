// Regenerates Signal v1 lockups with JetBrains Mono embedded so the wordmark
// renders consistently when the SVG is used as an image.
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('apps/extension/public/fonts/jetbrains-mono-var.ttf').toString('base64');

function lockup({ pano, dash, sub }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 112" role="img" aria-labelledby="title">
  <title id="title">panodash_ — your whole signal, locally</title>
  <style>
    @font-face {
      font-family: 'JetBrains Mono Embedded';
      src: url(data:font/ttf;base64,${font}) format('truetype-variations');
      font-weight: 100 800;
    }
    .wordmark { font: 800 45px 'JetBrains Mono Embedded', 'JetBrains Mono', monospace; letter-spacing: -2px; }
    .tagline { font: 500 13px 'JetBrains Mono Embedded', 'JetBrains Mono', monospace; letter-spacing: 2.4px; }
  </style>
  <rect x="8" y="8" width="96" height="96" rx="20" fill="#0E1510"/>
  <rect x="38" y="32" width="24" height="48" rx="2" fill="#37FF8B"/>
  <rect x="70" y="68" width="12" height="12" rx="2" fill="#8FA894"/>
  <text x="126" y="60" class="wordmark"><tspan fill="${pano}">pano</tspan><tspan fill="${dash}">dash_</tspan></text>
  <text x="129" y="88" fill="${sub}" class="tagline">YOUR WHOLE SIGNAL, LOCALLY</text>
</svg>
`;
}

writeFileSync('brand/assets/panodash-lockup-light.svg', lockup({ pano: '#0A0F0B', dash: '#149E4E', sub: '#5F7A66' }));
writeFileSync('brand/assets/panodash-lockup-dark.svg', lockup({ pano: '#EAFBEA', dash: '#37FF8B', sub: '#8FA894' }));
console.log('Signal v1 lockups written with embedded JetBrains Mono');
