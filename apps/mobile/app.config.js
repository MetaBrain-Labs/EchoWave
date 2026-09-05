/**
 * EchoWave Expo 动态构建配置。
 *
 * 在不提交 Firebase 服务账号密钥的前提下，为官方或自行构建者接入 Android 客户端配置。
 *
 * Responsibilities:
 * - 优先读取 EAS secret file 提供的 GOOGLE_SERVICES_JSON 路径。
 * - 本地存在 google-services.json 时把它加入原生 Android 构建。
 *
 * Notes:
 * - google-services.json 是客户端配置；FCM v1 服务账号私钥必须只上传 EAS Credentials。
 */
const { existsSync } = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const environmentFile = process.env.GOOGLE_SERVICES_JSON?.trim();
  const localFile = path.join(process.cwd(), 'google-services.json');
  const googleServicesFile =
    environmentFile || (existsSync(localFile) ? './google-services.json' : null);

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
