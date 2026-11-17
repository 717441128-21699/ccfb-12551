import type { SurveyPoint } from './types.ts';

/**
 * 养护组高程 CSV 解析。
 * 支持带表头（中英文列名自动识别）或纯三列数字：
 *   x, y, z / X,Y,Z / 东坐标,北坐标,高程 / name,easting,northing,elev ...
 * 允许逗号/分号/制表符分隔，# 开头注释，跳过空行与坏行。
 */

export interface CsvResult {
  points: SurveyPoint[];
  skipped: number;
  warnings: string[];
}

const HEADER_MAP: Record<string, 'x' | 'y' | 'z'> = {
  x: 'x',
  y: 'y',
  z: 'z',
  easting: 'x',
  northing: 'y',
  east: 'x',
  north: 'y',
  elev: 'z',
  elevation: 'z',
  height: 'z',
  '高程': 'z',
  '标高': 'z',
  '海拔': 'z',
  '东坐标': 'x',
  '北坐标': 'y',
  '东': 'x',
  '北': 'y',
};

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(';')) return line.split(';').map((s) => s.trim());
  return line.split(',').map((s) => s.trim());
}

export function parseSurveyCsv(text: string): CsvResult {
  const warnings: string[] = [];
  const points: SurveyPoint[] = [];
  let skipped = 0;
  const lines = text.split(/\r?\n/);

  let colX = 0;
  let colY = 1;
  let colZ = 2;
  let headerDetected = false;

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = splitLine(line);

    if (idx === 0 && cells.some((c) => Number.isNaN(Number(c)))) {
      // 表头行
      headerDetected = true;
      let xFound = false;
      let yFound = false;
      let zFound = false;
      cells.forEach((c, i) => {
        const key = c.toLowerCase().replace(/\s+/g, '');
        const mapped = HEADER_MAP[key] ?? HEADER_MAP[c];
        if (mapped === 'x') {
          colX = i;
          xFound = true;
        } else if (mapped === 'y') {
          colY = i;
          yFound = true;
        } else if (mapped === 'z') {
          colZ = i;
          zFound = true;
        }
      });
      if (!xFound || !yFound || !zFound) {
        warnings.push('表头未识别出完整 x/y/z 列，回退为前三个数值列');
        colX = 0;
        colY = 1;
        colZ = 2;
      }
      return;
    }

    const x = Number(cells[colX]);
    const y = Number(cells[colY]);
    const z = Number(cells[colZ]);
    if ([x, y, z].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
      skipped++;
      if (warnings.length < 10) warnings.push(`第 ${idx + 1} 行数据非法，已跳过`);
      return;
    }
    points.push({ x, y, z });
  });

  if (!headerDetected && points.length > 0) {
    warnings.push('未检测到表头，按列顺序 x,y,z 解析');
  }
  if (points.length < 3) {
    throw new Error('有效高程点不足 3 个，无法构建地形');
  }
  return { points, skipped, warnings };
}
