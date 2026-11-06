# MEPbridge ACAIstr v0.1.9 安装说明

> 本文适用于 v0.1.9。请从 GitHub Release 下载获批 ZIP。完整包内含 `RELEASE_MANIFEST.json` 与 `SHA256SUMS.txt`，用于载荷校验。

本说明适用于 Windows x64 上的 Archicad 28、29 和 30。

首次安装或涉及 Workbench 组件的升级，请下载唯一的双语完整包 `MACAI-Workbench-v0.1.9-win64.zip`。不要把 APX 更新 ZIP、GitHub 自动生成的 `Source code.zip` 或 `Source code.tar.gz` 当作完整安装包。

## 环境要求

- Windows x64
- Archicad 28、29 或 30
- 普通可写的解压目录
- 安装 Add-On 时可授予 Windows 管理员权限

**无需另外安装 Node.js 或 npm。** 完整包自带经过版本、来源和 SHA256 校验的 Windows x64 Node 便携运行时，以及 Server 所需的生产依赖。Workbench Server、UI 和 MCP Server 统一使用包内运行时，不回退到系统 `PATH` 中的 Node.js。

Server 默认只监听 `127.0.0.1:19780`。Archicad JSON API 在本机 `127.0.0.1:19723-19743` 范围动态检测。

### 便携运行时要求

请保留完整解压目录及其中的 `runtime` 文件夹。若安装器或启动器报告便携运行时缺失、损坏或无法启动，请重新下载并完整解压完整包；**不要通过另装系统 Node.js 绕过该错误**。“免环境”仅表示无需另装 Node.js/npm；仍需受支持的 Windows x64、匹配版本的 Archicad 和正常系统权限。

## 发布资产选择

