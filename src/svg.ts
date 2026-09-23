const NS = 'http://www.w3.org/2000/svg';
export function el<K extends keyof SVGElementTagNameMap>(parent: SVGElement, tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node); return node;
}
