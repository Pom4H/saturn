/** Shared cool-metal grouping palette. Alarm colours belong to equipment, not zones. */
export const groupFill = (depth: number) => ['#eef3f5', '#e7eff2', '#f4f8fa', '#e9f1f4', '#f7fafb'][Math.min(4, Math.max(0, depth))];
export const groupStroke = '#a8bec8';
export const groupAccent = '#17879a';

/** SVG/Canvas headers share wrapping and always stay inside their backplate. */
export function groupTitleLines(title: string, width: number): string[] {
    const limit = Math.max(8, Math.floor((width - 40) / 9));
    const words = title.trim().split(/\s+/), lines: string[] = [];
    let current = '';
    for (const word of words) {
        if (current && current.length + word.length + 1 > limit) { lines.push(current); current = word; }
        else current += (current ? ' ' : '') + word;
    }
    if (current) lines.push(current);
    return lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(' ').slice(0, Math.max(1, limit - 1)) + '…'];
}