完整包同时包含：

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
Archicad-30\MEPBridge.apx
runtime\node\node.exe
runtime\runtime-manifest.json
```

安装程序会按所选 Archicad 主版本部署匹配的 APX。

以下 APX 单件更新包仅适用于已有完整安装、且 Release 明确允许只更新 APX 的用户：

```text
MEPbridge-apx-AC28-v0.1.9-win64.zip
MEPbridge-apx-AC29-v0.1.9-win64.zip
MEPbridge-apx-AC30-v0.1.9-win64.zip
```

每个更新 ZIP 根目录只包含一个 `MEPBridge.apx`，不包含 Server、UI、MCP Server、便携运行时、生产依赖或安装脚本。首次安装必须使用完整包。

## 如何判断该只换 APX 还是重装完整包

每个版本都会在发布说明里标注升级类型，请先看那里。下面解释这两种类型的含义，以及为什么必须区分。

**只换 APX** —— 替换 `MEPBridge.apx` 后重启 Archicad，其余文件不动。仅当该版本的改动**完全局限在原生 Add-On 内**时适用：没有新增命令、注册命令数与 descriptor/MCP 工具数都没变，且未改动 Server、MCP Server、UI、任务模板和安装脚本。

**重装完整包** —— 用完整 ZIP 重新安装。当版本改动涉及 Add-On 之外的任何部分时都必须如此，包括 Server 或 MCP Server、descriptor/MCP 工具注册表、UI、任务模板、starter 资产、安装脚本。**注册命令数或 descriptor 数发生变化时也必须重装完整包** —— 这两个数字都被编译进 APX 并由 Ping 回显，只更新一侧会导致 Ping 报的数字与实际安装的文件不一致。

两种类型都适用的两条规则：

- **不要把某个版本的 APX 与另一个版本的安装包混用。** Add-On 与 Server 在每个版本内共享同一套命令边界，跨版本混用不受支持 —— 即使文件能正常加载也一样。
- **首次安装绝不能只用 APX 文件。** 它不含 Server、依赖和安装脚本。

### 只换 APX 的操作步骤

1. 保存工作并**完全退出 Archicad**。Archicad 运行时会锁定 APX 文件，复制会失败或不生效。
2. 备份 Add-On 目录中现有的 `MEPBridge.apx`。
3. 解压匹配宿主版本的 APX 更新 ZIP，把其中的 `MEPBridge.apx` 覆盖到 Add-On 目录。
4. 确认该目录内只有一个有效的 `.apx` 文件。
5. 启动 Archicad 并执行 Ping：回报的版本必须等于新版本号，命令数与 descriptor 数必须与发布说明一致。若版本仍显示旧值，说明 Archicad 加载了旧副本或复制时文件被锁定 —— 从第 1 步重做。

> 本版本的升级类型以 GitHub Release 发布说明的标注为准；只要涉及 Add-On 之外的部分（Server / MCP Server / descriptor 注册表 / 命令数变化），就必须重装完整包。

## 自动安装

1. 将完整 ZIP 解压到普通目录（Windows 会创建与 ZIP 同名的文件夹，属预期行为）。
2. 保存工作并关闭 Archicad。
3. 进入解压出的文件夹，双击其中的 `Install-MEPBridge.cmd`（安装按该文件所在目录定位，文件夹名不影响安装）。
4. 允许 Windows 管理员权限。
5. 出现选择提示时，选择需要安装的 Archicad。
6. 重新启动 Archicad。

> 注意：解压出的文件夹是 Workbench Server/UI 的永久运行目录，装完不要删除或移动；升级时请解压到全新目录，不要混入旧版本文件。

安装程序会将对应 APX 复制到：

```text
<Archicad 安装目录>\Add-Ons\MEPBridge\MEPBridge.apx
```

同时写入插件菜单一键启动 Workbench 所需的本机配置。已有 APX 哈希不同时会先建立备份。

如果之前已安装过 MEPBridge Add-On，安装程序会自动检测并复用原位置，不会产生两份位于不同 Add-On 目录的副本。

### 自定义安装路径

多数用户直接双击 `Install-MEPBridge.cmd` 即可。如果 Archicad 装在非系统盘（例如 `E:\`），或你想自己指定 Add-On 目录，可直接运行 PowerShell 安装脚本：

```powershell
powershell -File tools\Install-MEPBridgePackage.ps1 -ArchicadRoot "E:\GRAPHISOFT\Archicad 28" -AddOnRelativeDir "Add-Ons\MEPBridge"
```

- `-ArchicadRoot` 指向包含 `Archicad.exe` 的目录。
- `-AddOnRelativeDir` 是 Archicad 根目录下的 Add-On 子目录（默认 `Add-Ons\MEPBridge`）。

当自动检测找不到 Archicad 时，安装程序会提示你手动输入安装目录；也可直接传入 `-ArchicadRoot` 跳过提示。

## 手动安装

自动安装失败、或你希望完全掌控每一步时使用。全过程需要管理员权限，因为目标目录位于 `Program Files` 下。

### 第 1 步：确认自己的 Archicad 主版本

在 Archicad 中打开「帮助 → 关于 Archicad」，标题里会写 Archicad 28、29 或 30。也可以看安装目录名（下一步会用到）。**必须安装与主版本一致的 APX**，装错版本 Archicad 会拒绝加载 Add-On。

### 第 2 步：找到 Archicad 安装目录

最可靠的办法：在开始菜单里找到 Archicad 图标，右键 →「更多」→「打开文件位置」，再对快捷方式右键 →「属性」，「目标」一栏即为 `Archicad.exe` 的完整路径，去掉末尾的 `\Archicad.exe` 就是安装目录。

典型路径：

```text
C:\Program Files\GRAPHISOFT\Archicad 28
D:\Program Files\GRAPHISOFT\Archicad 29
D:\Program Files\GRAPHISOFT\Archicad 30
```

判断标准是该目录下直接存在 `Archicad.exe`。

### 第 3 步：关闭 Archicad

保存所有工作并完全退出 Archicad。Archicad 运行时会锁定 APX 文件，复制会失败。

### 第 4 步：准备目标目录

进入 `<Archicad 安装目录>\Add-Ons\`，检查是否已有 `MEPBridge` 子目录：

- 没有：新建一个名为 `MEPBridge` 的文件夹。Windows 会弹出「你需要提供管理员权限」，点击「继续」。
- 已有：直接进入，按第 6 步处理旧文件。

最终目标路径为：

```text
<Archicad 安装目录>\Add-Ons\MEPBridge\
```

### 第 5 步：复制对应版本的 APX

从解压后的发布包中，按主版本选择源文件：

```text
Archicad-28\MEPBridge.apx   → 用于 Archicad 28
Archicad-29\MEPBridge.apx   → 用于 Archicad 29
Archicad-30\MEPBridge.apx   → 用于 Archicad 30
```

复制到第 4 步的目录。若提示需要管理员权限，点击「继续」。若提示「目标已包含同名文件」，选择「替换目标中的文件」。

### 第 6 步：确认目录内只有一个有效 APX

目录中**必须只有一个**名为 `MEPBridge.apx` 的文件。Archicad 会加载该目录下所有 `.apx`，多个有效 APX 会导致命令重复注册或加载失败。

- 旧版本文件如果也叫 `MEPBridge.apx`，第 5 步已覆盖，无需额外处理。
- 若有其他 `.apx` 文件（例如手工改名的 `MEPBridge-old.apx`），请移出该目录或删除。
- 形如 `MEPBridge.apx.bak-20260729-093423` 的备份文件**不算有效 APX**（扩展名不是 `.apx`），可以保留，也可以删除以节省空间。

### 第 7 步：重新启动 Archicad

启动后 Archicad 会加载 Add-On。

### 第 8 步：验证安装成功

按顺序确认：

1. 启动过程中没有 Add-On 加载错误弹窗。
2. 菜单栏出现 **MEPbridge ACAIstr** 菜单，展开后有三个菜单项：「打开 MEPbridge ACAIstr」「使用指南」「版本信息」。
3. 点击「版本信息」，对话框中显示的版本号与你所安装的版本一致。

前三项通过即说明原生 Add-On 安装成功，Archicad JSON 命令已可用。

如需使用 Workbench，请确认完整包中的便携运行时仍在原位，并完成本机菜单配置。手动复制 APX 不会自动写入该配置，请在发布包根目录执行一次：

```powershell
powershell -File tools\Start-BaseWorkbench.ps1 -Action InstallConfig
```

之后即可用菜单项「打开 MEPbridge ACAIstr」一键启动，或参见下一节手动启动。

### 常见失败原因

| 现象 | 原因与处理 |
| --- | --- |
| 复制时提示「你需要权限来执行此操作」 | 未获得管理员权限。点击弹窗中的「继续」；若无弹窗，用管理员身份打开文件资源管理器再复制。 |
| 复制时提示文件被占用 | Archicad 仍在运行（或后台残留进程）。在任务管理器中确认 `Archicad.exe` 已结束。 |
| 菜单栏没有 MEPbridge ACAIstr | APX 放错目录，或主版本不匹配。核对第 2、4、5 步。 |
| 菜单项点击后提示找不到菜单配置 | 未执行 `Start-BaseWorkbench.ps1 -Action InstallConfig`。见第 8 步。 |
| 「版本信息」显示的版本号不是预期值 | 目录中残留了旧 APX，或复制时未真正替换。回到第 6 步检查。 |

## 启动 Workbench

推荐方式：

1. 打开 Archicad。
2. 打开 MEPbridge ACAIstr 插件菜单。
3. 点击“打开 MEPbridge ACAIstr”。

插件会在需要时启动本机 Server，并打开 Workbench。

手动备用方式：

1. 在文件资源管理器中进入解压后的发布包根目录。
2. 点击地址栏，输入 `powershell` 后按 Enter；也可以在目录空白处右键，选择“在终端中打开”。
3. 输入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\Start-BaseWorkbench.ps1 -Action Serve
```

