import React from 'react';
import { Zap, ZapOff, Loader2 } from 'lucide-react';

/**
 * Extension Button Props
 */
interface ExtensionButtonProps {
  /** 按钮标签 */
  label: string;

  /** 描述文本 */
  description?: string;

  /** 所需的扩展名称 */
  extensionName: string;

  /** 扩展是否可用 */
  available: boolean;

  /** 是否加载中 */
  loading?: boolean;

  /** 点击回调 */
  onClick: () => void;

  /** 自定义图标 */
  icon?: React.ReactNode;

  /** 按钮样式变体 */
  variant?: 'default' | 'primary' | 'success';

  /** 是否禁用 */
  disabled?: boolean;

  /** 自定义类名 */
  className?: string;
}

/**
 * 状态感知扩展按钮组件
 *
 * 特性:
 * - 自动灰度显示（扩展不可用时）
 * - 悬浮提示
 * - 遮罩层提示
 * - 加载状态
 * - 可自定义样式
 *
 * 使用示例:
 * ```tsx
 * <ExtensionButton
 *   label="可视化选择集"
 *   description="在 Archicad 中高亮显示"
 *   extensionName="Example"
 *   available={example.available}
 *   onClick={handleClick}
 * />
 * ```
 */
export const ExtensionButton: React.FC<ExtensionButtonProps> = ({
  label,
  description,
  extensionName,
  available,
  loading = false,
  onClick,
  icon,
  variant = 'default',
  disabled = false,
  className = ''
}) => {
  // 计算实际可用状态
  const isEnabled = available && !disabled && !loading;

  // 样式变体
  const variantStyles = {
    default: {
      enabled: 'border-purple-500 bg-purple-50 hover:bg-purple-100 text-purple-700',
      disabled: 'border-gray-300 bg-gray-100 text-gray-500',
      icon: 'text-purple-600'
    },
    primary: {
      enabled: 'border-blue-500 bg-blue-50 hover:bg-blue-100 text-blue-700',
      disabled: 'border-gray-300 bg-gray-100 text-gray-500',
      icon: 'text-blue-600'
    },
    success: {
      enabled: 'border-green-500 bg-green-50 hover:bg-green-100 text-green-700',
      disabled: 'border-gray-300 bg-gray-100 text-gray-500',
      icon: 'text-green-600'
    }
  };

  const styles = variantStyles[variant];

  // 渲染图标
  const renderIcon = () => {
    if (loading) {
      return <Loader2 size={20} className="animate-spin text-gray-400" />;
    }

    if (icon) {
      return <div className={isEnabled ? styles.icon : 'text-gray-400'}>{icon}</div>;
    }

    return isEnabled ? (
      <Zap size={20} className={styles.icon} />
    ) : (
      <ZapOff size={20} className="text-gray-400" />
    );
  };

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={onClick}
        disabled={!isEnabled}
        className={`
          w-full px-4 py-3 rounded-lg border-2 transition-all
          ${isEnabled ? styles.enabled : styles.disabled}
          ${!isEnabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        `}
        title={!isEnabled && !loading ? `需要 ${extensionName}` : undefined}
      >
        <div className="flex items-center gap-3">
          {/* 图标 */}
          {renderIcon()}

          {/* 文本内容 */}
          <div className="flex-1 text-left">
            <div className={`font-medium ${isEnabled ? '' : 'text-gray-500'}`}>
              {label}
            </div>
            {description && (
              <div className="text-xs text-gray-500 mt-0.5">
                {description}
              </div>
            )}
          </div>

          {/* 状态标签 */}
          {!isEnabled && !loading && (
            <div className="text-xs px-2 py-1 bg-gray-200 rounded text-gray-600">
              需要 {extensionName}
            </div>
          )}
        </div>
      </button>

      {/* 不可用遮罩 */}
      {!isEnabled && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg backdrop-blur-[1px] pointer-events-none">
          <div className="text-xs font-medium text-gray-600 bg-white px-3 py-1 rounded-full border border-gray-300 shadow-sm">
            {extensionName} 未连接
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 简化版按钮 - 不显示遮罩层
 */
export const SimpleExtensionButton: React.FC<ExtensionButtonProps> = (props) => {
  const { available, loading, disabled, onClick, label, icon, variant = 'default', className = '' } = props;

  const isEnabled = available && !disabled && !loading;

  const variantClasses = {
    default: isEnabled
      ? 'bg-purple-500 hover:bg-purple-600 text-white'
      : 'bg-gray-300 text-gray-500 cursor-not-allowed',
    primary: isEnabled
      ? 'bg-blue-500 hover:bg-blue-600 text-white'
      : 'bg-gray-300 text-gray-500 cursor-not-allowed',
    success: isEnabled
      ? 'bg-green-500 hover:bg-green-600 text-white'
      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
  };

  return (
    <button
      onClick={onClick}
      disabled={!isEnabled}
      className={`
        px-4 py-2 rounded-lg font-medium transition-colors
        ${variantClasses[variant]}
        ${className}
      `}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span>加载中...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
      )}
    </button>
  );
};

/**
 * 扩展状态指示器
 */
interface ExtensionStatusBadgeProps {
  name: string;
  available: boolean;
  version?: string;
  loading?: boolean;
}

export const ExtensionStatusBadge: React.FC<ExtensionStatusBadgeProps> = ({
  name,
  available,
  version,
  loading
}) => {
  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <Loader2 size={12} className="animate-spin" />
        <span>检测中...</span>
      </div>
    );
  }

  if (available) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <div className="w-2 h-2 rounded-full bg-green-500"></div>
        <span>在线</span>
        {version && <span className="text-green-600">v{version}</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
      <span>离线</span>
    </div>
  );
};
