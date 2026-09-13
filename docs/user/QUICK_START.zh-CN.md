# MEPbridge ACAIstr v0.1.5 快速开始

## 1. 安装

请下载中文 `win64-zh-CN.zip` 或英文 `win64-en-US.zip` 完整安装包。独立 APX 仅用于已有完整安装的更新，GitHub 自动生成的源码归档不是安装包。

1. 从 Releases 下载并解压最新版本的完整发布 ZIP（Windows 会创建同名文件夹，属预期行为）。
2. 关闭 Archicad，进入解压出的文件夹，双击其中的 `Install-MEPBridge.cmd`（该文件夹是 Workbench 运行目录，装完勿删）。
3. 重新启动 Archicad。
4. 点击“MEPbridge ACAIstr → 打开 MEPbridge ACAIstr”。

手动安装和 MCP 配置参见[安装说明](INSTALL.zh-CN.md)。

## 2. 确认连接

1. 打开测试或已备份的 PLN。
2. 确认 Workbench 显示 Archicad 和 MEPBridge 在线。
3. 执行 Ping 或读取项目信息。
4. 确认「版本信息」显示的版本号，以及 Ping 显示的命令数 / descriptor 数，均与该版本发布说明一致。

## 3. Manual 手动模式

适合命令和参数已经明确的操作。

1. 选择功能模块。
2. 选择命令。
3. 核对参数、单位、楼层和目标构件。
4. 对写入操作进行确认。
5. 执行并查看结构化返回、实际读回和 Archicad 模型。

## 4. CollabAI 模式

适合自然语言、模板和多步骤计划。

1. 输入希望完成的结果。
2. 查看生成的计划。
3. 按当前风险策略确认步骤。
4. 执行并检查每一步结果。

没有连接 LLM 时，Manual 模式、已导入模板和已配置的本地自定义命令仍可使用。

## 5. 视口结果

- AABB 结果按 Archicad 实际返回的位置、尺寸和相对比例显示。
- 计划示意只表示执行路径，不代表真实模型几何。
- 核对实际外观时，以 Archicad 读回或原生截图为准。

## 6. 独立对话窗口

右侧对话区可打开为独立、可缩放窗口。历史消息、输入、执行状态、模板以及 CollabAI/Manual 模式状态会继续保留。

## 7. 安全要求

- 首次使用先执行只读命令。
- 创建操作使用安全测试坐标。
- 编辑或删除前确认 GUID 和选择集。
- dry-run 仅代表参数和结构预检，不代表模型已发生修改。
- 保持项目备份。

## 8. 联系与反馈

联系邮箱：`aizuxa@agent.qq.com`

GitHub：`https://github.com/bleufeng`

反馈前应删除 API Key、项目数据、PLN 文件和个人信息。