4. 保持窗口开启，在浏览器打开 `http://127.0.0.1:19780/`。
5. 结束时按 `Ctrl+C` 停止 Server。

## MCP 配置

先启动 Workbench Server。MCP 客户端必须调用完整包内的便携运行时：

```text
<发布包根目录>\runtime\node\node.exe <发布包根目录>\tools\mepbridge-mcp-server.js
```

不要把命令填写为系统 `node`。

示例：

```json
{
  "mcpServers": {
    "mepbridge-acaistr": {
      "command": "D:\\MACAI-Workbench-v0.1.9-win64\\runtime\\node\\node.exe",
      "args": ["D:\\MACAI-Workbench-v0.1.9-win64\\tools\\mepbridge-mcp-server.js"],
      "env": {
        "MEPBRIDGE_ENDPOINT": "http://127.0.0.1:19780"
      }
    }
  }
}
```

### 把路径换成自己的解压目录

示例中的 `D:\MEPbridge-ACAIstr\` 仅是占位写法。请替换为你自己的解压目录，例如
`D:\\MACAI-Workbench-v0.1.9-win64\\tools\\mepbridge-mcp-server.js`（文件夹名以实际解压结果为准）。注意：JSON 里的
Windows 反斜杠必须写成 `\\`。

### 常见 MCP 客户端的配置位置

| 客户端 | 配置方式 |
| --- | --- |
| 豆包（桌面版） | 在豆包桌面版的「MCP / 扩展」设置中添加自定义 MCP 服务器：粘贴上方 JSON，或按表单填写命令为包内 `runtime\node\node.exe` 的绝对路径、参数为脚本绝对路径、环境变量 `MEPBRIDGE_ENDPOINT` |
| Cursor | 将 JSON 写入 `%USERPROFILE%\.cursor\mcp.json`（项目级为 `<项目>\.cursor\mcp.json`），重启 Cursor |
| Claude Desktop | 将 JSON 合并进 `%APPDATA%\Claude\claude_desktop_config.json`，重启 Claude Desktop |
| CodeBuddy | 将 JSON 写入项目 `.codebuddy\.mcp.json` 或用户级 `~\.codebuddy\.mcp.json`，重启 IDE |
| Codex CLI | 在 `%USERPROFILE%\.codex\config.toml` 追加（TOML 格式）：`[mcp_servers.mepbridge]`、`command = "<解压目录>/runtime/node/node.exe"`、`args = ["<解压目录>/tools/mepbridge-mcp-server.js"]`、`env = { MEPBRIDGE_ENDPOINT = "http://127.0.0.1:19780" }` |
| Antigravity CLI（原 Gemini CLI） | 将 JSON 合并进 `%USERPROFILE%\.gemini\settings.json` 顶层的 `mcpServers` 对象，然后新开一个会话 |
| Google Antigravity | 将 JSON 写入 `%USERPROFILE%\.gemini\config\mcp_config.json`，重启 Antigravity |

> **Antigravity CLI 与 Google Antigravity 同在 `~/.gemini/` 目录下，但读取的是不同配置文件。**
> Antigravity CLI（agy）读 `~/.gemini/settings.json`；Antigravity 平台读 `~/.gemini/config\mcp_config.json`。
> 写错文件不会生效。

### 在界面里查看接入状态

工作台左区有「**MCP 接入状态**」区块，每 10 秒自动刷新，列出所有已配置的宿主端。它区分两种状态：

- **已连接** —— 宿主端已完成 MCP `initialize` 握手，工具可正常使用。
- **已配置** —— 配置文件里有 MEPBridge 且宿主进程在运行。这**不能**证明连接可用；
  若工具没出现，请重启对应宿主端。

### 其它 MCP 宿主端（表中没有的）

任何支持 **stdio 传输 MCP** 的宿主端都可接入，在它的 MCP 设置里提供同样三要素即可：

1. 命令：`<你的解压目录>\runtime\node\node.exe`
2. 参数：`<你的解压目录>\tools\mepbridge-mcp-server.js`
3. 环境变量：`MEPBRIDGE_ENDPOINT=http://127.0.0.1:19780`

