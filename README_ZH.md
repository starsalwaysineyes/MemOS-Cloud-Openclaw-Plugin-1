# MemOS Cloud OpenClaw Plugin（Lifecycle 插件）

官方维护：MemTensor。

这是一个最小可用的 OpenClaw lifecycle 插件，功能是：
- **召回记忆**：在每轮对话前从 MemOS Cloud 检索记忆并注入上下文
- **添加记忆**：在每轮对话结束后把消息写回 MemOS Cloud

## 功能
- **Recall**：`before_agent_start` → `/search/memory`
- **Add**：`agent_end` → `/add/message`
- 使用 **Token** 认证（`Authorization: Token <MEMOS_API_KEY>`）

## 安装

### 方式 A — GitHub
```bash
openclaw plugins install github:MemTensor/MemOS-Cloud-OpenClaw-Plugin
openclaw gateway restart
```
确认 `~/.openclaw/openclaw.json` 中已启用：
```json
{
  "plugins": {
    "entries": {
      "memos-cloud-openclaw-plugin": { "enabled": true }
    }
  }
}
```

### 方式 B — 本地路径
把本目录放到 OpenClaw 插件路径（如 `~/.openclaw/extensions/`），或用 `plugins.load.paths` 指向它。

示例 `~/.openclaw/openclaw.json`：
```json
{
  "plugins": {
    "entries": {
      "memos-cloud-openclaw-plugin": { "enabled": true }
    },
    "load": { "paths": ["/path/to/memos-cloud-openclaw-plugin"] }
  }
}
```
修改配置后需要重启 gateway。

## 环境变量
插件按顺序读取 env 文件（**openclaw → moltbot → clawdbot**），每个键优先使用最先匹配到的值。
若三个文件都不存在（或该键未找到），才会回退到进程环境变量。

**配置位置**
- 文件（优先级顺序）：
  - `~/.openclaw/.env`
  - `~/.moltbot/.env`
  - `~/.clawdbot/.env`
- 每行格式：`KEY=value`

**快速配置（Shell）**
```bash
echo 'export MEMOS_API_KEY="mpg-..."' >> ~/.zshrc
source ~/.zshrc
# 或者

echo 'export MEMOS_API_KEY="mpg-..."' >> ~/.bashrc
source ~/.bashrc
```

**快速配置（Windows PowerShell）**
```powershell
[System.Environment]::SetEnvironmentVariable("MEMOS_API_KEY", "mpg-...", "User")
```

若未读取到 `MEMOS_API_KEY`，插件会提示配置方式并附 API Key 获取地址。

**最小配置**
```env
MEMOS_API_KEY=YOUR_TOKEN
```

**可选配置**
- `MEMOS_BASE_URL`（默认 `https://memos.memtensor.cn/api/openmem/v1`）
- `MEMOS_API_KEY`（必填，Token 认证）—— 获取地址：https://memos-dashboard.openmem.net/cn/apikeys/
- `MEMOS_USER_ID`（可选，默认 `openclaw-user`）
- `MEMOS_CONVERSATION_ID`（可选覆盖）
- `MEMOS_RECALL_GLOBAL`（默认 `true`；为 true 时检索不传 conversation_id）
- `MEMOS_CONVERSATION_PREFIX` / `MEMOS_CONVERSATION_SUFFIX`（可选）
- `MEMOS_CONVERSATION_SUFFIX_MODE`（`none` | `counter`，默认 `none`）
- `MEMOS_CONVERSATION_RESET_ON_NEW`（默认 `true`，需 hooks.internal.enabled）

## 可选插件配置
在 `plugins.entries.memos-cloud-openclaw-plugin.config` 中设置：
```json
{
  "baseUrl": "https://memos.memtensor.cn/api/openmem/v1",
  "apiKey": "YOUR_API_KEY",
  "userId": "memos_user_123",
  "conversationId": "openclaw-main",
  "queryPrefix": "important user context preferences decisions ",
  "recallEnabled": true,
  "recallGlobal": true,
  "addEnabled": true,
  "captureStrategy": "last_turn",
  "includeAssistant": true,
  "conversationIdPrefix": "",
  "conversationIdSuffix": "",
  "conversationSuffixMode": "none",
  "resetOnNew": true,
  "memoryLimitNumber": 6,
  "preferenceLimitNumber": 6,
  "includePreference": true,
  "includeToolMemory": false,
  "toolMemoryLimitNumber": 6,
  "tags": ["openclaw"],
  "asyncMode": true
}
```

