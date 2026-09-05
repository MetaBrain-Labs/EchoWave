/**
 * EchoWave Server 状态传输适配器。
 *
 * 复用共享健康探测，并为服务状态功能保留窄模块边界。
 *
 * Responsibilities:
 * - 暴露经过共享契约校验的服务健康请求。
 * - 复用统一的网络、超时和错误语义。
 *
 * Notes:
 * - 本模块不缓存健康状态。
 */
export {
  fetchServerHealth,
  ServerHealthError,
  type ServerHealthErrorCode,
} from '@/shared/api/serverHealth';