该脚本使用 stdio JSON-RPC 2.0，仅依赖 Node.js 内置模块，无需额外安装依赖。若某个客户端
不支持配置自定义 stdio 命令（例如纯网页版客户端），则无法接入；是否支持以该客户端自身的
MCP 能力为准。

## 用户数据

用户模板、自定义命令、LLM 配置、学习记忆和审计数据默认保存在：

```text
%APPDATA%\MEPBridge
```

可使用 `MEPBRIDGE_DATA_DIR` 指定其他可写目录。不要将用户数据写入 Archicad 安装目录或只读发布目录。

## 卸载

1. 保存工作并关闭 Archicad。
2. 双击 `Uninstall-MEPBridge.cmd`。
3. 按提示选择 Archicad 安装目录。

默认卸载只移除 APX，保留用户数据。需要清除 Workbench 菜单配置时，可运行 PowerShell 脚本并增加 `-RemoveWorkbenchConfig`。

## 版本更新

**从 v0.1.8 或更早版本升级到 v0.1.9 必须使用完整包更新。** v0.1.9 引入单一双语包、包内便携运行时和 AC30 资产；不要只换 APX，也不要把新文件覆盖进旧版本解压目录。

已安装旧版本的用户，按以下方式更新：

### 方式一：完整包更新（推荐）

