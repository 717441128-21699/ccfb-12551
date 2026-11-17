/**
 * 太阳位置计算（NOAA Solar Position Algorithm 简化版，精度约 0.1°，
 * 对可视化光照足够）。输入经纬度、时区与本地时刻，输出太阳高度角、
 * 方位角以及场景方向向量。
 *
 * 场景坐标约定：x = 东(East)，y = 北(North)，z = 上(Up)。
 */

export interface SunPosition {
  /** 太阳高度角（度，地平线上为正） */
  elevationDeg: number;
  /** 太阳方位角（度，正北=0，顺时针为正） */
  azimuthDeg: number;
  /** 指向太阳的单位方向（场景坐标 ENU） */
  direction: { x: number; y: number; z: number };
  /** 是否白天（高度角 > -0.833° 近似晨昏蒙影阈值） */
  isDay: boolean;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function sunPosition(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  /** UTC 偏移小时，如北京时间 +8 */
  utcOffsetHours: number,
): SunPosition {
  // 儒略日
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const d =
    date.getUTCDate() +
    (date.getUTCHours() +
      date.getUTCMinutes() / 60 +
      date.getUTCSeconds() / 3600 -
      utcOffsetHours) /
      24;
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd =
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (mo > 2 ? mo + 1 : mo + 13)) +
    d +
    b -
    1524.5;
  const t = (jd - 2451545.0) / 36525;

  // 平黄经、平近点角
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = rad(357.52911 + t * (35999.05029 - 0.0001537 * t));
  // 中心差
  const c =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const trueLon = rad(l0 + c);
  // 黄赤交角
  const epsilon = rad(
    23.439291 - 0.0130042 * t - 1.64e-7 * t * t + 2.2e-11 * t * t * t,
  );
  // 格林尼治恒星时
  const gms = (18.697374558 + 24.06570982441908 * (jd - 2451545.0)) % 24;
  const gmst = rad(gms * 15);
  const lat = rad(latitudeDeg);

  const decl = Math.asin(Math.sin(epsilon) * Math.sin(trueLon));
  const sinDec = Math.sin(decl);
  const cosDec = Math.cos(decl);
  // 时角
  const sha = Math.atan2(
    Math.cos(epsilon) * Math.sin(trueLon),
    Math.cos(trueLon),
  );
  const ha = gmst + rad(longitudeDeg) - sha;

  const sinEl = sinDec * Math.sin(lat) + cosDec * Math.cos(lat) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(
    -Math.sin(ha),
    Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha),
  );

  const elevationDeg = deg(elevation);
  // NOAA 约定：北=0，顺时针；atan2 结果平移到 [0,360)
  const azimuthDeg = (deg(az) + 360) % 360;

  const azR = rad(azimuthDeg);
  const elR = rad(elevationDeg);
  // ENU：东 = sin(az)·cos(el)，北 = cos(az)·cos(el)，上 = sin(el)
  return {
    elevationDeg,
    azimuthDeg,
    direction: {
      x: Math.sin(azR) * Math.cos(elR),
      y: Math.cos(azR) * Math.cos(elR),
      z: Math.sin(elR),
    },
    isDay: elevationDeg > -0.833,
  };
}
