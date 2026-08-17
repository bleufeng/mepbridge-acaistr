# MEPbridge ACAIstr v0.1.2 安装说明

本说明适用于 Archicad 28 和 Archicad 29 的 Windows 发布包。

中文优先界面请下载 `MEPbridge-ACAIstr-v0.1.2-win64-zh-CN.zip`，英文优先界面请下载 `MEPbridge-ACAIstr-v0.1.2-win64-en-US.zip`。首次安装不要使用独立 APX 更新文件，也不要使用 GitHub 自动生成的 `Source code.zip` 或 `Source code.tar.gz`。

## 环境要求

- Windows x64
- Archicad 28 或 Archicad 29
- Node.js 18 或更高版本
- 普通可写的解压目录

Server 默认只监听 `127.0.0.1:19780`。Archicad JSON API 在本机 `127.0.0.1:19723-19743` 范围动态检测。

### Node.js 要求

原生 Add-On（`MEPBridge.apx`）本身不依赖 Node.js 也能工作，但 **Workbench Server、UI、MCP Server 都需要 Node.js 18 或更高版本**。若电脑未安装 Node.js，安装程序仍会正常安装 APX 并打印警告：Archicad 命令仍可使用，但 Workbench 在装好 Node.js 之前无法启动。

安装前或安装后用以下命令确认 Node.js 可用：

```powershell
node --version
```

如果命令找不到，请从 <https://nodejs.org/> 下载并安装 LTS 版本，然后重新打开 MEPbridge ACAIstr 菜单启动 Workbench。

## 版本选择

两个完整语言包均包含：

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
```

只能安装与 Archicad 主版本一致的 APX。

`MEPbridge-ACAIstr-v0.1.2-AC28-win64.apx` 和
`MEPbridge-ACAIstr-v0.1.2-AC29-win64.apx` 只更新原生 Add-On，不包含
Server、UI、MCP Server、生产依赖和安装脚本，仅适用于已经完成完整安装的用户。

## 自动安装

1. 将完整 ZIP 解压到普通目录。
2. 保存工作并关闭 Archicad。
3. 双击 `Install-MEPBridge.cmd`。
4. 允许 Windows 管理员权限。
5. 出现选择提示时，选择需要安装的 Archicad。
6. 重新启动 Archicad。

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

在 Archicad 中打开「帮助 → 关于 Archicad」，标题里会写 Archicad 28 或 Archicad 29。也可以看安装目录名（下一步会用到）。**必须安装与主版本一致的 APX**，装错版本 Archicad 会拒绝加载 Add-On。

### 第 2 步：找到 Archicad 安装目录

最可靠的办法：在开始菜单里找到 Archicad 图标，右键 →「更多」→「打开文件位置」，再对快捷方式右键 →「属性」，「目标」一栏即为 `Archicad.exe` 的完整路径，去掉末尾的 `\Archicad.exe` 就是安装目录。

典型路径：

```text
C:\Program Files\GRAPHISOFT\Archicad 28
D:\Program Files\GRAPHISOFT\Archicad 29
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
3. 点击「版本信息」，对话框中显示 `Version: 0.1.2`。

前三项通过即说明原生 Add-On 安装成功，Archicad JSON 命令已可用。

如需使用 Workbench（Server / UI / MCP Server），还要满足 Node.js 要求，并完成本机菜单配置。手动安装不会自动写入该配置，请在发布包根目录执行一次：

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
node server\server.js
```

4. 保持窗口开启，在浏览器打开 `http://127.0.0.1:19780/`。
5. 结束时按 `Ctrl+C` 停止 Server。

## MCP 配置

先启动 Workbench Server，再让 MCP 客户端执行：

```text
node <发布包根目录>\tools\mepbridge-mcp-server.js
```

示例：

```json
{
  "mcpServers": {
    "mepbridge-acaistr": {
      "command": "node",
      "args": ["D:\\MEPbridge-ACAIstr\\tools\\mepbridge-mcp-server.js"],
      "env": {
        "MEPBRIDGE_ENDPOINT": "http://127.0.0.1:19780"
      }
    }
  }
}
```

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

已安装旧版本的用户，按以下方式更新到新版本：

### 方式一：完整包更新（推荐）

适用于 Server、UI、MCP Server 或依赖有改动的版本。

1. 从 GitHub Releases 下载新版本的完整 ZIP（`win64-zh-CN.zip` 或 `win64-en-US.zip`）。
2. 保存工作并关闭 Archicad。
3. 将新 ZIP 解压到一个新目录（建议保留旧目录以便回滚）。
4. 双击新目录中的 `Install-MEPBridge.cmd`。
5. 按提示选择已安装的 Archicad。
6. 重新启动 Archicad。

安装程序会自动备份哈希不同的旧 APX，并替换为新版。用户数据（模板、自定义命令、知识库等）保存在 `%APPDATA%\MEPBridge`，不会被覆盖。

### 方式二：仅 APX 更新

适用于仅修复原生 Add-On、未改动 Server/UI/依赖的小版本更新。

1. 从 GitHub Releases 下载独立的 `MEPbridge-ACAIstr-vX.Y.Z-AC28-win64.apx` 或 `MEPbridge-ACAIstr-vX.Y.Z-AC29-win64.apx`（与已安装的 Archicad 主版本一致）。
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
- `/health` 显示版本 `0.1.2`。
- Ping 显示 74 个注册命令和 72 个 descriptor/MCP 工具。

执行写入、删除、批量或几何修改前，应使用测试或已备份的 PLN。
