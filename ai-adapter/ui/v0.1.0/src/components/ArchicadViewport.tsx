// ArchicadViewport.tsx (FO-1 V1.6: AABB 包围盒示意 + P3 截图导出)
// 渲染模式:
//   1. AABB 模式（优先）: elementsWithAABB 非空时按元素类型绘制矩形示意
//   2. 圆点模式（fallback）: obstacles 圆点 + 选中高亮
// 类型颜色:
//   Wall=amber  Column=yellow  Beam=purple  Slab=blue  Roof=red
//   Duct/Ventilation=cyan  Pipe/Piping=emerald  CableCarrier=violet  其他=gray

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Maximize2, Minimize2, RefreshCw, Download, Camera, Box } from 'lucide-react';

export interface ModelObstacle {
  id?: string;
  x: number;
  y: number;
  r: number;
  label: string;
  isUserAdded?: boolean;
  elementType?: string;
  guid?: string;
}

export interface ElementWithAABB {
  guid: string;
  type: string;
  aabb?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  isMepRoute?: boolean;
  mepDomain?: string;
}

interface ArchicadViewportProps {
  obstacles?: ModelObstacle[];
  selectedElements?: string[];
  // FO-1: 带 AABB 的元素列表（优先渲染模式）
  elementsWithAABB?: ElementWithAABB[];
  showAABB?: boolean;
  language?: string;
  onRefresh?: () => void;
  captureTrigger?: number;
  onCaptureComplete?: (dataUrl: string) => void;
}

// 类型 → 颜色映射
const getTypeColor = (type: string, mepDomain?: string): string => {
  if (mepDomain === 'Ventilation') return '#06b6d4'; // cyan
  if (mepDomain === 'Piping') return '#10b981'; // emerald
  if (mepDomain === 'CableCarrier') return '#8b5cf6'; // violet

  const t = (type || '').toLowerCase();
  if (t.includes('wall')) return '#f59e0b'; // amber
  if (t.includes('column')) return '#eab308'; // yellow
  if (t.includes('beam')) return '#a855f7'; // purple
  if (t.includes('slab')) return '#3b82f6'; // blue
  if (t.includes('roof')) return '#ef4444'; // red
  if (t.includes('duct')) return '#06b6d4'; // cyan
  if (t.includes('pipe')) return '#10b981'; // emerald
  if (t.includes('cable')) return '#8b5cf6'; // violet
  return '#71717a'; // gray
};

// 类型 → 形状判定（用于图例）
const isLongShape = (type: string, w: number, h: number): boolean => {
  const t = (type || '').toLowerCase();
  const ratio = w > h ? w / h : h / w;
  return t.includes('wall') || t.includes('beam') || t.includes('duct') || t.includes('pipe') || t.includes('cable') || ratio > 4;
};

