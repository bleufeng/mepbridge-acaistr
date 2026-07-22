# Project Insights

`project-insights` is the reference C2 Workbench module. It demonstrates how a
reviewed module can combine existing read-only MEPbridge commands without
adding a C++ command or changing the 59 core descriptor/MCP tools.

The module exposes `project-insights.get-summary`, which calls:

- `MEPBridge.GetProjectInfo`
- `MEPBridge.GetStories`

The runtime grants only the commands listed in `manifest.json`.
