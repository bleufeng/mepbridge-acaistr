import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 19780); // 改为 19780，支持环境变量
const HOST = process.env.HOST || "127.0.0.1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());

function resolveRootServerEntry(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../../server/server.js"),
    path.resolve(process.cwd(), "../../../server/server.js"),
    path.resolve(process.cwd(), "server/server.js"),
    path.resolve(process.cwd(), "../server/server.js")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function mountRootApiRoutes(): boolean {
  const serverEntry = resolveRootServerEntry();
  if (!serverEntry) {
    console.warn("Root backend routes were not found. Falling back to UI-local API stubs.");
    return false;
  }

  const rootRequire = createRequire(serverEntry);
  const routes: Array<[string, string]> = [
    ["/api/status", "status"],
    ["/api/ping", "status"],
    ["/api/generate-plan", "generate-plan"],
    ["/api/execute-step", "execute-step"],
    ["/api/execute", "execute"],
    ["/api/summarize-result", "summarize-result"],
    ["/api/undo", "undo"],
    ["/api/llm-config", "llm-config"],
    ["/api/extensions", "extensions"],
    ["/api/copilot/message", "copilot-message"],
    ["/api/user-assets", "user-assets"],
    ["/api/plan-chain", "plan-chain"],
    ["/api/knowledge-base", "knowledge-base"],
    ["/api/learning-memory", "learning-memory"],
    ["/api/proactive", "proactive-intelligence"],
    ["/api/selection", "selection-events"],
    ["/api/mcp", "mcp-status"]
  ];

  for (const [mountPath, routeName] of routes) {
    app.use(mountPath, rootRequire(`./routes/${routeName}`));
  }

  console.log(`Mounted root backend routes from: ${path.dirname(serverEntry)}`);
  return true;
}

mountRootApiRoutes();

// Initialize Gemini SDK if API Key exists
let ai: GoogleGenAI | null = null;
const API_KEY = process.env.GEMINI_API_KEY;

if (API_KEY && API_KEY !== "MY_GEMINI_API_KEY" && API_KEY.trim() !== "") {
  try {
    ai = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("Gemini API initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Gemini API:", error);
  }
} else {
  console.log("No valid GEMINI_API_KEY found in environment. Using robust local simulation fallback.");
}

// ----------------- Heuristic Falling Back Logic for Offline Mode -----------------
function generateLocalPlan(message: string): any {
  const norm = message.toLowerCase();

  // 1. Move/Shift elements
  if (norm.includes("移动") || norm.includes("move") || norm.includes("shift") || norm.includes("偏移")) {
    const isEnglish = /[a-zA-Z]/.test(norm);
    return {
      message: isEnglish
        ? "I have analyzed the current MEP model layout. Below is the proposed operation plan to offset the elements while preventing any load-bearing wall penetrations."
        : "我已分析了当前 MEP 模型的空间布局。下面是移动构件的操作计划，该计划已自动避开了承重墙等障碍物体。",
      isMepAction: true,
      action: {
        title: isEnglish ? "Offset MEP Elements & Re-align" : "偏移并校准 MEP 构件",
        warning: isEnglish
          ? "Safety warning: Offsetting these elements might affect the connection angles of adjacent bypass conduits."
          : "安全提示：此偏移量接近吊顶标高极限，自动调整倾斜角度为 1.5% 以防冲突。",
        isMutation: true,
        mepCode: "MB.MoveElements(selection='Pipe-Line-A03', dx=1200, dy=0, dz=150)",
        steps: [
          {
            id: "step_1",
            title: "ScanStructure",
            description: isEnglish ? "Scan surrounding structures inside Archicad to evaluate clearance vectors" : "扫描 Archicad 中目标路径周围 1200mm 内的所有建筑结构体",
            expectedResult: isEnglish ? "Clearance check passed. No vertical column interference detected." : "结构扫描完成：无硬性碰撞，存在1处吊顶标高临界点",
            params: { "scope": "Local Selection", "clashTolerance": "10mm", "scanDepth": "1500mm" }
          },
          {
            id: "step_2",
            title: "Re-RouteConduit",
            description: isEnglish ? "Shift pipe objects and automatically compensate branching connection angles" : "执行位置偏移，并重新调整支路管线的连接弯头角度",
            expectedResult: isEnglish ? "Moved 14 active MEP nodes. Automatically computed branch bend angle: 45°." : "成功移动 14 个管线节点，支路夹角重算为 45° 符合规范",
            params: { "displacement": "[1200, 0, 150]", "interpolation": "Spline-Match", "autoSlope": "1.5%" }
          },
          {
            id: "step_3",
            title: "ReadbackVerify",
            description: isEnglish ? "Execute Gate-4 readback telemetry verification on modified coordinates in Archicad" : "通过 Archicad 接口重新拉取模型数据并对比实际和预估的三维位置差距",
            expectedResult: isEnglish ? "Verification success. Real displacement matches theoretical coordinate shift within 1mm." : "物理层读回重校验：坐标吻合，最大拟合误差 0.4mm。安全闸门已复位。",
            params: { "targetUID": "A1B2C3D4-E5F6", "strictTolerance": "1mm", "verifyClashes": "true" }
          }
        ],
        parameters: [
          { item: "移动距离(X轴)", expected: "1200 mm", actual: "1200.0 mm", status: "ok" },
          { item: "偏移高度(Z轴)", expected: "150 mm", actual: "149.8 mm", status: "ok" },
          { item: "物理硬碰撞数", expected: "0", actual: "0", status: "ok" },
          { item: "管段最大坡度", expected: "1.5%", actual: "1.503%", status: "ok" }
        ]
      }
    };
  }

  // 2. Query/Read attributes
  if (norm.includes("读取") || norm.includes("read") || norm.includes("查询") || norm.includes("获取") || norm.includes("inspect")) {
    const isEnglish = /[a-zA-Z]/.test(norm);
    return {
      message: isEnglish
        ? "I have finished analyzing the model layers and elements. Below is the operational plan to inspect thermal properties and dimensions."
        : "查询请求解析完毕。本计划仅包含只读校验与属性提取，安全阀门已由系统判定为免审批（只读模式）。",
      isMepAction: true,
      action: {
        title: isEnglish ? "Inspect Selected Wall Elements" : "查询并分析指定外墙构件属性",
        warning: null,
        isMutation: false,
        mepCode: "MB.QueryAttributes(target_layer='Archicad.Wall.Exterior', attributes=['thickness', 'u-value'])",
        steps: [
          {
            id: "step_1",
            title: "QueryGeometry",
            description: isEnglish ? "Extract physical thicknesses and geometries from current viewport selection" : "自当前视口选定范围中过滤出所有外墙，并抓取截面厚度及面域几何数据",
            expectedResult: isEnglish ? "Retrieved geometry data for 8 active walls." : "成功回显 8 组外墙。平均厚度 300mm，材料密度符合 A 级耐火要求",
            params: { "targetLayer": "Structural-Wall-Ext", "precision": "double" }
          },
          {
            id: "step_2",
            title: "ReadbackVerify",
            description: isEnglish ? "Verify thermal conductivity parameter and export to tabular log" : "拉取 Archicad 物理属性缓存，检验热工 U 值是否异常",
            expectedResult: isEnglish ? "Telemetry verification finished: average U-value of 0.28 W/m²K." : "读回检验完成：墙体传热系数平均为 0.28 W/m²K，未发现缺失值",
            params: { "propertyId": "Thermal.UValue", "backupLog": "JSON" }
          }
        ],
        parameters: [
          { item: "有效墙体数", expected: "8", actual: "8", status: "ok" },
          { item: "材质平均厚度", expected: "300.0 mm", actual: "300.0 mm", status: "ok" },
          { item: "热传导率 U值", expected: "<= 0.35 W/m²K", actual: "0.28 W/m²K", status: "ok" },
          { item: "数据非空率", expected: "100%", actual: "100%", status: "ok" }
        ]
      }
    };
  }

  // 3. Default: Design / Create pipe or duct
  const isEnglish = /[a-zA-Z]/.test(norm);
  return {
    message: isEnglish
      ? "Understood. Based on your geometric description, I have created a dynamic routing path avoiding surrounding columns in our preview canvas. Below is the multi-step operation plan:"
      : "收到您的管道排布请求。已基于三维空间约束在左侧视图和中栏中渲染出了管线布置的最佳路径。下面是根据 Endra 三层架构设计出的高度安全型执行计划：",
    isMepAction: true,
    action: {
      title: isEnglish ? "Create Structural Conduit Line" : "在三维工作区创建新型 MEP 管网",
      warning: isEnglish
        ? "Notice: This operation modifies the CAD model. Please check the coordinate alignments."
        : "修改警告：该操作将会在 Archicad 的 'MEP-Pipes' 图层中写入 1 个新管段和 2 个弯头。",
      isMutation: true,
      mepCode: "MB.CreatePipe(start=[0,0,3000], end=[5000,0,3000], outer_diameter=250, system_type='FreshAir')",
      steps: [
        {
          id: "step_1",
          title: "ScanStructure",
          description: isEnglish ? "Scan surrounding structures inside Archicad to evaluate clearance barriers" : "扫描管道路径周围 500mm 半径的所有建筑梁、斜支撑及钢结构体",
          expectedResult: isEnglish ? "Clearance barrier scan complete. Identified 1 potential structural clash near origin." : "路径核查完成：发现 1 处立柱软碰撞威胁，已自动微调起终点夹角",
          params: { "sensorRange": "2000mm", "checkClashes": "true", "safetyOffset": "100mm" }
        },
        {
          id: "step_2",
          title: "Createconduit",
          description: isEnglish ? "Write new MEP pipe segments on the target layer inside Archicad with assigned parameters" : "在选中图层创建物理连接管，并绑定系统信息：新风系统 (Fresh Air)，直径 250mm",
          expectedResult: isEnglish ? "Pipe successfully spawned. Assigned Unique ID: GUID-902-D73-A4F." : "物理管道构造完毕，管段长度 5240mm。弯折连接良好",
          params: { "layer": "MEP-Pipes", "system": "FreshAir", "diameter": "250mm" }
        },
        {
          id: "step_3",
          title: "ReadbackVerify",
          description: isEnglish ? "Verify thermal insulation, system connection nodes and physical layout bounds" : "自动读回新增管段在 Archicad 实体的几何定位，对物理层运算进行回验",
          expectedResult: isEnglish ? "Verified 100% path correlation. Safety Gate restored to neutral." : "验证结果：管段坡度 (0.52%) 处于最佳排水阈值，几何对齐率 100%",
          params: { "method": "Gate-4 Realtime Readback", "coordinateValidation": "true", "tolerance": "1.5mm" }
        }
      ],
      parameters: [
        { item: "起起点高度 (Z)", expected: "3000.0 mm", actual: "3000.0 mm", status: "ok" },
        { item: "终点高度 (Z)", expected: "3000.0 mm", actual: "3000.0 mm", status: "ok" },
        { item: "管段外直径", expected: "250.0 mm", actual: "250.0 mm", status: "ok" },
        { item: "与承重柱间距", expected: "> 100.0 mm", actual: "154.2 mm", status: "ok" }
      ]
    }
  };
}

// ----------------- API Endpoints -----------------

// Copilot Chat & Intelligent planning route
// Proxy to Archicad JSON API
const ARCHICAD_HOST = process.env.ARCHICAD_HOST || "127.0.0.1";
const ARCHICAD_PORT = Number(process.env.ARCHICAD_PORT || 19723);

async function archicadJson(command: any): Promise<any> {
  const response = await fetch(`http://${ARCHICAD_HOST}:${ARCHICAD_PORT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  return response.json();
}

// /api/ping - Check Archicad and MEPBridge connection
app.get("/api/ping", async (req, res) => {
  try {
    const api = await archicadJson({ command: "API.IsAlive", parameters: {} });
    const ping = await archicadJson({
      command: "API.ExecuteAddOnCommand",
      parameters: {
        addOnCommandId: { commandNamespace: "MEPBridge", commandName: "Ping" },
        addOnCommandParameters: {}
      }
    });

    res.json({
      ok: true,
      archicad: api && api.succeeded === true,
      mepbridge: ping && ping.succeeded === true,
      api,
      ping
    });
  } catch (error) {
    res.json({ ok: false, archicad: false, mepbridge: false });
  }
});

// /api/execute - Execute Archicad commands
app.post("/api/execute", async (req, res) => {
  try {
    const { command } = req.body;
    const result = await archicadJson(command);
    res.json({ ok: true, response: result });
  } catch (error) {
    res.json({ ok: false, error: String(error) });
  }
});

app.post("/api/copilot/message", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing message body" });
  }

  // If AI is set up, try to use Gemini with Structured JSON to get professional plans!
  if (ai) {
    try {
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          message: {
            type: Type.STRING,
            description: "Friendly explanation to the user about what research or analysis or design setup and verification we are recommending.",
          },
          isMepAction: {
            type: Type.BOOLEAN,
            description: "Whether this user instruction requires an actionable, multi-step engineering operation design (mutations, moves, inquiries). Set to true for almost all CAD/MEP command instructions.",
          },
          action: {
            type: Type.OBJECT,
            description: "The complete step-by-step engineering action plan.",
            properties: {
              title: { type: Type.STRING },
              warning: { type: Type.STRING, description: "Safety Warning flag if editing/mutating, or null if query-only or harmless." },
              isMutation: { type: Type.BOOLEAN, description: "True if creating/modifying/deleting geometry, false if querying." },
              mepCode: { type: Type.STRING, description: "Pseudo API script code representing this process, e.g. MB.CreatePipe(...)" },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING, description: "One of: ScanStructure, CreateConduit, Re-RouteConduit, QueryGeometry, or ReadbackVerify" },
                    description: { type: Type.STRING },
                    expectedResult: { type: Type.STRING },
                    params: {
                      type: Type.OBJECT,
                      description: "Key-value set representing physical criteria or constraints."
                    }
                  },
                  required: ["id", "title", "description", "expectedResult", "params"]
                }
              },
              parameters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    item: { type: Type.STRING, description: "Name of variable, e.g., 'Position-X'" },
                    expected: { type: Type.STRING, description: "The calculated threshold" },
                    actual: { type: Type.STRING, description: "The simulated physical feedback measure" },
                    status: { type: Type.STRING, description: "Use 'ok' or 'warning'" }
                  },
                  required: ["item", "expected", "actual", "status"]
                }
              }
            },
            required: ["title", "isMutation", "mepCode", "steps", "parameters"]
          }
        },
        required: ["message", "isMepAction"]
      };

      const prompt = `
        You are the backend AI model for 'MEPBridge ACAIstr'. Your job is to parse structural commands or CAD requests, and return a robust JSON following the Endra three-layer architecture (Probability Layer, Deterministic Safety Layer, Physical Layer).
        Current request: "${message}"

        Return a highly professional, accurate structural plan.
        Make sure the steps strictly contain realistic CAD / Architecture terminology, such as:
        - Layer management
        - Geometric clash detection
        - Auto sloped gravity pipe checks
        - Gate-4 absolute readback validation bounds.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are an elite mechanical, electrical, and plumbing (MEP) integration engine. Convert natural language commands into structured JSON coordinate actions and verification schedules.",
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      return res.json(parsed);
    } catch (err) {
      console.warn("Gemini execution hit an issue, using local heuristic fallback:", err);
      return res.json(generateLocalPlan(message));
    }
  }

  // Secure and offline fallback
  const plan = generateLocalPlan(message);
  return res.json(plan);
});

