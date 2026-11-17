export interface ElevPoint {
  x: number; // 米,果岭局部坐标
  y: number;
  z: number; // 高程,米
}

export interface Green {
  id: string;
  name: string;
  hole: number;
  points: ElevPoint[];
}

export interface TurfSettings {
  stimpmeterFt: number;      // 斯坦普表读数(英尺)
  mowingHeightMm: number;    // 修剪高度(毫米)
  moisture: 'dry' | 'normal' | 'wet'; // 湿度
}

export interface Vec2 {
  x: number;
  y: number;
}