export const ArchicadViewport: React.FC<ArchicadViewportProps> = ({
  obstacles = [],
  selectedElements = [],
  elementsWithAABB = [],
  showAABB = false,
  language = 'zh-CN',
  onRefresh,
  captureTrigger = 0,
  onCaptureComplete,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewSize, setViewSize] = useState({ width: 600, height: 400 });
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);

  // 响应式尺寸
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 100 && height > 100) {
          setViewSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 截图触发器
  useEffect(() => {
    if (captureTrigger <= 0 || !svgRef.current) return;
    const timer = setTimeout(() => captureSVGAsPNG(), 300);
    return () => clearTimeout(timer);
  }, [captureTrigger]);

  // FO-1: AABB 模式优先 — 使用元素 AABB 计算视口边界
  const aabbElements = useMemo(
    () => elementsWithAABB.filter(e => e.aabb && e.aabb.min && e.aabb.max),
    [elementsWithAABB]
  );
  const useAABBMode = aabbElements.length > 0;

  // 诊断日志: 数据进入视口时的要素
  useEffect(() => {
    if (elementsWithAABB.length > 0) {
      const withAabb = elementsWithAABB.filter(e => e.aabb).length;
      const sample = elementsWithAABB[0];
      console.log('[ArchicadViewport] elementsWithAABB:', elementsWithAABB.length, 'withAabb:', withAabb, 'useAABBMode:', useAABBMode, 'sample:', sample);
      if (useAABBMode) {
        const xs = aabbElements.flatMap(e => [e.aabb!.min.x, e.aabb!.max.x]);
        const ys = aabbElements.flatMap(e => [e.aabb!.min.y, e.aabb!.max.y]);
        console.log('[ArchicadViewport] AABB X range:', Math.min(...xs), '→', Math.max(...xs), 'Y range:', Math.min(...ys), '→', Math.max(...ys));
      }
    }
  }, [elementsWithAABB, useAABBMode, aabbElements]);

  // 诊断日志: 容器尺寸变化
  useEffect(() => {
    console.log('[ArchicadViewport] viewSize:', viewSize);
  }, [viewSize]);

  const padding = useAABBMode ? 800 : 500; // AABB 模式 padding 大一些（mm 单位）
  const xs = useAABBMode
    ? aabbElements.flatMap(e => [e.aabb!.min.x, e.aabb!.max.x])
    : obstacles.map(o => o.x);
  const ys = useAABBMode
    ? aabbElements.flatMap(e => [e.aabb!.min.y, e.aabb!.max.y])
    : obstacles.map(o => o.y);

  const minX = xs.length > 0 ? Math.min(...xs) - padding : -5000;
  const maxX = xs.length > 0 ? Math.max(...xs) + padding : 5000;
  const minY = ys.length > 0 ? Math.min(...ys) - padding : -5000;
  const maxY = ys.length > 0 ? Math.max(...ys) + padding : 5000;

  const viewWidth = viewSize.width;
  const viewHeight = viewSize.height;
  const scaleX = viewWidth / (maxX - minX || 1);
  const scaleY = viewHeight / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toViewX = (x: number) => (x - cx) * scale + viewWidth / 2;
  const toViewY = (y: number) => (cy - y) * scale + viewHeight / 2; // Y轴翻转

  const aabbLeft = toViewX(minX);
  const aabbTop = toViewY(maxY);
  const aabbRight = toViewX(maxX);
  const aabbBottom = toViewY(minY);

  // SVG → PNG 导出
  const captureSVGAsPNG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;
    try {
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = viewWidth * 2;
        canvas.height = viewHeight * 2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#18181b';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          setLastScreenshot(dataUrl);
          if (onCaptureComplete) onCaptureComplete(dataUrl);
          const link = document.createElement('a');
          link.download = `mepbridge-viewport-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    } catch (e) {
      console.warn('[ArchicadViewport] Screenshot failed:', e);
    }
    return null;
  }, [viewWidth, viewHeight, onCaptureComplete]);

  const handleDownloadPNG = () => captureSVGAsPNG();

  const toggleFullscreen = () => {
    if (isFullscreen) {
      document.exitFullscreen?.();
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  const t = (zh: string, en: string) => (language === 'zh-CN' ? zh : en);
  const gridStep = scale * 1000;

  // FO-1: 图例数据
  const legendItems = useMemo(() => {
    if (!useAABBMode) return [];
    const typeSet = new Map<string, string>();
    aabbElements.forEach(e => {
      const key = e.mepDomain ? `${e.type}(${e.mepDomain})` : e.type;
      typeSet.set(key, getTypeColor(e.type, e.mepDomain));
    });
    return Array.from(typeSet.entries()).slice(0, 8);
  }, [useAABBMode, aabbElements]);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden w-full h-full ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}
      style={{ minHeight: isFullscreen ? undefined : 250, height: isFullscreen ? undefined : '100%' }}
    >
      {/* 工具栏 */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        <button
          onClick={handleDownloadPNG}
          className="p-1.5 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 rounded transition-colors"
          title={t('导出 PNG', 'Export PNG')}
        >
          <Download className="w-3.5 h-3.5 text-zinc-300" />
        </button>
        <button
          onClick={() => captureSVGAsPNG()}
          className="p-1.5 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 rounded transition-colors"
          title={t('截取当前视图', 'Screenshot Current View')}
        >
          <Camera className="w-3.5 h-3.5 text-emerald-400" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-1.5 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 rounded transition-colors"
          title={t(isFullscreen ? '退出全屏' : '全屏', isFullscreen ? 'Exit Fullscreen' : 'Fullscreen')}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-zinc-300" /> : <Maximize2 className="w-3.5 h-3.3 text-zinc-300" />}
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 rounded transition-colors"
            title={t('刷新', 'Refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-300" />
          </button>
        )}
      </div>

      {/* FO-1: 模式标识 + 图例 */}
      {useAABBMode && (
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 max-w-[60%]">
          <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800/90 border border-zinc-600 rounded text-[10px] font-mono text-cyan-400">
            <Box className="w-3 h-3" />
            {t('实际 AABB 二维示意', 'Live AABB 2D schematic')}
          </div>
          {legendItems.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 py-1 bg-zinc-800/70 border border-zinc-700 rounded max-w-full">
              {legendItems.map(([typeName, color]) => (
                <div key={typeName} className="flex items-center gap-1 text-[9px] font-mono text-zinc-400">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                  {typeName}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 最后截图缩略图 */}
      {lastScreenshot && (
        <div className="absolute bottom-2 left-2 z-10 opacity-70 hover:opacity-100 transition-opacity">
          <img
            src={lastScreenshot}
            alt={t('最后截图', 'Last screenshot')}
            className="w-16 h-12 object-cover rounded border border-zinc-600 cursor-pointer"
            onClick={() => window.open(lastScreenshot, '_blank')}
            title={t('点击查看完整截图', 'Click to view full screenshot')}
          />
        </div>
      )}

      {/* SVG 视口 */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full"
        style={{ height: '100%', minHeight: 250, display: 'block' }}
      >
        <defs>
          <pattern id="viewport-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#27272a" strokeWidth={0.5} />
          </pattern>
        </defs>

        <rect width={viewWidth} height={viewHeight} fill="url(#viewport-grid)" />

        {/* 坐标轴 */}
        <line x1={viewWidth / 2} y1={0} x2={viewWidth / 2} y2={viewHeight} stroke="#3f3f46" strokeWidth={1} strokeDasharray="4 4" />
        <line x1={0} y1={viewHeight / 2} x2={viewWidth} y2={viewHeight / 2} stroke="#3f3f46" strokeWidth={1} strokeDasharray="4 4" />

        {/* AABB 边界框（整体） */}
        {showAABB && (useAABBMode ? aabbElements.length > 0 : obstacles.length > 0) && (
          <rect
            x={Math.min(aabbLeft, aabbRight)}
            y={Math.min(aabbTop, aabbBottom)}
            width={Math.abs(aabbRight - aabbLeft)}
            height={Math.abs(aabbBottom - aabbTop)}
            fill="none"
            stroke="#a855f7"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            opacity={0.4}
          />
        )}

        {/* FO-1: 空状态 — 有元素但无 AABB 数据 */}
        {!useAABBMode && elementsWithAABB.length > 0 && obstacles.length === 0 && (
          <text x={viewWidth / 2} y={viewHeight / 2} fontSize={14} fill="#a1a1aa" fontFamily="monospace" textAnchor="middle">
            {t(`${elementsWithAABB.length} 个元素，但无 AABB 数据`, `${elementsWithAABB.length} elements, no AABB data`)}
          </text>
        )}

        {/* FO-1: AABB 模式 — 按元素类型绘制矩形示意 */}
        {useAABBMode &&
          aabbElements.map((el, idx) => {
            const vx = toViewX(el.aabb!.min.x);
            const vy = toViewY(el.aabb!.max.y); // Y翻转: max.y 在上方
            const w = (el.aabb!.max.x - el.aabb!.min.x) * scale;
            const h = (el.aabb!.max.y - el.aabb!.min.y) * scale;
            const color = getTypeColor(el.type, el.mepDomain);
            const isSelected = selectedElements.includes(el.guid);
            const longShape = isLongShape(el.type, w, h);
            const fontSize = Math.max(Math.min(scale * 600, 11), 8);

            return (
              <g key={el.guid || idx}>
                {/* 选中光晕 */}
                {isSelected && (
                  <rect
                    x={vx - 3}
                    y={vy - 3}
                    width={w + 6}
                    height={h + 6}
                    fill={color}
                    opacity={0.18}
                    rx={1}
                  >
                    <animate attributeName="opacity" values="0.18;0.06;0.18" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                {/* 主体矩形 */}
                <rect
                  x={vx}
                  y={vy}
                  width={w}
                  height={h}
                  fill={color}
                  fillOpacity={isSelected ? 0.55 : 0.32}
                  stroke={isSelected ? '#ffffff' : color}
                  strokeWidth={isSelected ? 1.5 : 0.6}
                  rx={longShape ? 0.5 : 1}
                />
                {/* 类型标签（仅大矩形显示） */}
                {(w > 30 && h > 12) && (
                  <text
                    x={vx + w / 2}
                    y={vy + h / 2 + 2}
                    fontSize={fontSize}
                    fill="#fafafa"
                    fontFamily="monospace"
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                  >
                    {el.type.length > 8 ? el.type.slice(0, 7) + '…' : el.type}
                  </text>
                )}
              </g>
            );
          })}

        {/* 圆点模式（fallback） — obstacles 圆点 */}
        {!useAABBMode &&
          obstacles.map((obs, idx) => {
            const vx = toViewX(obs.x);
            const vy = toViewY(obs.y);
            const vr = Math.max(obs.r * scale, 4);
            const isSelected = selectedElements.includes(obs.id ?? obs.guid ?? '');
            const colorClass = obs.isUserAdded
              ? (isSelected ? '#f472b6' : '#ec4899')
              : (isSelected ? '#60a5fa' : '#3b82f6');

            return (
              <g key={`${obs.id ?? obs.guid ?? idx}`}>
                {isSelected && (
                  <circle cx={vx} cy={vy} r={vr + 4} fill={colorClass} opacity={0.15}>
                    <animate attributeName="r" values={`${vr + 4};${vr + 8};${vr + 4}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.15;0.05;0.15" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  cx={vx}
                  cy={vy}
                  r={vr}
                  fill={colorClass}
                  opacity={isSelected ? 0.9 : 0.55}
                  stroke={isSelected ? '#ffffff' : colorClass}
                  strokeWidth={isSelected ? 1.5 : 0.5}
                />
                <text x={vx + vr + 4} y={vy - 2} fontSize={Math.max(scale * 150, 9)} fill="#d4d4d8" fontFamily="monospace">
                  {obs.label}
                </text>
                {obs.elementType && (
                  <text x={vx + vr + 4} y={vy + 12} fontSize={Math.max(scale * 120, 7)} fill="#a1a1aa" fontFamily="monospace">
                    [{obs.elementType}]
                  </text>
                )}
              </g>
            );
          })}

        {/* 原点标记 */}
        <text x={toViewX(0) + 4} y={toViewY(0) - 4} fontSize={10} fill="#71717a" fontFamily="monospace">
          O
        </text>

        {/* 尺寸信息 */}
        <text x={8} y={viewHeight - 8} fontSize={9} fill="#52525b" fontFamily="monospace">
          {useAABBMode
            ? `${t('范围', 'Range')}: ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}mm | ${aabbElements.length} ${t('个元素', 'elems')}`
            : `${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}mm`}
        </text>
      </svg>
    </div>
  );
};