适用于 Server、UI、MCP Server 或依赖有改动的版本。

1. 从 GitHub Release 下载 `MACAI-Workbench-v0.1.9-win64.zip`。解压后保留并使用包内 `RELEASE_MANIFEST.json` 与 `SHA256SUMS.txt` 校验载荷。
2. 保存工作并关闭 Archicad。
3. 将新 ZIP 解压到一个新目录（建议保留旧目录以便回滚）。
4. 双击新目录中的 `Install-MEPBridge.cmd`。
5. 按提示选择已安装的 Archicad。
6. 重新启动 Archicad。

安装程序会自动备份哈希不同的旧 APX，并替换为新版。用户数据（模板、自定义命令、知识库等）保存在 `%APPDATA%\MEPBridge`，不会被覆盖。

### 方式二：仅 APX 更新

适用于仅修复原生 Add-On、未改动 Server/UI/依赖的小版本更新。

1. 仅当 Release 明确标注“仅 APX 更新”时，下载匹配宿主版本的 `MEPbridge-apx-AC<版本>-vX.Y.Z-win64.zip` 并解压。
2. 保存工作并关闭 Archicad。
3. 将新 APX 复制到 `<Archicad 安装目录>\Add-Ons\MEPBridge\`，覆盖旧 `MEPBridge.apx`（建议先备份旧文件）。
4. 重新启动 Archicad。

> 注意：仅 APX 更新不包含 Server/UI/MCP Server 的改动。如新版本同时更新了 Workbench 组件，请使用方式一。

### 更新后验证

- Archicad 加载 Add-On 时没有错误。
- MEPbridge ACAIstr 菜单显示三个独立菜单项。
- Workbench 可打开 `http://127.0.0.1:19780/`。
- `/health` 显示新版本号。
- Ping 显示对应版本的注册命令数和 descriptor/MCP 工具数。

### 回滚

如新版本出现问题需要回滚：

- **完整包更新**：用旧目录重新运行 `Install-MEPBridge.cmd`，或从备份目录恢复旧 APX。
- **仅 APX 更新**：用之前备份的旧 `MEPBridge.apx` 覆盖新版。

用户数据在新旧版本间通常兼容；如遇数据格式不兼容，`%APPDATA%\MEPBridge\backups\` 下有自动备份。

## 验证

- Archicad 加载 Add-On 时没有错误。
- MEPbridge ACAIstr 菜单显示三个独立菜单项。
- Workbench 可以打开 `http://127.0.0.1:19780/`。
- `/health` 显示的版本与你所安装的版本一致。
- Ping 显示的注册 C++ 命令数与 Add-On descriptor/MCP 工具数，与该版本发布说明标注的数量一致。

执行写入、删除、批量或几何修改前，应使用测试或已备份的 PLN。

## v0.1.9 已知能力限制

v0.1.9不支持**既有幕墙高度编辑**；高度或高度＋分格组合请求会在写入前拒绝，不会自动删除重建。**新建幕墙时设置高度、已验证的分格编辑仍保留**。这与安装环境无关，另装Node.js或DevKit不会启用该能力。
