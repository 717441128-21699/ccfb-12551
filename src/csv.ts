import type { ElevPoint } from './types';

/**
 * 解析高程点 CSV。
 * 支持表头:x,y,z(大小写不敏感,也支持 east/north/elev 等常见列名),
 * 也支持无表头的纯三列数字。分隔符自动识别(逗号/分号/制表符)。
 */
export function parseCsv(text: string): ElevPoint[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) throw new Error('CSV 为空');

  const delim = detectDelim(lines[0]);
  const first = lines[0].split(delim).map(s => s.trim().toLowerCase());

  let xIdx = 0, yIdx = 1, zIdx = 2;
  let startLine = 0;
  const isHeader = first.some(c => isNaN(Number(c)));
  if (isHeader) {
    const find = (...names: string[]) => {
      const i = first.findIndex(c => names.includes(c));
      return i >= 0 ? i : -1;
    };
    xIdx = find('x', 'east', 'easting', 'e', '横坐标');
    yIdx = find('y', 'north', 'northing', 'n', '纵坐标');
    zIdx = find('z', 'elev', 'elevation', 'height', 'h', '高程');
    if (xIdx < 0 || yIdx < 0 || zIdx < 0) {
      throw new Error(`表头缺少 x/y/z 列:${first.join(', ')}`);
    }
    startLine = 1;
  }

  const pts: ElevPoint[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const x = Number(cols[xIdx]), y = Number(cols[yIdx]), z = Number(cols[zIdx]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      throw new Error(`第 ${i + 1} 行数据无法解析:${lines[i]}`);
    }
    pts.push({ x, y, z });
  }
  if (pts.length < 3) throw new Error('至少需要 3 个高程点');
  return pts;
}

function detectDelim(line: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, ' ': 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}
