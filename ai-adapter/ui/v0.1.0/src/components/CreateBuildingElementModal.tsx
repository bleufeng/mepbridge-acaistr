// CreateBuildingElementModal.tsx
// 通用建筑元素创建对话框 — BASE 模式 BUILDING 模块
// 支持 12 种元素: Wall/Column/Beam/Slab/Door/Window/Roof/Stair/Object/Lamp/Mesh/Zone

import React, { useState, useMemo } from 'react';
import { X, Eye, CheckCircle, Layers, Box, Minus, Square, DoorOpen, AppWindow, Triangle, TrendingUp, Armchair, Lightbulb, Mountain, Grid3x3 } from 'lucide-react';

interface Point2D { x: number; y: number; }

type ElementType = 'Wall' | 'Column' | 'Beam' | 'Slab' | 'Door' | 'Window' | 'Roof' | 'Stair' | 'Object' | 'Lamp' | 'Mesh' | 'Zone';

interface BuildingElementParams {
  // 通用
  start?: Point2D;
  end?: Point2D;
  position?: Point2D;
  polygon?: Point2D[];
  vertices?: Point2D[];
  thickness?: number;
  height?: number;
  level?: number;
  rotationAngle?: number;
  floorIndex?: number;
  // Door/Window
  owner?: string;
  width?: number;
  refPos?: number;
  // Roof
  pitchAngle?: number;
  baseLevel?: number;
  // Stair
  totalHeight?: number;
  stepNum?: number;
  flightWidth?: number;
  treadDepth?: number;
  // Object/Lamp
  libPartName?: string;
  angle?: number;
  // Zone
  zoneName?: string;
  zoneCategory?: string;
}

interface CreateBuildingElementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (commandName: string, params: any) => Promise<void>;
  lang: string;
  initialElementType?: ElementType;
}

const ELEMENT_CONFIG: Record<ElementType, { icon: React.ReactNode; zhName: string; enName: string; commandName: string; color: string }> = {
  Wall:    { icon: <Layers className="w-4 h-4" />,     zhName: '墙',   enName: 'Wall',    commandName: 'CreateWall',    color: 'amber' },
  Column:  { icon: <Box className="w-4 h-4" />,       zhName: '柱',   enName: 'Column',  commandName: 'CreateColumn',  color: 'amber' },
  Beam:    { icon: <Minus className="w-4 h-4" />,     zhName: '梁',   enName: 'Beam',    commandName: 'CreateBeam',    color: 'amber' },
  Slab:    { icon: <Square className="w-4 h-4" />,    zhName: '板',   enName: 'Slab',    commandName: 'CreateSlab',    color: 'amber' },
  Door:    { icon: <DoorOpen className="w-4 h-4" />,  zhName: '门',   enName: 'Door',    commandName: 'CreateDoor',    color: 'amber' },
  Window:  { icon: <AppWindow className="w-4 h-4" />, zhName: '窗',   enName: 'Window',  commandName: 'CreateWindow',  color: 'amber' },
  Roof:    { icon: <Triangle className="w-4 h-4" />,  zhName: '屋顶', enName: 'Roof',    commandName: 'CreateRoof',    color: 'amber' },
  Stair:   { icon: <TrendingUp className="w-4 h-4" />,zhName: '楼梯', enName: 'Stair',   commandName: 'CreateStair',   color: 'amber' },
  Object:  { icon: <Armchair className="w-4 h-4" />,  zhName: '对象', enName: 'Object',  commandName: 'CreateObject',  color: 'amber' },
  Lamp:    { icon: <Lightbulb className="w-4 h-4" />, zhName: '灯具', enName: 'Lamp',    commandName: 'CreateLamp',    color: 'amber' },
  Mesh:    { icon: <Mountain className="w-4 h-4" />,  zhName: '地形', enName: 'Mesh',    commandName: 'CreateMesh',    color: 'amber' },
  Zone:    { icon: <Grid3x3 className="w-4 h-4" />,   zhName: '区域', enName: 'Zone',    commandName: 'CreateZone',    color: 'amber' },
};

