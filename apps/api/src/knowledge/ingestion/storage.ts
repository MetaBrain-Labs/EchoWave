/**
 * 知识原文件路径边界。
 *
 * 将服务器生成的随机键映射到受控目录，禁止数据库异常路径越界删除。
 *
 * Responsibilities:
 * - 校验存储键与历史暂存文件的绝对目标。
 *
 * Notes:
 * - 不读取配置或接收客户端文件路径。
 */
import path from 'node:path';
/** 仅接受上传时生成的 UUID 文件键。 */
export function knowledgeStoragePath(directory: string, key: string): string {
  if (!/^[0-9a-f-]{36}\.upload$/.test(key)) throw new Error('INVALID_STORAGE_KEY');
  return path.join(path.resolve(directory), key);
}
/** 历史暂存目标必须位于配置的知识或暂存目录内。 */
export function checkedKnowledgeFilePath(target: string, directories: string[]): string {
  const resolved = path.resolve(target);
  if (
    !directories.some((directory) => {
      const relative = path.relative(path.resolve(directory), resolved);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    })
  )
    throw new Error('INVALID_STORAGE_PATH');
  return resolved;
}
