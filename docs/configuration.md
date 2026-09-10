# 配置与 Credential 指南

EchoWave 将服务端配置分成三个边界：`apps/api/.env` 保存启动级配置，PostgreSQL 保存租户级普通配置，Credential Provider 保存密钥。移动端还单独保存当前服务器根地址。AI 配置入口位于“更多 → AI 配置”，服务器地址位于“更多 → 服务状态”。

## 启动级 `.env`

从 `apps/api/.env.example` 创建本地 `.env`。API 只读取这一个文件，不合并启动进程的系统环境变量。除 HTTP、PostgreSQL、Redis、目录、FFmpeg、Worker 和诊断字段外，下列安全字段必须显式配置：

- `CREDENTIAL_MASTER_KEY`：恰好 32 个随机字节的规范 Base64，用于 AES-256-GCM。
- `CONFIGURATION_ADMIN_TOKEN`：至少 32 字符的随机管理口令。
- `LOCAL_CREDENTIALS_FILE`：服务器本地 YAML 的显式路径；不使用隐式默认路径。
- `TRUSTED_PROXY_CIDRS`：可覆写 `X-Forwarded-Proto` 的反向代理 IPv4/IPv6 CIDR，多个值用逗号分隔；没有可信代理时显式设置为空字符串。
- `PUSH_NOTIFICATIONS_ENABLED`：必须显式为 `true` 或 `false`；Self-hosted 默认使用 `false`。

供应商 URL、Bucket、模型、Thinking、DashScope 通知模式、回调 URL 和能力绑定不再属于启动级 `.env`。只有启用了 Expo Push access-token 安全的项目才设置可选 `EXPO_PUSH_ACCESS_TOKEN`；它是服务端 Secret，不能使用 `EXPO_PUBLIC_` 前缀。

## Local Credential Provider

本机部署可将 `LOCAL_CREDENTIALS_FILE` 指向：

- Linux/macOS：`~/.echowave/credentials.yaml`
- Windows：`C:\Users\<user>\.echowave\credentials.yaml`
- Docker：`/app/.data/secrets/credentials.yaml`

文件格式固定为：

```yaml
version: 1

credentials:
  dashscope-main:
    type: dashscope
    apiKey: sk-example
    eventBridgeCallbackToken: callback-example

  deepseek-main:
    type: deepseek
    apiKey: sk-example

  aliyun-oss-main:
    type: aliyun_oss
    accessKeyId: example-id
    accessKeySecret: example-secret
```

解析器拒绝未知字段、重复键、YAML 锚点/别名、自定义标签和超过 64 KiB 的文件，也不会执行环境变量插值。POSIX 文件必须仅服务账户可读：

```sh
chmod 600 ~/.echowave/credentials.yaml
```

Windows 应通过文件“属性 → 安全”仅授予当前用户或 API 服务账户读取权限。Docker 应以只读卷挂载并在宿主机设置 `0600`：

```yaml
services:
  api:
    volumes:
      - ./deploy/self-hosted/.data/secrets:/app/.data/secrets:ro
```

Provider 会在文件版本变化时完整重读，只有成功校验后才原子替换内存快照。无效更新会保留本进程最后一次有效快照供已创建任务继续使用，但阻止新连接或新能力绑定。Local alias 是任务版本的一部分；轮换时新增 alias、切换数据库连接引用，确认旧任务结束后再删除旧 alias，不要原地覆盖。

## 移动端服务器地址

`apps/mobile/.env` 由 Expo CLI 加载，客户端可见变量必须使用 `EXPO_PUBLIC_` 前缀，且会作为公开内容进入 bundle。`EXPO_PUBLIC_API_URL` 仅是 Development Build 或 Expo Go 尚无已保存地址时的开发默认值，不得包含密码或令牌。

App 将通过 `GET /health` 验证的规范化服务器根地址写入 AsyncStorage。已保存地址优先；REST、上传、SSE、音频媒体和推送设备登记都在请求发生时读取同一个运行时地址。修改服务器会终止旧连接、清空页面级状态并重新挂载业务导航。

