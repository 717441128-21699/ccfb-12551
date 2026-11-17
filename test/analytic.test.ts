/**
 * 解析测试果岭精度验证:
 * 用已知解析曲面生成测量点 → Delaunay 重建 → 比较每个三角形
 * 的坡度与解析坡度,要求最大偏差 ≤ 2 个百分点。
 * 运行:npm test
 */
import { GreenSurface } from '../src/surface';
import { generateTestGreenPoints, verifySlopeAccuracy, testGreenZ, TEST_GREEN } from '../src/testGreen';
import { delaunay } from '../src/delaunay';

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) failures++;
}

// 1. Delaunay 基本性质:单位正方形四点应剖分为两个三角形
{
  const tris = delaunay([
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]);
  check('Delaunay 正方形剖分', tris.length === 2, `得到 ${tris.length} 个三角形(期望 2)`);
}

// 2. 纯平面:重建坡度应与解析坡度完全一致
{
  const pts = [];
  for (let x = 0; x <= 20; x += 2) for (let y = 0; y <= 15; y += 2) {
    pts.push({ x, y, z: 0.03 * x + 0.02 * y });
  }
  const s = new GreenSurface(pts);
  const g = s.gradientAt(7.3, 5.1);
  const pct = g ? Math.hypot(g.x, g.y) * 100 : NaN;
  const expected = Math.hypot(0.03, 0.02) * 100;
  check(
    '平面坡度重建',
    Math.abs(pct - expected) < 1e-9,
    `重建 ${pct.toFixed(4)}% vs 解析 ${expected.toFixed(4)}%`,
  );
}

// 3. 测试果岭:含起伏的解析曲面,偏差 ≤ 2 个百分点
{
  const pts = generateTestGreenPoints();
  const surface = new GreenSurface(pts);
  const { maxErrPct, meanErrPct, count } = verifySlopeAccuracy(surface);
  check(
    '测试果岭坡度偏差 ≤ 2 个百分点',
    maxErrPct <= 2.0,
    `${count} 个三角形,最大偏差 ${maxErrPct.toFixed(3)} 个百分点,平均 ${meanErrPct.toFixed(3)}`,
  );
}

// 4. 高度插值:平面上任一点高度应与解析值一致
{
  const pts = generateTestGreenPoints();
  const surface = new GreenSurface(pts);
  let maxH = 0;
  for (let i = 0; i < 50; i++) {
    const x = 2 + (i * 0.37) % (TEST_GREEN.width - 4);
    const y = 2 + (i * 0.53) % (TEST_GREEN.depth - 4);
    const nx = (x - TEST_GREEN.width / 2) / (TEST_GREEN.width / 2);
    const ny = (y - TEST_GREEN.depth / 2) / (TEST_GREEN.depth / 2);
    if (nx * nx + ny * ny > 0.8) continue;
    const h = surface.heightAt(x, y);
    if (h === null) continue;
    // 与解析高度差应远小于 2cm(线性插值对正弦项有 O(h²) 误差)
    maxH = Math.max(maxH, Math.abs(h - testGreenZ(x, y)));
  }
  check('高度插值误差 < 2cm', maxH < 0.02, `最大高度误差 ${(maxH * 1000).toFixed(1)} mm`);
}

// 5. 等高线:平面上的等高线应为直线且间距正确
{
  const pts = [];
  for (let x = 0; x <= 20; x += 2) for (let y = 0; y <= 15; y += 2) {
    pts.push({ x, y, z: 0.05 * x });
  }
  const s = new GreenSurface(pts);
  const contours = s.contours(0.1);
  const levels = contours.map(c => c.level);
  const spacingOk = levels.every((l, i) => i === 0 || Math.abs(l - levels[i - 1] - 0.1) < 1e-9);
  check('等高线间距正确', spacingOk && contours.length > 0, `提取 ${contours.length} 条等高线,间距 0.1m`);
}

if (failures > 0) {
  console.error(`\n${failures} 项测试失败`);
  process.exit(1);
} else {
  console.log('\n全部测试通过');
}
