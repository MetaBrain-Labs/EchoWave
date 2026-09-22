# EchoWave 缺陷修复记录

[English](./bug-fixes.md) | **简体中文**

本文记录已经确认并修复的缺陷：复现方式、根因、修复方案与验证证据。它补充专题文档和 [Android E2E 问题汇总](./mobile-e2e-troubleshooting.zh-CN.md)：专题文档描述预期行为，本文只记录实际发生过的失败及其收敛方式。

## 已修复缺陷

| ID       | 现象                                                                                 | 影响范围                       | 状态   |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------ | ------ |
| `EW-001` | 网页端启动报 `Unable to resolve module ./apps/mobile/node_modules/expo-router/entry` | Windows + pnpm workspace 链接  | 已修复 |
| `EW-002` | 可信回答正文出现 `[9]`，但引用清单只到 `[8]`                                         | 知识问答引用展示               | 已修复 |
| `EW-003` | 问答页与历史面板报 `Text strings must be rendered within a <Text> component`         | 知识问答正文与引用渲染         | 已修复 |
| `EW-005` | 新业务空间的 `ws-` 专属域名前缀被判为非法参数，迁移只报“请求参数无效。”              | 百炼业务空间迁移与百炼连接配置 | 已修复 |
| `EW-006` | AI 配置的能力清单漏掉“知识重排”，重排无法绑定，只能降级为向量顺序                    | AI 配置能力绑定与知识重排      | 已修复 |
| `EW-007` | 保存能力绑定撞唯一约束报 500，没有当前 revision 的历史绑定行无法修复                 | 能力绑定保存与知识重排         | 已修复 |

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

## EW-004：多个页面的输入框光标高于文字、且输入内容上下偏移

**现象**：知识问答输入框在 Android 上光标明显高于文字并略微超出输入框；项目内多个页面的单行输入框有同样表现。

**受影响路径**：共 21 个含 `TextInput` 的页面与组件，包括知识问答输入框、分组侧栏、分组设置、知识库与文档编辑、数据源弹层、通用设置与 AI 配置中心。

**根因**：只有部分输入框落实了设计系统第 9 节，其余依赖平台默认行为，并同时声明了通用 `padding`（或 `paddingVertical: spacing.sm`）与 `minHeight`。Android 按字体完整行盒决定光标高度，文字却落在带内边距的盒子里，于是光标超过可见文字高度；部分输入框的纵向对齐还是从基础样式继承而来，并未显式声明。

**修复**：

- `apps/mobile/src/shared/theme/textInput.ts` 新增两个共享文字令牌：`textInputText`（单行：`includeFontPadding: false`、`paddingVertical: 0`、`textAlignVertical: 'center'`）与 `multilineTextInputText`（多行：`includeFontPadding: false`、`textAlignVertical: 'top'`）。
- 所有 `TextInput` 样式改为展开其中一个令牌；单行输入框显式声明 `height` 而不再依赖 `minHeight`，多行变体显式覆盖纵向对齐。
- 容器与状态样式（`roleInput`、`invalidInput`、`addTagInput`，以及首轮批量修改误伤的无关样式块）保持原有尺寸：`roleAddButton`、`segmentationOption` 等 `Pressable` 样式仍使用 `minHeight`，其中 `segmentationOption` 由既有数据源测试断言。

**验证**：新增 `apps/mobile/src/shared/theme/__tests__/textInputStyles.test.ts`，扫描 `src` 下全部 `.tsx`，解析每个 `TextInput` 的样式键，缺少共享令牌、也没有显式 `includeFontPadding: false` 与 `textAlignVertical` 时失败；同时锁定令牌本身的关键声明。分组侧栏与 AI 配置中心既有的输入框尺寸断言保持不变并通过。

**边界说明**：光标只在真机渲染，因此本修复以静态扫描加既有交互测试验证，视觉确认仍需 Android 构建。多行文本域刻意保留自己的内边距与顶部对齐。

## EW-005：新业务空间的 `ws-` 专属域名前缀被判为非法参数

**现象**：在“更多 → 迁移到业务空间专属域名”里填入控制台 API Host 的第一个点之前的部分（例如 `ws-rcn333095ds1qzij`）并选择地域后，点“验证并迁移”只在面板里显示一行红字“请求参数无效。”，没有任何字段级原因；而同一个值在百炼控制台里正是可用的专属域名前缀。

