# EchoWave 安全策略 / Security Policy

## 当前支持状态

EchoWave `v0.1` 是开发预览版，尚无稳定发布分支或可下载的正式版本。安全修复只面向默认分支的最新代码；历史提交、Fork 和自行修改的部署不在维护范围内。

当前 API 使用固定开发租户，不具备真实鉴权、RBAC、速率限制和完整公网防护。可信本机和局域网可以使用 HTTP；任何云服务器或公网 App 服务端都必须由部署者提供 HTTPS、反向代理、最小化网络访问控制、备份和监控，并保持 API 3001 与 PostgreSQL 5432 不对公网开放。即使完成这些措施，仍不能替代项目尚未实现的应用级鉴权，也不应把当前版本作为公开多用户服务运行。

## 报告漏洞

请不要在公开 Issue、Discussion、Pull Request、日志或截图中披露漏洞利用代码、真实 Credential、用户数据或未脱敏的音频内容。

首选在 GitHub 仓库的 **Security → Report a vulnerability** 中提交私密报告。如果该入口尚未启用，请创建一个不包含技术细节的公开 Issue，标题使用 `[Security] Request private contact`，仅说明受影响范围和可联系的 GitHub 账号；维护者会提供私密沟通方式。

报告应尽量包含：

- 受影响的提交、组件、部署模式和平台。
- 漏洞影响与攻击所需前置条件。
- 最小、无真实数据的复现步骤。
- 已知缓解措施，以及是否已被公开披露。

请给维护者合理时间完成确认、修复和发布协调后再公开细节。维护者会在仓库能力范围内确认报告，但当前不承诺固定响应或修复时限。

## 高敏感边界

- `apps/api/.env`、`deploy/self-hosted/api.env`、Local Credential YAML、Database Credential、Keystore 和 Firebase 服务账号不得提交到仓库。
- `CONFIGURATION_ADMIN_TOKEN`、Provider API Key、OSS Secret、回调 Token、签名 URL 与音频正文不得出现在 Issue、测试 fixture 或诊断附件中。
- 移动端的 `EXPO_PUBLIC_*` 会进入公开 bundle，不能存放任何 Secret。
- AI 执行报告和 ASR 原始响应诊断默认关闭；启用时必须检查脱敏结果并限制目录访问与保留时间。
- HTTP 仅适用于 localhost、可信局域网和其他 App 明确接受的私有地址。任何云服务器或公网地址都必须使用 HTTPS；没有域名时可以使用受公众信任的公网 IP 证书，但短周期证书必须自动续期。当前版本仍不应作为公开多用户服务运行。

部署与 Credential 的详细规则见[配置指南](./docs/configuration.md)、[Server 部署指南](./docs/server-deployment.md)和[自托管指南](./docs/self-hosting.md)。

## English summary

EchoWave `v0.1` is a development preview supported only from the latest default-branch code. It has no real authentication or production public-internet boundary. Use it on a trusted LAN only.

Report vulnerabilities privately through GitHub **Security → Report a vulnerability**. If private reporting is unavailable, open a public issue titled `[Security] Request private contact` with no exploit details, secrets, personal data, or raw audio. Never place secrets in `EXPO_PUBLIC_*` variables, repository files, logs, screenshots, or public reports.
