# 更新记录

面向用户的公开变更。版本号遵循语义化版本规范。

## [未发布]

### 新增

- 本周期无。

### 变更

- 本周期无。

### 修复

- 本周期无。

### 已知边界

- 本周期无。

## [0.1.1] - 2026-07-28

### 新增

- 13 个新 C++ 命令：GetFavorites、GetFavorite、CreateFromFavorite、ApplyFavorite、SaveFavorite、GetProfiles、GetViewMap、GetSectionMarkers、GetClassifications、GetLayers、FindElementsByProperty、AssignClassification、SetLayerBatch。
- CreateWall、CreateColumn、CreateBeam 新增可选 `profileGuid` 参数，支持截面轮廓选择。
- Workbench Server 接入语义索引主链，用于自然语言命令匹配。
- README 新增示例预览章节，含演示视频和执行结果截图。
- 新增中文更新记录（`CHANGELOG.zh-CN.md`）和安装说明中的双语版本更新指引。

### 变更

- C++ 命令数从 61 增至 74；descriptor/MCP 工具数从 59 增至 72。
- CopyElements 空 sourceGuids 处理三层修复：resolver 在 `dryRun=true` 且 `sourceGuids` 为空时跳过选择集兜底；C++ schema 移除 `minItems:1`；C++ `Execute()` 对空 GUID 返回 dry-run 预览（C++ 部分需重编 APX）。
- 入门 shell 模板从 CopyElements（依赖 GUID）改为 CreateWall×8 + CreateSlab×2（10 步，自包含坐标，跨项目可用，不依赖 GUID）。
- MCP 状态显示支持多配置路径数组检测 CodeBuddy、WorkBuddy、Codex、Claude Code 四个平台；支持每个候选的自定义标记。
- Claude Code MCP 插件安装路径修正为 `~/.claude.json` 顶层 `mcpServers`（非 `~/.claude/mcp.json`）。
- 刷新 README 文案（移除 openBIM 框架、收紧安全与免责声明措辞、更新作者署名、补充第三方插件声明）并用示例预览替换工作流程图。
- 示例楼板和示例桥架模板坐标重置为源构件原生位置（无 X+20m 偏移），匹配当前 AC28 0 层读取/重建回归数据。
- 用户模板任务名在列表、分组、选择器、管理卡片和重放对话框中改为纯文本渲染；移除每个模板不一致的图标和热点标记。
- 安装包语言决定 Workbench 初始语言、入门资产和内置区域知识库；保留手动切换语言能力。
- 公开 `VERSION` 版本事实源，为每次公开 PR 与 `main` 更新引入自动化版本闸门。
- 强制 PR 清单，覆盖更新记录、版本影响、双语文档与 Release 资产影响。
- 每次公开仓库更新必须在 `[未发布]` 下追加简洁条目。
- 产品版本变更必须递增语义化版本号，并同步更新记录、中英文公开指南和 Server/UI 包元数据。

### 修复

- CopyElements 空 sourceGuids 三层拦截：resolver 在 `dryRun=true` 且 `sourceGuids` 为空时不再读 Archicad 选择集；C++ schema `minItems:1` 移除；C++ `Execute()` 对空 GUID 返回 dry-run 预览成功。
- MCP 状态显示只显示 CodeBuddy，WorkBuddy 和 Codex 已打开却不显示。修复方式：新增 WorkBuddy、支持每个平台多配置路径、移除误报匹配器。
- 修正源码、descriptor、MCP 和文档之间的命令数偏差。
- 移除公开发布范围内的过时重复 UI 产物和 source map。
- 修正 AC28/AC29 包路径。
- 切换到仅对话窗口时保留会话历史和执行状态。

### 已知边界

- `SwitchStory` 和 `ChangeStairGeometry` 是注册 C++ 命令，但在 v0.1.1 未作为 descriptor/MCP 工具发布。
- `CopyElementsCommand.cpp` schema 和 `Execute()` 改动需重编 APX 才能使 dryRun 占位跨项目可用；当前已用 Create 型模板规避。
- `GetViewMap` 在当前测试项目返回 0 视图（项目无 View Map 项，非 bug）。
- `CreateColumn`/`CreateBeam` 的 `profileGuid` 解析但不应用（memo 多段结构，后续增强）。
- 公开源码仓库不包含 Graphisoft DevKit，不承诺可复现的官方 APX 构建。
- 用户对项目备份、输入审查和合规性自行负责。

## [0.1.0] - 2026-07-20

### 新增

- Archicad 28 与 Archicad 29 Windows Add-On。
- 61 个注册 C++ 命令、59 个 descriptor/MCP 工具。
- 通用建筑构件与 MEP 构件的创建、查询、编辑、属性、选择和项目环境操作。
- 本地 Node.js Workbench Server 与 React UI。
- Manual 与 CollabAI 模式，含确认策略与结果回读。
- 兼容主流 MCP 宿主的 MCP stdio Server。
- 本地模板、自定义命令、知识库、学习记忆、主动建议和审计日志。
- Windows 安装与卸载入口。
- 发布清单与每文件 SHA256 校验和。

### 变更

- 公开版本号统一为 `0.1.0`。
- AC28 与 AC29 使用独立资源文件和菜单注册。
- Server 默认监听 `127.0.0.1`；暴露到网络需显式 `HOST` 覆盖。
- 运行时用户数据默认保存在 `%APPDATA%\MEPBridge`。
- MCP 工具数量由 descriptor 动态生成。
- 公开仓库布局区分用户文档、打包源文件和内部技术资源。

### 修复

- 本周期无。

### 已知边界

- `SwitchStory` 和 `ChangeStairGeometry` 是注册 C++ 命令，但在 v0.1.0 未作为 descriptor/MCP 工具发布。
- 部分 AC28/AC29 实现细节可能在后续更新中继续收敛。
- 公开源码仓库不包含 Graphisoft DevKit，不承诺可复现的官方 APX 构建。
- 用户对项目备份、输入审查和合规性自行负责。

---

版权所有 (c) 2026 Zuxai Z. 基于 MIT License 授权。
