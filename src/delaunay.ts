/**
 * 手写 Delaunay 三角剖分(Bowyer-Watson 增量算法)。
 * 输入点索引返回三角形顶点索引三元组,顶点序为逆时针。
 */

export interface Triangle {
  a: number;
  b: number;
  c: number;
}

interface Pt { x: number; y: number }

function circumcircle(p1: Pt, p2: Pt, p3: Pt): { cx: number; cy: number; r2: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-12) return null; // 共线
  const a1 = p1.x * p1.x + p1.y * p1.y;
  const a2 = p2.x * p2.x + p2.y * p2.y;
  const a3 = p3.x * p3.x + p3.y * p3.y;
  const cx = (a1 * (p2.y - p3.y) + a2 * (p3.y - p1.y) + a3 * (p1.y - p2.y)) / d;
  const cy = (a1 * (p3.x - p2.x) + a2 * (p1.x - p3.x) + a3 * (p2.x - p1.x)) / d;
  const r2 = (p1.x - cx) ** 2 + (p1.y - cy) ** 2;
  return { cx, cy, r2 };
}

export function delaunay(points: Pt[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];

  // 包围所有点的超大三角形
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const pts: Pt[] = points.slice();
  pts.push(
    { x: midX - 20 * dmax, y: midY - dmax },
    { x: midX, y: midY + 20 * dmax },
    { x: midX + 20 * dmax, y: midY - dmax },
  );
  const s1 = n, s2 = n + 1, s3 = n + 2;

  let tris: Triangle[] = [{ a: s1, b: s2, c: s3 }];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    // 找出外接圆包含 p 的所有三角形(坏三角形)
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const t of tris) {
      const cc = circumcircle(pts[t.a], pts[t.b], pts[t.c]);
      if (cc && (p.x - cc.cx) ** 2 + (p.y - cc.cy) ** 2 <= cc.r2) bad.push(t);
      else good.push(t);
    }
    // 坏三角形区域的边界边:只出现一次的边
    const edgeCount = new Map<string, { i: number; j: number; count: number }>();
    const addEdge = (i: number, j: number) => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      const e = edgeCount.get(key);
      if (e) e.count++;
      else edgeCount.set(key, { i, j, count: 1 });
    };
    for (const t of bad) {
      addEdge(t.a, t.b); addEdge(t.b, t.c); addEdge(t.c, t.a);
    }
    tris = good;
    for (const { i: ei, j: ej, count } of edgeCount.values()) {
      if (count !== 1) continue;
      // 保证逆时针
      const cross = (pts[ej].x - pts[ei].x) * (p.y - pts[ei].y) - (pts[ej].y - pts[ei].y) * (p.x - pts[ei].x);
      if (cross > 0) tris.push({ a: ei, b: ej, c: i });
      else tris.push({ a: ej, b: ei, c: i });
    }
  }

  // 去掉含超三角形顶点的三角形
  return tris.filter(t => t.a < n && t.b < n && t.c < n);
}
