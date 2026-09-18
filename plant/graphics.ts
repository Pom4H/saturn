export const escape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function chartSVG(rows: Record<string, unknown>[], x: string, y: string): string {
    const points = rows.map((r, i) => ({ x: Number(r[x] ?? i), y: r[y] === null ? null : Number(r[y]) })).filter(p => Number.isFinite(p.x));
    const good = points.filter(p => p.y !== null && Number.isFinite(p.y));
    if (!good.length)
        return '<p>Нет достоверных данных для графика.</p>';
    const x0 = Math.min(...good.map(p => p.x)), x1 = Math.max(...good.map(p => p.x)), y0 = Math.min(0, ...good.map(p => p.y!)), y1 = Math.max(...good.map(p => p.y!));
    let path = '', pen = false;
    for (const p of points) {
        if (p.y === null || !Number.isFinite(p.y)) {
            pen = false;
            continue;
        }
        const px = 50 + (p.x - x0) / Math.max(1, x1 - x0) * 680, py = 190 - (p.y - y0) / Math.max(.001, y1 - y0) * 160;
        path += `${pen ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)} `;
        pen = true;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 220" role="img" aria-label="${escape(y)}"><path d="M50 20V190H740" fill="none" stroke="#8795a2"/><path d="${path}" fill="none" stroke="#087f8c" stroke-width="2"/><text x="3" y="28" font-size="12">${y1.toFixed(2)}</text><text x="3" y="192" font-size="12">${y0.toFixed(2)}</text></svg>`;
}