**受影响路径**：`更多 → 迁移到业务空间专属域名`、`AI 配置 → 新建/编辑通义千问（百炼）连接`，以及启动期 `DASHSCOPE_WORKSPACE_ID` 的旧环境导入。三者共用 `DashScopeWorkspaceIdSchema`。

**根因**：契约把“API Host 的第一个 DNS 标签”误当成固定前缀白名单。

1. `packages/contracts/src/settings.ts` 的 `DashScopeWorkspaceIdSchema` 只接受 `^llm-…$`。阿里云 `CreateWorkspace` 与 `ListWorkspaces` 返回的 `apiHost` 早期是 `llm-…`，较新的业务空间是 `ws-…`，于是合法取值在 Zod 校验阶段就被拒绝。
2. `apps/api/src/http/errorHandler.ts` 把所有 `ZodError` 折叠成 400 加固定文案“请求参数无效。”，丢弃字段与原因；客户端在中文环境原样展示该文案，现场因此看不到任何可诊断信息。
3. 迁移卡片此前不做本地校验，用户只能拿到这一次往返之后的通用报错。

**修复**：

- `DashScopeWorkspaceIdSchema` 改为按单段 DNS 标签校验：只允许小写字母、数字与中间的连字符，长度不超过 63。`llm-…` 与 `ws-…` 都合法；完整域名、大写和首尾连字符仍被拒绝。
- 迁移卡片与 AI 配置的该字段补上 API Host 取值说明，占位符由 `llm-xxxxxxxxxxxx` 改为 `ws-xxxxxxxxxxxx`；卡片在提交前用共享契约本地校验，格式不对时直接提示“业务空间域名前缀无效…”，且不发起请求。
- `docs/configuration*.md` 与 `apps/api/.env.example` 说明该值取自控制台 API Host 的第一个点之前的部分，且地域必须与 Host 中的地域一致。

**验证**：`packages/contracts` 下 `node --test --test-isolation=none "test/settings/settings.test.mjs"` 新增用例 `accepts every Model Studio workspace domain prefix and rejects non-label values`，断言 `ws-…` 能派生专属域名、`llm-…` 仍可用，完整域名、大写与首尾连字符被拒绝；`apps/mobile` 的 `TopLevelTabScreens.test.tsx` 迁移用例改用 `ws-echowave` 走通整条链路，并新增 `rejects a full API Host locally instead of posting an invalid parameter` 断言本地拦截且不发请求。根 `pnpm check` 通过。

**边界说明**：本文只收敛取值校验与错误可诊断性。地域仍需人工选择并与 API Host 中的地域一致；卡片里的专属域名预览是唯一对照手段，本修复不自动从 Host 推导地域。

## EW-006：AI 配置的能力清单漏掉“知识重排”，重排无法绑定

**现象**：`更多 → AI 配置` 的能力列表里没有「知识重排」这一项，既看不到它的绑定状态，也没有任何入口绑定它。重排开关打开后，`更多` 页只显示「重排已开启，但百炼业务空间或重排模型尚未配置。」，问答日志出现 `Knowledge rerank degraded to vector order { reason: 'NOT_CONFIGURED', candidateCount: 20 }`。

**受影响路径**：`apps/mobile` AI 配置页的能力绑定区、`应用默认配置（N 项）` 一键补齐，以及所有按该清单判定“缺失能力”的流程。

**根因**：`SettingsScreen.tsx` 的能力清单是硬编码数组，从一开始就没有 `knowledge_rerank`（`HEAD` 与工作区版本一致），而 `capabilityLabel` 早已为它准备了文案。服务端完全支持该能力：`AiCapabilitySchema`、`AI_CAPABILITY_DEFAULTS.knowledge_rerank`（固定 `qwen3.7-text-rerank`）、`CAPABILITY_MODEL_REQUIREMENTS` 与 `POST /api/settings/capabilities/knowledge_rerank` 都已就绪。清单缺项有两个后果：绑定编辑器无法触达；`missingCapabilities` 永不含重排，`应用默认配置` 也不会补它。于是重排绑定只能由迁移接口的 `ensureKnowledgeRerankBinding` 或一次性 SQL 迁移 `045` 创建，而这两者都要求执行时已存在指向 dashscope 连接的 `knowledge_embedding` 绑定。