## 工作原理
### 1) 召回（before_agent_start）
- 组装 `/search/memory` 请求
  - `user_id`、`query`（= prompt + 可选前缀）
  - 默认**全局召回**：`recallGlobal=true` 时不传 `conversation_id`
  - 可选 `filter` / `knowledgebase_ids`
- 使用 `/search/memory` 结果按 MemOS 提示词模板（Role/System/Memory/Skill/Protocols）拼装，并通过 `prependContext` 注入

### 2) 添加（agent_end）
- 默认只写**最后一轮**（user + assistant）
- 构造 `/add/message` 请求：
  - `user_id`、`conversation_id`
  - `messages` 列表
  - 可选 `tags / info / agent_id / app_id`

## 说明
- 未显式指定 `conversation_id` 时，默认使用 OpenClaw `sessionKey`。**TODO**：后续考虑直接绑定 OpenClaw `sessionId`。
- 可配置前后缀；`conversationSuffixMode=counter` 时会在 `/new` 递增（需 `hooks.internal.enabled`）。

## 能力矩阵

| 领域 | 当前能力 | 主要配置项 |
|---|---|---|
| Recall 召回 | 每轮前检索 MemOS 记忆并通过 `prependContext` 注入提示词 | `recallEnabled`、`recallGlobal`、`queryPrefix`、`maxQueryChars`、`memoryLimitNumber`、`includePreference`、`preferenceLimitNumber`、`includeToolMemory`、`toolMemoryLimitNumber`、`filter`、`knowledgebaseIds` |
| Add 写回 | 每轮成功结束后写回对话到 MemOS | `addEnabled`、`captureStrategy`（`last_turn`/`full_session`）、`includeAssistant`、`maxMessageChars`、`tags`、`info`、`agentId`、`appId`、`allowPublic`、`allowKnowledgebaseIds`、`asyncMode` |
| 会话路由 | 可稳定生成 conversation_id，并支持分段策略 | `conversationId`、`conversationIdPrefix`、`conversationIdSuffix`、`conversationSuffixMode`、`resetOnNew` |
| 稳定性 | 内置超时/重试，写回支持节流 | `timeoutMs`、`retries`、`throttleMs` |
| 配置来源 | 插件配置 + env 文件优先级兜底 | 插件 config + `~/.openclaw/.env` → `~/.moltbot/.env` → `~/.clawdbot/.env` |

## 版本更新指南

### 1）版本号策略

本插件采用语义化版本（SemVer）：

- **PATCH**（`x.y.Z`）：修复 bug / 内部优化，不应引入破坏性配置变化
- **MINOR**（`x.Y.z`）：向后兼容的新能力或新增可选配置
- **MAJOR**（`X.y.z`）：存在破坏性行为或配置/Schema 变化

### 2）维护者发版清单

发布新版本时建议按以下顺序：

1. 更新代码；若新增能力，同步更新 `openclaw.plugin.json` 的 `configSchema`。
2. 保持两个版本号一致：
   - `package.json` 的 `version`
   - `openclaw.plugin.json` 的 `version`
3. README 与 `CHANGELOG.md` 同步补齐本次版本的变更说明。
4. 使用仓库内脚本做版本 bump：
   - `node scripts/bump-version.mjs patch --dry-run`
   - `node scripts/bump-version.mjs patch`
   - 或 `npm run bump:minor` / `npm run bump:major`
5. 提交并打 tag（建议 `vX.Y.Z`）。
6. 发布变更说明，至少包含：
   - 能力变更点
   - 兼容性影响
   - 迁移步骤（若有）

### 3）使用者升级步骤

如果插件是通过 npm 规格安装，可直接更新已安装插件：

```bash
openclaw plugins update
openclaw gateway restart
```

如果插件是通过 GitHub 源安装，建议重新安装最新版：

```bash
openclaw plugins install github:MemTensor/MemOS-Cloud-OpenClaw-Plugin
openclaw gateway restart
```

重启后建议在日志确认：

- 插件是否成功加载
- 是否出现 `Missing MEMOS_API_KEY`（若不预期应消除）
- recall/add hook 是否按预期执行

### 4）跨大版本升级前检查

- 现有插件配置项是否仍然有效
- `MEMOS_*` 的环境变量策略是否与当前部署一致
- 若使用 `conversationSuffixMode=counter` + `resetOnNew`，确认 `hooks.internal.enabled=true`

## 致谢
- 感谢 @anatolykoptev（Contributor）— 领英：https://www.linkedin.com/in/koptev?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=ios_app