`production-apk` 和 `production` profiles 设置 `EXPO_PUBLIC_REQUIRE_SERVER_SELECTION=true`，因此即使构建环境意外提供了 `EXPO_PUBLIC_API_URL`，Production Build 也会忽略它并要求首次手动连接。EAS 使用 remote app version source；自动发布只让 `production-apk` 递增 Android `versionCode`，用户可见 `version` 必须在提交中与稳定 Tag 和 Server package 版本保持一致。

地址只接受没有凭据、query、fragment 或业务路径的 HTTP/HTTPS origin。HTTP 仅允许 localhost、私有 IPv4、回环/链路本地 IPv6、共享地址空间和 `.local` 主机；公网地址必须使用 HTTPS。健康响应必须满足共享契约：

```json
{
  "name": "EchoWave",
  "service": "echowave-api",
  "version": "0.1.0",
  "apiVersion": 1,
  "status": "ok",
  "capabilities": {
    "remotePush": false
  }
}
```

`remotePush=false` 时 App 不请求通知权限、不加载设备注册流程；`true` 时仅原生 Build 会继续注册 Expo Push Token。Expo Go 保持安全降级。

## 连接安全规则

网页提交 Database Credential 仅允许三种情况：API socket 直接使用 HTTPS；真实 TCP 对端与 Host 都是 loopback/localhost；或真实 TCP 对端命中 `TRUSTED_PROXY_CIDRS` 且代理明确设置 `X-Forwarded-Proto: https`。非可信来源的转发头会被忽略。

HTTP + 非 localhost 时，页面持续显示：

> 当前连接不是 HTTPS，不能通过此页面提交 Credential。请在服务器本地配置 `credentials.yaml`，然后选择对应的 Local Credential alias。

此时 Secret 输入、粘贴、自动填充和提交均被禁用，服务端也会对任何嵌套、空值或批量 Secret 字段返回 `403 INSECURE_CREDENTIAL_TRANSPORT`。名称、HTTPS Base URL、模型、Thinking、通知方式、能力绑定和 Local alias 仍可修改。

所有普通管理请求使用 `Authorization: Bearer <CONFIGURATION_ADMIN_TOKEN>`。移动端仅在当前页面内存保存口令。远程 HTTP 下该口令没有传输机密性，存在被窃取和配置被篡改的风险；生产部署必须启用 HTTPS。

可编辑供应商 Base URL 必须为公网 HTTPS。服务端拒绝 localhost、私网、链路本地、保留地址、云元数据地址及解析到这些地址的域名。

## Database Credential 与任务 revision

Database Credential 使用随机 12 字节 IV、AES-256-GCM 认证标签以及绑定租户、Credential、版本和 Provider 类型的 AAD。API 只返回是否已配置和末四位掩码，不返回明文。

修改 Secret 会创建不可变 Credential version；修改连接会创建 Provider revision，并为受影响能力发布新的 binding revision。新请求使用当前 revision，已排队、运行、恢复或等待回调的任务继续使用创建时冻结的 revision。任务快照只保存 Database version ID 或 Local alias/type，不保存密钥。

## 从旧 `.env` 导入

升级期间可暂时保留旧 `DASHSCOPE_*`、`DEEPSEEK_*` 和 `ALIYUN_OSS_*` 变量。配置页只显示检测到的变量名和完整性，不显示值。点击“从服务器旧 `.env` 导入”后，API 在服务器内部读取 Secret、加密入库且不覆盖已有数据库配置；同一租户重复操作是幂等的。

导入可以在远程 HTTP 下触发，因为请求体不携带 Secret。导入成功后数据库立即优先并关闭该租户的 legacy fallback。随后删除旧供应商变量并重启，确认对应能力仍可运行；启动级字段继续保留。

如果不迁移旧 Secret，可先在服务器创建 `credentials.yaml`，然后通过配置页以 Local alias 建立连接。
