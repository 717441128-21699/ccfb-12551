import { delaunay } from '../src/lib/delaunay.ts';
import { Terrain } from '../src/lib/terrain.ts';
import type { SurveyPoint } from '../src/lib/types.ts';

/** 已知解析坡面：z = sx·x + sy·y + base，规则网格测点。 */
export function makePlaneGreen(
  sx = 0.03,
  sy = 0.04,
  size = 20,
  step = 1,
): { terrain: Terrain; analytic: { percent: number; degrees: number; downhill: { x: number; y: number } } } {
  const pts: SurveyPoint[] = [];
  const half = size / 2;
  for (let x = -half; x <= half + 1e-9; x += step) {
    for (let y = -half; y <= half + 1e-9; y += step) {
      pts.push({ x, y, z: sx * x + sy * y + 0.1 });
    }
  }
  const { points, triangles } = delaunay(pts);
  const terrain = new Terrain(points, triangles);
  const g = Math.hypot(sx, sy);
  return {
    terrain,
    analytic: {
      percent: 100 * g,
      degrees: (Math.atan(g) * 180) / Math.PI,
      // z = sx·x + sy·y：梯度 (sx,sy) 指向上坡，下坡取负
      downhill: { x: -sx / g, y: -sy / g },
    },
  };
}

/** 抖动测点但高程仍严格落在平面上（检验三角剖分鲁棒性）。 */
export function makeJitteredPlaneGreen(sx = 0.02, sy = -0.03, size = 16, step = 1, seed = 7) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const pts: SurveyPoint[] = [];
  const half = size / 2;
  for (let x = -half; x <= half + 1e-9; x += step) {
    for (let y = -half; y <= half + 1e-9; y += step) {
      const jx = x + (rand() - 0.5) * step * 0.4;
      const jy = y + (rand() - 0.5) * step * 0.4;
      pts.push({ x: jx, y: jy, z: sx * jx + sy * jy + 0.2 });
    }
  }
  const { points, triangles } = delaunay(pts);
  const g = Math.hypot(sx, sy);
  return {
    terrain: new Terrain(points, triangles),
    analytic: {
      percent: 100 * g,
      degrees: (Math.atan(g) * 180) / Math.PI,
      downhill: { x: -sx / g, y: -sy / g },
    },
  };
}

/**
 * 脊形果岭：沿 x 方向的山脊 z = H·exp(-(y/W)²)，
 * 坡顶在 y=0，南北两侧下坡，用于洞位在坡顶边缘的越界测试。
 */
export function makeRidgeGreen(H = 0.6, W = 5, size = 18, step = 0.5) {
  const pts: SurveyPoint[] = [];
  const half = size / 2;
  for (let x = -half; x <= half + 1e-9; x += step) {
    for (let y = -half; y <= half + 1e-9; y += step) {
      pts.push({ x, y, z: H * Math.exp(-(y * y) / (W * W)) });
    }
  }
  const { points, triangles } = delaunay(pts);
  return { terrain: new Terrain(points, triangles), half, H, W };
}

/** 带碗形起伏的综合果岭（UI 演示用数据同款）。 */
export function makeBowlGreen(size = 24, step = 1) {
  const pts: SurveyPoint[] = [];
  const half = size / 2;
  for (let x = -half; x <= half + 1e-9; x += step) {
    for (let y = -half; y <= half + 1e-9; y += step) {
      const r2 = x * x + y * y;
      const z = 0.08 + 0.004 * r2 + 0.15 * Math.exp(-((x - 3) ** 2 + (y + 2) ** 2) / 12);
      pts.push({ x, y, z });
    }
  }
  const { points, triangles } = delaunay(pts);
  return new Terrain(points, triangles);
}