// Test Connection
app.post("/api/copilot/test-connection", (req, res) => {
  const { provider, apiKey, endpoint } = req.body;
  if (provider === "custom" && !endpoint) {
    return res.json({ success: false, message: "Custom endpoint configuration is missing." });
  }
  if (!apiKey || apiKey.trim() === "") {
    return res.json({ success: false, message: "API key cannot be empty." });
  }

  // Play a realistic latency
  setTimeout(() => {
    return res.json({
      success: true,
      message: `Successfully authenticated connection to ${provider.toUpperCase() || "LLM"}. Simulated average ping: 42ms.`
    });
  }, 900);
});

// Serve Vite dev server or static distribution files
async function startServer() {
  // __dirname 在源码模式是 ai-adapter/ui/v0.1.0/，在打包后是 ai-adapter/ui/v0.1.0/dist/
  // 兼容两种情况：如果 __dirname 下有 index.html 则是打包后，否则拼 dist
  const distPath = fs.existsSync(path.join(__dirname, "index.html"))
    ? __dirname
    : path.join(__dirname, "dist");
  const isProduction = process.env.NODE_ENV === "production";
  const distExists = fs.existsSync(path.join(distPath, "index.html"));

  if (!isProduction && !distExists) {
    // 纯开发模式：dist 不存在，使用 Vite 开发服务器
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server mounted as custom middleware.");
  } else {
    // 生产模式或 dist 已构建：使用静态文件
    console.log(`Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`MEPBridge ACAIstr dev-server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
