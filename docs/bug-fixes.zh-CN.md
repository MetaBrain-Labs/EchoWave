# EchoWave 缺陷修复记录

[English](./bug-fixes.md) | **简体中文**

本文记录已经确认并修复的缺陷：复现方式、根因、修复方案与验证证据。它补充专题文档和 [Android E2E 问题汇总](./mobile-e2e-troubleshooting.zh-CN.md)：专题文档描述预期行为，本文只记录实际发生过的失败及其收敛方式。

## 已修复缺陷

| ID       | 现象                                                                                 | 影响范围                      | 状态   |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------- | ------ |
| `EW-001` | 网页端启动报 `Unable to resolve module ./apps/mobile/node_modules/expo-router/entry` | Windows + pnpm workspace 链接 | 已修复 |
| `EW-002` | 可信回答正文出现 `[9]`，但引用清单只到 `[8]`                                         | 知识问答引用展示              | 已修复 |
| `EW-003` | 问答页与历史面板报 `Text strings must be rendered within a <Text> component`         | 知识问答正文与引用渲染        | 已修复 |

## EW-001：Metro 在 Windows 上无法解析 Expo 网页端入口

**现象**：在 `apps/mobile` 执行 `pnpm web` 后 Metro 能启动，但每次页面请求都会在终端和浏览器错误浮层里报：

```text
Metro error: Unable to resolve module ./apps/mobile/node_modules/expo-router/entry from E:\realProject\EchoWave/.:
None of these files exist:
  * node_modules\expo-router\entry(.web.ts|.ts|...|.css)
  * node_modules\expo-router\entry
```

**受影响命令**：`apps/mobile` 下的 `pnpm web` 与 `pnpm exec expo start --web`。Dev Client 启动（`pnpm start`）与生产导出不受影响。

**根因**：问题在依赖链接层，不在应用代码。

1. Expo 解析项目入口得到 `apps/mobile/node_modules/expo-router/entry.js`，它是一个 pnpm junction。
2. 因为 `apps/mobile` 属于 workspace，`getMetroServerRoot` 返回仓库根目录，入口必须以仓库根为基准表示。
3. Expo 的 `convertEntryPointToRelative` 会用 `fs.realpathSync` 把该 junction 折叠成 `node_modules/.pnpm/expo-router@<版本>/node_modules/expo-router/entry.js`。
4. 出问题的检出中这一步没有折叠，于是模块说明符变成 `apps/mobile/node_modules/expo-router/entry`。Metro 收到一个它无法在模块映射中落地的路径，即使文件真实存在也会报告该 junction 路径不存在。

**修复**：重建依赖树，并带缓存清理启动网页端。

```powershell
cd E:\realProject\EchoWave
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\node_modules -ErrorAction SilentlyContinue
pnpm install

cd apps\mobile
pnpm exec expo start --web --clear
```

**验证**：重建依赖后 `expo config` 与静态网页导出恢复正常，入口解析落入 `.pnpm` 目录，页面返回 `200` 且不再出现 `Unable to resolve`。

**边界说明**：本文不判断具体是哪种链接状态导致 junction 未被折叠，只确认重建 `node_modules` 后解析恢复。该缺陷与 `apps/mobile/src` 的源码改动无关：源码未变时，残留的 `node_modules` 同样能复现同一失败。

## EW-002：合法引用被裁剪，导致答案正文的 `[9]` 没有对应来源

**现象**：可信回答正文以类似 `…与标准作业流程[9]。` 的标记结尾，但回答下方的引用清单只到 `[8]`。反复折叠展开也找不到对应条目。经核对，`[9]` 指向的是真实来源（例如"历史收集"分组下的案例文档），属于服务端丢失了合法引用。

**受影响路径**：知识问答页面及其只读历史，包含已经写入 `rag_runs` 的历史回答。

**根因**：引用纠正步骤把"最多 8 条引用"当成硬限制，压缩了本已通过校验的合法引用。

