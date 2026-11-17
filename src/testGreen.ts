import type { ElevPoint } from './types';

/**
 * 解析曲面已知的测试果岭:
 *   z(x,y) = a·x + b·y + A·sin(2πx/Lx)·cos(2πy/Ly)
 * 线性项给出恒定坡度,正弦项给出平滑起伏,梯度有解析式:
 *   ∂z/∂x = a + A·(2π/Lx)·cos(2πx/Lx)·cos(2πy/Ly)
 *   ∂z/∂y = b - A·(2π/Ly)·sin(2πx/Lx)·sin(2πy/Ly)
 */
export const TEST_GREEN = {
  width: 24,   // x 方向,米
  depth: 18,   // y 方向,米
  a: 0.022,    // x 方向基础坡度 2.2%
  b: 0.014,    // y 方向基础坡度 1.4%
  amp: 0.05,   // 起伏振幅 5cm
  lx: 12,
  ly: 12,
};

export function testGreenZ(x: number, y: number): number {
  const T = TEST_GREEN;
  return T.a * x + T.b * y + T.amp * Math.sin((2 * Math.PI * x) / T.lx) * Math.cos((2 * Math.PI * y) / T.ly);
}

export function testGreenGradient(x: number, y: number): { gx: number; gy: number } {
  const T = TEST_GREEN;
  const gx = T.a + T.amp * (2 * Math.PI / T.lx) * Math.cos((2 * Math.PI * x) / T.lx) * Math.cos((2 * Math.PI * y) / T.ly);
  const gy = T.b - T.amp * (2 * Math.PI / T.ly) * Math.sin((2 * Math.PI * x) / T.lx) * Math.sin((2 * Math.PI * y) / T.ly);
  return { gx, gy };
}

/**
 * 椭圆果岭的测量点布局:内部规则网格 + 边界环加密。
 * 边界环避免椭圆裁切产生狭长三角形(会放大坡度插值误差)。
 */
function ellipseGrid(cx: number, cy: number, rx: number, ry: number, spacing: number, z: (x: number, y: number) => number): ElevPoint[] {
  const pts: ElevPoint[] = [];
  // 内部网格:收进 0.9 倍椭圆,给边界环留出过渡带
  for (let x = cx - rx; x <= cx + rx + 1e-9; x += spacing) {
    for (let y = cy - ry; y <= cy + ry + 1e-9; y += spacing) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 0.81) continue;
      pts.push({ x, y, z: z(x, y) });
    }
  }
  // 边界环:弧长间隔 ≈ spacing
  const ringN = Math.max(24, Math.round((Math.PI * (rx + ry)) / spacing));
  for (let k = 0; k < ringN; k++) {
    const th = (2 * Math.PI * k) / ringN;
    const x = cx + rx * Math.cos(th);
    const y = cy + ry * Math.sin(th);
    pts.push({ x, y, z: z(x, y) });
  }
  return pts;
}

/** 生成测试果岭测量点(网格 + 边界环,模拟真实测量) */
export function generateTestGreenPoints(spacing = 1.0): ElevPoint[] {
  const T = TEST_GREEN;
  return ellipseGrid(T.width / 2, T.depth / 2, T.width / 2, T.depth / 2, spacing, testGreenZ);
}

/**
 * 精度验证:比较曲面重建后的坡度与解析坡度。
 * 返回最大/平均偏差(百分点)。
 */
export function verifySlopeAccuracy(surface: {
  triangles: { a: number; b: number; c: number }[];
  points: ElevPoint[];
  triGradients: { x: number; y: number }[];
}): { maxErrPct: number; meanErrPct: number; count: number } {
  let maxErr = 0, sumErr = 0, count = 0;
  for (let i = 0; i < surface.triangles.length; i++) {
    const t = surface.triangles[i];
    const cx = (surface.points[t.a].x + surface.points[t.b].x + surface.points[t.c].x) / 3;
    const cy = (surface.points[t.a].y + surface.points[t.b].y + surface.points[t.c].y) / 3;
    const analytic = testGreenGradient(cx, cy);
    const analyticMag = Math.hypot(analytic.gx, analytic.gy) * 100;
    const est = surface.triGradients[i];
    const estMag = Math.hypot(est.x, est.y) * 100;
    const err = Math.abs(estMag - analyticMag);
    maxErr = Math.max(maxErr, err);
    sumErr += err;
    count++;
  }
  return { maxErrPct: maxErr, meanErrPct: sumErr / count, count };
}

/** 生成一个示例果岭(18 洞中的第 7 洞),含常见微地形 */
export function generateSampleGreenPoints(): ElevPoint[] {
  const W = 26, D = 20;
  const z = (x: number, y: number) =>
    0.018 * x + 0.011 * y +
    0.35 * Math.exp(-(((x - 8) ** 2) / 30 + ((y - 12) ** 2) / 18)) -      // 后部大平台隆起
    0.22 * Math.exp(-(((x - 18) ** 2) / 16 + ((y - 6) ** 2) / 20)) +       // 右前集水洼
    0.05 * Math.sin(x * 0.9) * Math.cos(y * 0.7);                          // 微起伏
  return ellipseGrid(W / 2, D / 2, W / 2, D / 2, 1.5, z);
}
