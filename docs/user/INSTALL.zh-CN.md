# MEPbridge ACAIstr v0.1.0 安装说明

本说明适用于 Archicad 28 和 Archicad 29 的 Windows 发布包。

中文优先界面请下载 `MEPbridge-ACAIstr-v0.1.0-win64-zh-CN.zip`，英文优先界面请下载 `MEPbridge-ACAIstr-v0.1.0-win64-en-US.zip`。首次安装不要使用独立 APX 更新文件，也不要使用 GitHub 自动生成的 `Source code.zip` 或 `Source code.tar.gz`。

## 环境要求

- Windows x64
- Archicad 28 或 Archicad 29
- Node.js 18 或更高版本
- 普通可写的解压目录

Server 默认只监听 `127.0.0.1:19780`。Archicad JSON API 在本机 `127.0.0.1:19723-19743` 范围动态检测。

## 版本选择

两个完整语言包均包含：

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
```

只能安装与 Archicad 主版本一致的 APX。

`MEPbridge-ACAIstr-v0.1.0-AC28-win64.apx` 和
`MEPbridge-ACAIstr-v0.1.0-AC29-win64.apx` 只更新原生 Add-On，不包含
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

## 手动安装

1. 关闭 Archicad。
2. 从 `Archicad-28` 或 `Archicad-29` 目录复制对应的 `MEPBridge.apx`。
3. 放入 `<Archicad 安装目录>\Add-Ons\MEPBridge\`。
4. 确认目录内只有一个有效的 `MEPBridge.apx`。
5. 重新启动 Archicad。

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

## 验证

- Archicad 加载 Add-On 时没有错误。
- MEPbridge ACAIstr 菜单显示三个独立菜单项。
- Workbench 可以打开 `http://127.0.0.1:19780/`。
- `/health` 显示版本 `0.1.0`。
- Ping 显示 61 个注册命令和 59 个 descriptor/MCP 工具。

执行写入、删除、批量或几何修改前，应使用测试或已备份的 PLN。
