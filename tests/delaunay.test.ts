import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delaunay, dedupe } from '../src/lib/delaunay.ts';
import type { SurveyPoint } from '../src/lib/types.ts';

test('三角形数量满足欧拉公式且全部覆盖测点凸包', () => {
  const pts: SurveyPoint[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      pts.push({ x: i, y: j, z: i * 0.1 + j * 0.05 });
    }
  }
  const { points, triangles } = delaunay(pts);
  assert.equal(points.length, 64);
  // 8×8 网格凸包边界顶点 28 个；n=64, h=28 → 三角数 2n-2-h = 96
  assert.equal(triangles.length, 2 * 64 - 2 - 28);
});

test('邻接关系自洽：每条内部边恰有两个邻接三角形', () => {
  const pts: SurveyPoint[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) pts.push({ x: i, y: j, z: 0 });
  const { triangles } = delaunay(pts);
  triangles.forEach((t, i) => {
    for (const n of [t.nAB, t.nBC, t.nCA]) {
      if (n >= 0) {
        const other = triangles[n];
        assert.ok([other.nAB, other.nBC, other.nCA].includes(i), '邻接必须双向指向');
      }
    }
    const boundaryCount = [t.boundaryAB, t.boundaryBC, t.boundaryCA].filter(Boolean).length;
    const nullCount = [t.nAB, t.nBC, t.nCA].filter((n) => n === -1).length;
    assert.equal(boundaryCount, nullCount, '边界边与空邻接必须一一对应');
  });
});

test('空圆性质：任意三角形外接圆内不含其他测点', () => {
  const pts: SurveyPoint[] = [];
  let s = 11;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = 0; i < 60; i++) pts.push({ x: rand() * 20, y: rand() * 20, z: rand() });
  const { points, triangles } = delaunay(pts);
  for (const t of triangles) {
    const a = points[t.a];
    const b = points[t.b];
    const c = points[t.c];
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
    const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
    const r2 = (a.x - ux) ** 2 + (a.y - uy) ** 2;
    for (const p of points) {
      if (p === a || p === b || p === c) continue;
      const dd = (p.x - ux) ** 2 + (p.y - uy) ** 2;
      assert.ok(dd >= r2 - 1e-9, '存在测点落入外接圆，Delaunay 性质被破坏');
    }
  }
});

test('重复测点去重后仍可剖分', () => {
  const pts: SurveyPoint[] = [
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 9 },
    { x: 1, y: 0, z: 2 },
    { x: 0, y: 1, z: 3 },
  ];
  assert.equal(dedupe(pts).length, 3);
  const r = delaunay(pts);
  assert.equal(r.triangles.length, 1);
});
