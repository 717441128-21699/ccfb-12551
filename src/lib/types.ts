/** 全局统一单位：长度米(m)、速度米/秒(m/s)、时间秒(s)、角度内部用弧度。 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 养护组测量的一个高程点。 */
export interface SurveyPoint extends Vec3 {}

/** 三角形顶点索引（逆时针为正方向），n 为邻接三角形索引，-1 表示边界。 */
export interface Triangle {
  a: number;
  b: number;
  c: number;
  /** 与边 ab / bc / ca 相邻的三角形 */
  nAB: number;
  nBC: number;
  nCA: number;
  /** 对应边是否为整个 TIN 的边界边 */
  boundaryAB: boolean;
  boundaryBC: boolean;
  boundaryCA: boolean;
}

export interface Barycentric {
  tri: number;
  /** 顶点 a/b/c 的权重 */
  wA: number;
  wB: number;
  wC: number;
}

/** 坡度查询结果。 */
export interface SlopeInfo {
  /** 坡度百分比，1 = 1%（rise/run*100） */
  percent: number;
  /** 坡度角（度） */
  degrees: number;
  /** 下坡方向单位向量（水平面，指向海拔降低方向） */
  downhill: Vec2;
  /** 平面法向量（单位化，朝上） */
  normal: Vec3;
  /** 坡向角（度，数学坐标，0=+x，逆时针为正；渲染时按需要换算方位角） */
  aspectDeg: number;
}