const NumberInput: React.FC<{ label: string; value: number | undefined; onChange: (v: number) => void; step?: number; placeholder?: string }> = ({
  label, value, onChange, step = 0.1, placeholder
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-zinc-500 font-mono uppercase">{label}</label>
    <input
      type="number"
      step={step}
      value={value ?? ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
    />
  </div>
);

const PointInput: React.FC<{ label: string; point: Point2D | undefined; onChange: (p: Point2D) => void }> = ({
  label, point, onChange
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-zinc-500 font-mono uppercase">{label}</label>
    <div className="flex gap-1.5">
      <input
        type="number"
        step={0.1}
        value={point?.x ?? 0}
        onChange={e => onChange({ x: parseFloat(e.target.value) || 0, y: point?.y ?? 0 })}
        placeholder="X"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
      />
      <input
        type="number"
        step={0.1}
        value={point?.y ?? 0}
        onChange={e => onChange({ x: point?.x ?? 0, y: parseFloat(e.target.value) || 0 })}
        placeholder="Y"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
      />
    </div>
  </div>
);

const PolygonInput: React.FC<{ label: string; points: Point2D[] | undefined; onChange: (pts: Point2D[]) => void; minPoints?: number }> = ({
  label, points = [], onChange, minPoints = 3
}) => {
  const updatePoint = (idx: number, axis: 'x' | 'y', val: number) => {
    const newPts = [...points];
    while (newPts.length <= idx) newPts.push({ x: 0, y: 0 });
    newPts[idx] = { ...newPts[idx], [axis]: val };
    onChange(newPts);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] text-zinc-500 font-mono uppercase">{label} ({points.length} {points.length >= minPoints ? '✓' : `需≥${minPoints}`})</label>
      <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
        {points.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono w-6">P{i+1}</span>
            <input
              type="number"
              step={0.1}
              value={p.x}
              onChange={e => updatePoint(i, 'x', parseFloat(e.target.value) || 0)}
              placeholder="X"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-200 font-mono outline-none focus:border-amber-500"
            />
            <input
              type="number"
              step={0.1}
              value={p.y}
              onChange={e => updatePoint(i, 'y', parseFloat(e.target.value) || 0)}
              placeholder="Y"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-200 font-mono outline-none focus:border-amber-500"
            />
            {points.length > minPoints && (
              <button
                onClick={() => onChange(points.filter((_, j) => j !== i))}
                className="text-zinc-500 hover:text-red-400 text-xs px-1"
                title="Remove"
              >✕</button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...points, { x: 0, y: 0 }])}
        className="text-[10px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded py-1 hover:bg-amber-500/10 transition-colors"
      >+ {label === 'vertices' ? 'Add Vertex' : 'Add Point'}</button>
    </div>
  );
};

export const CreateBuildingElementModal: React.FC<CreateBuildingElementModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang,
  initialElementType = 'Wall'
}) => {
  const [elementType, setElementType] = useState<ElementType>(initialElementType);
  const [params, setParams] = useState<BuildingElementParams>({});
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  const zh = lang === 'zh-CN';
  const config = ELEMENT_CONFIG[elementType];

  // 切换元素类型时重置参数（保留默认值）
  const switchType = (t: ElementType) => {
    setElementType(t);
    setParams({});
    setDryRunResult(null);
  };

  // 构建 commandParameters
  const buildCommandParams = (dryRun: boolean): any => {
    const base: any = { dryRun, confirmRequired: !dryRun };
    switch (elementType) {
      case 'Wall':
        base.start = params.start ?? { x: 0, y: 0 };
        base.end = params.end ?? { x: 5, y: 0 };
        if (params.thickness) base.thickness = params.thickness;
        if (params.height) base.height = params.height;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Column':
        base.position = params.position ?? { x: 0, y: 0 };
        if (params.height) base.height = params.height;
        if (params.rotationAngle) base.rotationAngle = params.rotationAngle;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Beam':
        base.start = params.start ?? { x: 0, y: 0 };
        base.end = params.end ?? { x: 5, y: 0 };
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Slab':
        base.polygon = (params.polygon && params.polygon.length >= 3) ? params.polygon : [{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:0,y:5}];
        if (params.thickness) base.thickness = params.thickness;
        if (params.level !== undefined) base.level = params.level;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Door':
      case 'Window':
        base.owner = params.owner || '';
        base.width = params.width ?? 0.9;
        base.height = params.height ?? 2.1;
        if (params.refPos !== undefined) base.refPos = params.refPos;
        break;
      case 'Roof':
        base.vertices = (params.vertices && params.vertices.length >= 3) ? params.vertices : [{x:0,y:0},{x:6,y:0},{x:6,y:4},{x:0,y:4}];
        if (params.pitchAngle !== undefined) base.pitchAngle = params.pitchAngle;
        if (params.thickness) base.thickness = params.thickness;
        if (params.baseLevel !== undefined) base.baseLevel = params.baseLevel;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Stair':
        base.start = params.start ?? { x: 0, y: 0 };
        base.end = params.end ?? { x: 4, y: 0 };
        base.totalHeight = params.totalHeight ?? 3.0;
        if (params.stepNum) base.stepNum = params.stepNum;
        if (params.flightWidth) base.flightWidth = params.flightWidth;
        if (params.treadDepth) base.treadDepth = params.treadDepth;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Object':
      case 'Lamp':
        base.position = params.position ?? { x: 0, y: 0 };
        if (params.libPartName) base.libPartName = params.libPartName;
        if (params.angle !== undefined) base.angle = params.angle;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Mesh':
        base.polygon = (params.polygon && params.polygon.length >= 3) ? params.polygon : [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
        if (params.level !== undefined) base.level = params.level;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
      case 'Zone':
        base.polygon = (params.polygon && params.polygon.length >= 3) ? params.polygon : [{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}];
        if (params.zoneName) base.zoneName = params.zoneName;
        if (params.zoneCategory) base.zoneCategory = params.zoneCategory;
        if (params.height) base.height = params.height;
        if (params.floorIndex !== undefined) base.floorIndex = params.floorIndex;
        break;
    }
    return base;
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: config.commandName },
              addOnCommandParameters: buildCommandParams(true)
            }
          }
        })
      });
      setDryRunResult(await res.json());
    } catch (err) {
      console.error("Preview failed:", err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecute = async () => {
    setIsLoading(true);
    try {
      await onExecute(config.commandName, buildCommandParams(false));
      onClose();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // 渲染元素类型选择器
  const renderTypeSelector = () => (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {(Object.keys(ELEMENT_CONFIG) as ElementType[]).map(t => {
        const c = ELEMENT_CONFIG[t];
        const active = elementType === t;
        return (
          <button
            key={t}
            onClick={() => switchType(t)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-mono font-medium transition-all border ${
              active
                ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            {c.icon}
            {zh ? c.zhName : c.enName}
          </button>
        );
      })}
    </div>
  );

  // 渲染参数表单（按元素类型）
  const renderParamsForm = () => {
    switch (elementType) {
      case 'Wall':
        return (
          <div className="grid grid-cols-2 gap-3">
            <PointInput label={zh ? '起点' : 'Start'} point={params.start} onChange={p => setParams({...params, start: p})} />
            <PointInput label={zh ? '终点' : 'End'} point={params.end} onChange={p => setParams({...params, end: p})} />
            <NumberInput label={zh ? '厚度(m)' : 'Thickness(m)'} value={params.thickness} onChange={v => setParams({...params, thickness: v})} placeholder="0.2" />
            <NumberInput label={zh ? '高度(m)' : 'Height(m)'} value={params.height} onChange={v => setParams({...params, height: v})} placeholder="3.0" />
          </div>
        );
      case 'Column':
        return (
          <div className="grid grid-cols-2 gap-3">
            <PointInput label={zh ? '位置' : 'Position'} point={params.position} onChange={p => setParams({...params, position: p})} />
            <NumberInput label={zh ? '高度(m)' : 'Height(m)'} value={params.height} onChange={v => setParams({...params, height: v})} placeholder="3.0" />
            <NumberInput label={zh ? '旋转(rad)' : 'Rotation(rad)'} value={params.rotationAngle} onChange={v => setParams({...params, rotationAngle: v})} placeholder="0" />
          </div>
        );
      case 'Beam':
        return (
          <div className="grid grid-cols-2 gap-3">
            <PointInput label={zh ? '起点' : 'Start'} point={params.start} onChange={p => setParams({...params, start: p})} />
            <PointInput label={zh ? '终点' : 'End'} point={params.end} onChange={p => setParams({...params, end: p})} />
          </div>
        );
      case 'Slab':
        return (
          <div className="grid grid-cols-1 gap-3">
            <PolygonInput label={zh ? '多边形' : 'Polygon'} points={params.polygon} onChange={pts => setParams({...params, polygon: pts})} minPoints={3} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={zh ? '厚度(m)' : 'Thickness(m)'} value={params.thickness} onChange={v => setParams({...params, thickness: v})} placeholder="0.15" />
              <NumberInput label={zh ? '标高(m)' : 'Level(m)'} value={params.level} onChange={v => setParams({...params, level: v})} placeholder="0" />
            </div>
          </div>
        );
      case 'Door':
      case 'Window':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] text-zinc-500 font-mono uppercase">{zh ? '宿主墙 GUID' : 'Host Wall GUID'}</label>
              <input
                type="text"
                value={params.owner || ''}
                onChange={e => setParams({...params, owner: e.target.value})}
                placeholder="GUID"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
              />
            </div>
            <NumberInput label={zh ? '宽度(m)' : 'Width(m)'} value={params.width} onChange={v => setParams({...params, width: v})} placeholder="0.9" />
            <NumberInput label={zh ? '高度(m)' : 'Height(m)'} value={params.height} onChange={v => setParams({...params, height: v})} placeholder="2.1" />
            <NumberInput label={zh ? '参考位置(m)' : 'RefPos(m)'} value={params.refPos} onChange={v => setParams({...params, refPos: v})} placeholder="0" />
          </div>
        );
      case 'Roof':
        return (
          <div className="grid grid-cols-1 gap-3">
            <PolygonInput label="vertices" points={params.vertices} onChange={pts => setParams({...params, vertices: pts})} minPoints={3} />
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label={zh ? '坡角(°)' : 'Pitch(°)'} value={params.pitchAngle} onChange={v => setParams({...params, pitchAngle: v})} placeholder="30" />
              <NumberInput label={zh ? '厚度(m)' : 'Thickness(m)'} value={params.thickness} onChange={v => setParams({...params, thickness: v})} placeholder="0.15" />
              <NumberInput label={zh ? '基标高(m)' : 'BaseLevel(m)'} value={params.baseLevel} onChange={v => setParams({...params, baseLevel: v})} placeholder="3.0" />
            </div>
          </div>
        );
      case 'Stair':
        return (
          <div className="grid grid-cols-2 gap-3">
            <PointInput label={zh ? '起点' : 'Start'} point={params.start} onChange={p => setParams({...params, start: p})} />
            <PointInput label={zh ? '终点' : 'End'} point={params.end} onChange={p => setParams({...params, end: p})} />
            <NumberInput label={zh ? '总高度(m)' : 'TotalHeight(m)'} value={params.totalHeight} onChange={v => setParams({...params, totalHeight: v})} placeholder="3.0" />
            <NumberInput label={zh ? '步数' : 'StepNum'} value={params.stepNum} onChange={v => setParams({...params, stepNum: v})} step={1} placeholder="16" />
            <NumberInput label={zh ? '梯段宽(m)' : 'FlightWidth(m)'} value={params.flightWidth} onChange={v => setParams({...params, flightWidth: v})} placeholder="1.2" />
            <NumberInput label={zh ? '踏步深(m)' : 'TreadDepth(m)'} value={params.treadDepth} onChange={v => setParams({...params, treadDepth: v})} placeholder="0.28" />
          </div>
        );
      case 'Object':
      case 'Lamp':
        return (
          <div className="grid grid-cols-2 gap-3">
            <PointInput label={zh ? '位置' : 'Position'} point={params.position} onChange={p => setParams({...params, position: p})} />
            <NumberInput label={zh ? '旋转(°)' : 'Angle(°)'} value={params.angle} onChange={v => setParams({...params, angle: v})} placeholder="0" />
            <div className="col-span-2">
              <label className="text-[10px] text-zinc-500 font-mono uppercase">{zh ? '库部件名' : 'LibPartName'}</label>
              <input
                type="text"
                value={params.libPartName || ''}
                onChange={e => setParams({...params, libPartName: e.target.value})}
                placeholder="Table 01"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
              />
            </div>
          </div>
        );
      case 'Mesh':
        return (
          <div className="grid grid-cols-1 gap-3">
            <PolygonInput label={zh ? '多边形' : 'Polygon'} points={params.polygon} onChange={pts => setParams({...params, polygon: pts})} minPoints={3} />
            <NumberInput label={zh ? '标高(m)' : 'Level(m)'} value={params.level} onChange={v => setParams({...params, level: v})} placeholder="0" />
          </div>
        );
      case 'Zone':
        return (
          <div className="grid grid-cols-1 gap-3">
            <PolygonInput label={zh ? '多边形' : 'Polygon'} points={params.polygon} onChange={pts => setParams({...params, polygon: pts})} minPoints={3} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-500 font-mono uppercase">{zh ? '区域名' : 'ZoneName'}</label>
                <input
                  type="text"
                  value={params.zoneName || ''}
                  onChange={e => setParams({...params, zoneName: e.target.value})}
                  placeholder="Living Room"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-amber-500"
                />
              </div>
              <NumberInput label={zh ? '高度(m)' : 'Height(m)'} value={params.height} onChange={v => setParams({...params, height: v})} placeholder="2.8" />
            </div>
          </div>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-amber-500/30 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold font-display text-amber-300 flex items-center gap-2">
            {config.icon}
            {zh ? `创建${config.zhName}` : `Create ${config.enName}`}
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {renderTypeSelector()}
          {renderParamsForm()}

          {/* DryRun 结果 */}
          {dryRunResult && (
            <div className="mt-4 p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
              <div className="text-[10px] text-zinc-500 font-mono mb-1.5 flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {zh ? '预检结果 (DryRun)' : 'Preview (DryRun)'}
              </div>
              <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                {JSON.stringify(dryRunResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-950/50">
          <button
            onClick={handlePreview}
            disabled={isPreviewing}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" />
            {isPreviewing ? '...' : (zh ? '预检' : 'Preview')}
          </button>
          <button
            onClick={handleExecute}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 rounded text-xs font-semibold text-amber-300 transition-colors disabled:opacity-50"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {isLoading ? '...' : (zh ? `执行创建${config.zhName}` : `Execute Create ${config.enName}`)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateBuildingElementModal;
