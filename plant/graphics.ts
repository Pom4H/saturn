export const escape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ChartOptions {
    type?: 'line' | 'bar';
    unit?: string;
}

const formatNumber = (value: number): string => {
    const absolute = Math.abs(value);
    const digits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
};

export function chartSVG(rows: Record<string, unknown>[], x: string, y: string, options: ChartOptions = {}): string {
    const source = rows.map((row, index) => {
        const rawX = row[x] ?? index;
        const numericX = Number(rawX);
        const rawY = row[y];
        const numericY = rawY === null || rawY === undefined ? null : Number(rawY);
        return { index, rawX, numericX, y: numericY !== null && Number.isFinite(numericY) ? numericY : null };
    });
    const good = source.filter(point => point.y !== null);
    if (!good.length) return '<p class="pv-empty">Нет достоверных данных для графика.</p>';

    const width = 920, height = 300, left = 58, right = 18, top = 18, bottom = 42;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const numericAxis = source.every(point => Number.isFinite(point.numericX));
    const xMin = numericAxis ? Math.min(...source.map(point => point.numericX)) : 0;
    const xMax = numericAxis ? Math.max(...source.map(point => point.numericX)) : Math.max(1, source.length - 1);
    const values = good.map(point => point.y!);
    const yMin = Math.min(0, ...values), yMaxRaw = Math.max(...values), yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw;
    const px = (point: typeof source[number]) => left + ((numericAxis ? point.numericX : point.index) - xMin) / Math.max(1e-9, xMax - xMin) * plotWidth;
    const py = (value: number) => top + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;
    const baseline = py(Math.max(yMin, Math.min(0, yMax)));
    const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);
    const yGrid = yTicks.map(value => {
        const yy = py(value);
        return `<path d="M${left} ${yy.toFixed(2)}H${width-right}" class="chart-grid"/><text x="${left-10}" y="${(yy+4).toFixed(2)}" text-anchor="end" class="chart-tick">${escape(formatNumber(value))}</text>`;
    }).join('');
    const tickStep = Math.max(1, Math.ceil(source.length / 8));
    const xTicks = source.filter((_, index) => index % tickStep === 0 || index === source.length - 1).map(point => {
        const xx = px(point);
        const label = typeof point.rawX === 'number' && Number.isInteger(point.rawX) ? String(point.rawX).padStart(2, '0') : String(point.rawX);
        return `<text x="${xx.toFixed(2)}" y="${height-13}" text-anchor="middle" class="chart-tick">${escape(label)}</text>`;
    }).join('');

    let marks = '';
    if ((options.type ?? 'line') === 'bar') {
        const barWidth = Math.max(3, Math.min(28, plotWidth / Math.max(1, source.length) * .64));
        marks = source.map(point => {
            if (point.y === null) return '';
            const xx = px(point) - barWidth / 2, yy = py(point.y);
            const rectY = Math.min(yy, baseline), rectHeight = Math.max(1, Math.abs(baseline - yy));
            return `<rect x="${xx.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" rx="3" class="chart-bar"><title>${escape(String(point.rawX))}: ${escape(formatNumber(point.y))}${options.unit ? ' '+escape(options.unit) : ''}</title></rect>`;
        }).join('');
    } else {
        let path = '', pen = false;
        const dots: string[] = [];
        for (const point of source) {
            if (point.y === null) { pen = false; continue; }
            const xx = px(point), yy = py(point.y);
            path += `${pen ? 'L' : 'M'}${xx.toFixed(2)},${yy.toFixed(2)} `;
            pen = true;
            if (source.length <= 36)
                dots.push(`<circle cx="${xx.toFixed(2)}" cy="${yy.toFixed(2)}" r="2.5" class="chart-dot"><title>${escape(String(point.rawX))}: ${escape(formatNumber(point.y))}${options.unit ? ' '+escape(options.unit) : ''}</title></circle>`);
        }
        marks = `<path d="${path}" class="chart-line"/>${dots.join('')}`;
    }
    const unit = options.unit ? `<text x="${width-right}" y="12" text-anchor="end" class="chart-unit">${escape(options.unit)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(y)}" data-chart-type="${options.type ?? 'line'}"><style>.chart-grid{fill:none;stroke:#e5eaed;stroke-width:1}.chart-axis{fill:none;stroke:#93a1aa;stroke-width:1}.chart-tick{fill:#6b7881;font:12px ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}.chart-unit{fill:#6b7881;font:11px ui-sans-serif,system-ui,sans-serif}.chart-line{fill:none;stroke:#087f8c;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}.chart-dot{fill:#fff;stroke:#087f8c;stroke-width:1.5}.chart-bar{fill:#087f8c}</style>${yGrid}<path d="M${left} ${top}V${height-bottom}H${width-right}" class="chart-axis"/>${marks}${xTicks}${unit}</svg>`;
}
