/**
 * 亚像素摄像机：唯一的关键帧插值实现。
 * 生成逐帧浮点变换，避免整数裁切再放大造成跳动；Python 只执行这些矩阵。
 */
export function sampleCamera(keys, time) {
  if (time <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (time <= keys[i][0]) {
      const a = keys[i - 1],
        b = keys[i];
      const t = (time - a[0]) / (b[0] - a[0]);
      const eased = t * t * (3 - 2 * t);
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * eased);
    }
  }
  return keys.at(-1).slice(1);
}

export function cameraFrames(shot) {
  return Array.from({ length: shot.frames }, (_, i) => sampleCamera(shot.cameras, i / 30));
}

/** 检查选区、关键帧与事件边界，禁止空镜头、非法缩放或源数据越界。 */
export function validateCamera(shot, width, height) {
  const rects = [shot.bounds, shot.floating?.rect, shot.focus?.rect].filter(Boolean);
  for (const [x, y, w, h] of rects) {
    if (
      ![x, y, w, h].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      w <= 0 ||
      h <= 0 ||
      x + w > width ||
      y + h > height
    )
      throw new Error(`裁切越界：${shot.id}`);
  }
  if (!shot.cameras?.length || shot.cameras[0][0] !== 0) throw new Error('摄像机缺少首帧');
  for (const [i, k] of shot.cameras.entries()) {
    if (
      k.length !== 6 ||
      !k.every(Number.isFinite) ||
      k[1] <= 0 ||
      k[1] > 2.1 ||
      k[0] < 0 ||
      k[0] > shot.seconds ||
      (i && k[0] <= shot.cameras[i - 1][0])
    )
      throw new Error('非法摄像机关键帧');
  }
  for (const [time, x, y] of shot.pulses ?? []) {
    if (time < 0 || time >= shot.seconds || x < 0 || x > width || y < 0 || y > height)
      throw new Error('触摸事件越界');
  }
}
