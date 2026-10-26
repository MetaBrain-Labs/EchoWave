/**
 * SVG 路径关键帧插值。
 *
 * 将编译时提取的数值关键帧恢复为跨平台 SVG 路径，供 Reanimated 在 UI 线程逐帧调用。
 *
 * Responsibilities:
 * - 保留 SVG 形状命令并插值坐标值。
 * - 按原素材的 keyTimes 与 cubic-bezier 曲线对齐关键帧。
 *
 * Notes:
 * - 输入只包含本地固定动画数据，不解析 SVG 或 SMIL 文本。
 */
export type PathMorphAnimation = {
  segments: readonly string[];
  frames: readonly (readonly number[])[];
  keyTimes: readonly number[];
  keySplines: readonly (readonly [number, number, number, number])[];
};

function cubicCoordinate(t: number, first: number, second: number): number {
  'worklet';
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
}

function splineProgress(x: number, spline: readonly [number, number, number, number]): number {
  'worklet';
  let low = 0;
  let high = 1;
  // 固定二分步数，保证 React Native、Hermes 与浏览器得到相同的结果。
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const middle = (low + high) / 2;
    if (cubicCoordinate(middle, spline[0], spline[2]) < x) low = middle;
    else high = middle;
  }
  return cubicCoordinate((low + high) / 2, spline[1], spline[3]);
}

/** 使用原素材的关键帧时间和缓动曲线插值 SVG 路径。 */
export function interpolatePathMorph(animation: PathMorphAnimation, progress: number): string {
  'worklet';
  const firstFrame = animation.frames[0];
  if (progress <= 0) {
    let firstPath = animation.segments[0];
    for (let index = 0; index < firstFrame.length; index += 1) {
      firstPath += `${firstFrame[index]}${animation.segments[index + 1]}`;
    }
    return firstPath;
  }

  let segment = animation.keyTimes.length - 2;
  for (let index = 0; index < animation.keyTimes.length - 1; index += 1) {
    if (progress < animation.keyTimes[index + 1]) {
      segment = index;
      break;
    }
  }

  const start = animation.keyTimes[segment];
  const end = animation.keyTimes[segment + 1];
  const fraction = end <= start ? 1 : (progress - start) / (end - start);
  const eased = splineProgress(fraction, animation.keySplines[segment]);
  const from = animation.frames[segment];
  const to = animation.frames[segment + 1];
  let path = animation.segments[0];

  for (let index = 0; index < from.length; index += 1) {
    path += `${from[index] + (to[index] - from[index]) * eased}${animation.segments[index + 1]}`;
  }
  return path;
}

/** 将 SVG 旋转关键帧插值为六元素矩阵，避免交给原生端的 CSS 变换解析器。 */
export function interpolateRotation(
  frames: readonly (readonly number[])[],
  keyTimes: readonly number[],
  keySplines: readonly (readonly [number, number, number, number])[],
  progress: number,
): [number, number, number, number, number, number] {
  'worklet';
  let segment = keyTimes.length - 2;
  for (let index = 0; index < keyTimes.length - 1; index += 1) {
    if (progress < keyTimes[index + 1]) {
      segment = index;
      break;
    }
  }
  const start = keyTimes[segment];
  const end = keyTimes[segment + 1];
  const fraction = end <= start ? 1 : (progress - start) / (end - start);
  const eased = splineProgress(fraction, keySplines[segment]);
  const from = frames[segment];
  const to = frames[segment + 1];
  const x = from.length > 1 ? from[1] + (to[1] - from[1]) * eased : 0;
  const y = from.length > 2 ? from[2] + (to[2] - from[2]) * eased : 0;
  const angle = from[0] + (to[0] - from[0]) * eased;
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // SVG 围绕指定中心旋转；平移项保证中心不随旋转移动。
  return [cosine, sine, -sine, cosine, x - cosine * x + sine * y, y - sine * x - cosine * y];
}