1. 模型在正文里写下 `[1]..[9]`，并在 `citedChunkIds` 里回传了九个真实 chunk ID。
2. `citation-validation` 本来会保留全部九个 ID。
3. 但纠正触发条件包含"引用数超过 8 条"，于是服务端把引用压缩到 8 条，最终响应只按数组下标编号 `1..8`。
4. 正文没有被同步改写，`[9]` 就成了没有对应来源的悬空标记；引用列表本身也没有截断，是数据在服务端就已经少了第 9 条。

本地执行报告可直接复现该链路：`retrievedCount: 14`、`citedCount: 8`、引用标题中含第 9、10 条真实来源，而答案正文标记只到 `[8]`。

**修复**：

- 服务端停止把 8 条当作裁剪阈值：只要 ID 属于本轮检索白名单就全部保留；`MAX_CITATIONS` 只作为防御异常输出的安全上限（24）。`citationCorrectionContext` 改为只允许替换越权 ID，禁止缩短答案或改动标记与引用的对应关系。
- `apps/api/src/knowledge/answer/citationMarkers.ts` 在组装响应前把标记与已校验引用对齐：标记按首次出现顺序重编为连续 `1..N`，仅在标记数超过已保留引用数时移除无法追溯的标记；正文未提及的合法引用仍保留在完整清单中。`knowledgeAnswer.ts` 保存对齐后的正文，并在 `citation-validation` 步骤记录 `droppedMarkerCount`。
- 移动端展示：`apps/mobile/src/features/knowledge/components/citationDisplay.ts` 把可见编号收敛进返回的清单范围，使服务端修复前已入库的回答也能展示一致编号；清单条目本身不做裁剪。

**验证**：`apps/api/test/knowledge/answer/citationMarkers.test.mjs` 覆盖越界标记、首次出现排序、未被引用来源、无标记回答与幂等性；`deepSeekQueryAgent.test.mjs` 断言 9 条合法引用全部保留且正文 `[9]` 保持有效、不再触发纠正调用、越权 ID 纠正后标记与编号仍一一对应；`CitationList.test.tsx` 断言展开后渲染完整清单。

**边界说明**：修复前已持久化的回答保留原始正文，仅展示编号被规范化；共享契约 `RagCitationSchema.number` 未变更。合法引用不再被裁剪后清单会更长，可读性由移动端默认折叠前 4 条负责。

## EW-003：问答正文与引用区域出现裸文本节点

**现象**：打开可信问答页面（或历史面板）后控制台反复报 `Text strings must be rendered within a <Text> component`。React Native 的 Fabric 渲染器在创建独立文本实例时校验父级上下文，父级不是 `Text` 就会打印该错误。

**受影响路径**：知识问答页、只读历史面板。

**根因**：历史面板的引用卡片容器里插入了一个独立的空白文本节点，用来微调间距：

```tsx
<CitationList ... />{' '}
```

`{' '}` 是 `View` 的直接字符串子节点，渲染器因此判定"文本不在 Text 内"。它不是正文标记渲染造成的：`AnswerText` 内部的字符串都在 `Text` 内。

**修复**：删除该空白文本节点，间距改由样式控制；正文标记统一渲染为单个模板字符串 `[n]`，避免把 `[`、数字、`]` 拆成多个文本子节点。

**验证**：新增 `apps/mobile/src/features/knowledge/testing/renderTextGuard.ts` 与两处用例：`AnswerText.test.tsx` 断言正文子树无裸文本，`KnowledgeQueryScreen.test.tsx` 通过 `testID="query-history-item"` 断言历史面板条目子树无裸文本。两处用例都经过"重新插入 `{' '}` 会失败、删除后通过"的往返验证。

**边界说明**：该错误只在原生渲染器出现，Web 端不会打印同样文案；判定函数放在组件测试中而不是源码里，属于测试侧约束。

## 新增缺陷的登记方式

记录精确命令、所在目录、原始报错，以及实际表现与预期表现的差异。只有验证命令真实通过后才能标记为已修复，否则保持未修复并写明阻塞原因。修改本文时必须同步更新两种语言版本。
