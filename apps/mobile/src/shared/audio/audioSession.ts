/**
 * 应用音频会话所有权。
 *
 * 录音采集优先于前台播放，防止播放器覆盖后台录音配置。
 *
 * Responsibilities:
 * - 统一录音与播放互斥状态并广播变化。
 *
 * Notes:
 * - 不持久化音频状态，不处理网络请求。
 */
let recording = false;
const listeners = new Set<() => void>();
/** 更新录音优先权，播放控制器收到通知后立即暂停。 */
export function setRecordingAudioOwnership(value: boolean) {
  recording = value;
  for (const listener of listeners) listener();
}
/** 查询当前音频会话是否被录音持有。 */
export const isRecordingAudioOwner = () => recording;
/** 订阅会话所有权变化。 */
export function subscribeAudioOwnership(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let configuration = Promise.resolve();
/** 串行原生会话配置，录音等待先前播放器配置完成，避免旧异步调用覆盖录音。 */
export function configureAudioSession(operation: () => Promise<void>): Promise<void> {
  const next = configuration.catch(() => undefined).then(operation);
  configuration = next;
  return next;
}
