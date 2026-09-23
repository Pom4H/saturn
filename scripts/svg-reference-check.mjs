import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Keep every vector/material attribute; normalize only generated IDs and live rotation. */
export function svgAnatomy(body) {
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE || node.hasAttribute('data-symbol-port')) return null;
    const attrs = Object.fromEntries([...node.attributes]
      .filter(a => !['data-anatomy', 'data-rpm'].includes(a.name) && !(a.name === 'transform' && node.dataset.part === 'rotor'))
      .map(a => [a.name, a.value.replace(/scada-\d+-(metal|dark)/g, '$1').replace(/(?:scada-\d+-tank-[\w-]+|saturn-vessel-\d+)/g, 'vessel')])
      .sort(([a], [b]) => a.localeCompare(b, 'en')));
    return [node.localName, attrs, [...node.childNodes].map(visit).filter(v => v !== null)];
  };
  return visit(body);
}
export async function checkOriginalAnatomy(page) {
  const reference = JSON.parse(await readFile('tests/fixtures/process-svg-original.json', 'utf8'));
  for (const [id, kind] of [['TK-01', 'tank'], ['P-01', 'pump']]) {
    const body = page.locator(`#studio-svg [data-node="${id}"] [data-part="body"]`).first();
    assert.deepEqual(await body.evaluate(svgAnatomy), reference.symbols[kind], `${kind}: original SVG paths, dimensions, fills and anatomy must remain unchanged`);
  }
}