**修复**：把 `{ id: 'knowledge_rerank' }` 加回能力清单，位置与 `AiCapabilitySchema` 顺序一致（紧跟知识嵌入）。

**验证**：`apps/mobile` 的 `SettingsScreen.test.tsx` 同步更新 `应用默认配置` 的项数断言（7→8、6→7、“已应用 5 项”→6），并新增断言：一键补齐必须调用 `saveCapability('knowledge_rerank', { model: 'qwen3.7-text-rerank' })`。根 `pnpm check` 通过。

**边界说明**：重排模型固定，行内模型仍是静态值；本修复只让这一项可被看见与绑定，不改变重排协议，也不替代迁移接口对既有租户的自动补齐。

## EW-007：保存能力绑定撞唯一约束，没有当前 revision 的历史绑定行无法修复

**现象**：保存能力绑定（App 的「保存能力绑定」/「应用默认配置」，或 `PUT /api/settings/capabilities/:capability`）返回 500，服务端日志为：

```text
Unhandled API error error: duplicate key value violates unique constraint "ai_capability_bindings_tenant_id_capability_key"
Key (tenant_id, capability)=(00000000-0000-4000-8000-000000000001, knowledge_rerank) already exists.
  at async SettingsRepository.saveBinding (apps/api/src/settings/repository.ts)
  at async apps/api/src/http/routes/settings.ts:112
```

同一条能力（这里是重排）持续显示「重排已开启，但百炼业务空间或重排模型尚未配置。」，日志出现 `Knowledge rerank degraded to vector order { reason: 'NOT_CONFIGURED', candidateCount: 20 }`。现场数据为 `current_revision_id` 为空、`revision_count = 1`：即绑定行没有已发布的 revision，却已经带着一条未发布的 revision。

**受影响路径**：`PUT /api/settings/capabilities/:capability`、AI 配置页的能力绑定保存与一键补齐，以及任何需要重新发布已有能力绑定的流程。

**根因**：`SettingsRepository.saveBinding` 用内连接判断能力是否已绑定（`JOIN ... ON revision.id = binding.current_revision_id`）。当绑定行的 `current_revision_id` 为 NULL 时（历史中断留下的空壳行），该查询返回空集，代码于是走"新建绑定"分支插入同名能力，撞上 `UNIQUE (tenant_id, capability)`，事务回滚并抛 500。即使改成复用该行，版本号如果按"没有已发布 revision 就从 1 开始"计算，还会再撞 `(tenant_id, binding_id, revision_no)` —— 空壳行上的残留 revision 并不会因为指针为空而消失。两处都会让这类行永远无法通过 App 或 API 修复。同一条数据在 `resolveCapability` 与 `listBindings` 里也被内连接过滤，所以该能力表现为"尚未配置"。

**修复**：`saveBinding` 的存在性判断改为 `LEFT JOIN`，把"绑定行存在但没有已发布 revision"当作可修复状态：复用该行 id，并且版本号改为按该绑定实际存在的 revision 取 `max(revision_no) + 1`，只有确实没有行时才插入绑定行。乐观锁语义保持不变：先比较已发布 revision，没有已发布 revision 时拒绝携带 `expectedRevision` 的写入。

**验证**：`apps/api` 的 `test/settings/repository.test.mjs` 新增三个用例 —— 带残留 revision 的未发布历史行会被修复（断言复用该行、不重复插入绑定行、版本号取 2 而不是 1，并断言查询确实使用 `LEFT JOIN`）、已发布绑定发布下一 revision 且过期 `expectedRevision` 抛 `CONFLICT` 并回滚、从未绑定的能力仍会插入绑定行。根 `pnpm check` 通过。

**边界说明**：`resolveCapability` 与 `listBindings` 仍按"没有已发布 revision 即不可用"处理，这是正确语义（没有 revision 就没有供应商与模型），所以这类能力在修复前显示为"尚未配置"。迁移接口的 `ensureKnowledgeRerankBinding` 只在完全没有绑定行时补建，不修复已存在的空壳行；本修复让 App 与 API 的保存路径承担修复职责。

## 新增缺陷的登记方式

记录精确命令、所在目录、原始报错，以及实际表现与预期表现的差异。只有验证命令真实通过后才能标记为已修复，否则保持未修复并写明阻塞原因。修改本文时必须同步更新两种语言版本。
