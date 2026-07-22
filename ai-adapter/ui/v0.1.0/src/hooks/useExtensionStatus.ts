import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Extension 功能定义
 */
interface ExtensionFeature {
  id: string;
  name: string;
  description: string;
  category: string;
  commandType: 'query' | 'action';
}

/**
 * Extension 状态
 */
interface ExtensionStatus {
  available: boolean;
  version?: string;
  features: ExtensionFeature[];
  lastCheck?: number;
  error?: string;
}

/**
 * 所有扩展状态
 */
interface ExtensionsState {
  mepbridge: ExtensionStatus;
  [key: string]: ExtensionStatus;
}

/**
 * Hook 配置选项
 */
interface UseExtensionStatusOptions {
  /**
   * 自动刷新间隔（毫秒）
   * 默认: 30000 (30秒)
   * 设为 0 禁用自动刷新
   */
  refreshInterval?: number;

  /**
   * 是否在挂载时立即加载
   * 默认: true
   */
  immediate?: boolean;

  /**
   * 是否启用本地缓存
   * 默认: true (使用 sessionStorage)
   */
  enableCache?: boolean;

  /**
   * 缓存过期时间（毫秒）
   * 默认: 10000 (10秒)
   */
  cacheExpiry?: number;
}

/**
 * 缓存管理器（单例）
 */
class ExtensionStatusCache {
  private static instance: ExtensionStatusCache;
  private cache: ExtensionsState | null = null;
  private timestamp: number = 0;

  private constructor() {}

  static getInstance(): ExtensionStatusCache {
    if (!ExtensionStatusCache.instance) {
      ExtensionStatusCache.instance = new ExtensionStatusCache();
    }
    return ExtensionStatusCache.instance;
  }

  /**
   * 获取缓存
   */
  get(cacheExpiry: number): ExtensionsState | null {
    if (!this.cache) return null;

    const now = Date.now();
    if (now - this.timestamp > cacheExpiry) {
      // 缓存过期
      this.cache = null;
      return null;
    }

    return this.cache;
  }

  /**
   * 设置缓存
   */
  set(data: ExtensionsState): void {
    this.cache = data;
    this.timestamp = Date.now();
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache = null;
    this.timestamp = 0;
  }
}

/**
 * Extension Status Hook
 *
 * 使用示例:
 * ```tsx
 * const { extensions, loading, refresh } = useExtensionStatus({
 *   refreshInterval: 30000,  // 30秒自动刷新
 *   enableCache: true,       // 启用缓存
 *   cacheExpiry: 10000       // 10秒缓存过期
 * });
 *
 * if (extensions.mepbridge.available) {
 *   // MEPBridge 可用
 * }
 * ```
 */
export function useExtensionStatus(options: UseExtensionStatusOptions = {}) {
  const {
    refreshInterval = 30000,
    immediate = true,
    enableCache = true,
    cacheExpiry = 10000
  } = options;

  // 状态
  const [extensions, setExtensions] = useState<ExtensionsState>({
    mepbridge: { available: false, features: [] }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const cacheManager = useRef(ExtensionStatusCache.getInstance());

  /**
   * 从服务器获取状态
   */
  const fetchStatus = useCallback(async (useCache: boolean = true) => {
    try {
      // 检查缓存
      if (useCache && enableCache) {
        const cached = cacheManager.current.get(cacheExpiry);
        if (cached) {
          setExtensions(cached);
          setLoading(false);
          return;
        }
      }

      // 发起请求
      const res = await fetch('/api/extensions/status');
      const data = await res.json();

      if (data.ok && isMountedRef.current) {
        const newExtensions = data.extensions;

        // 更新状态
        setExtensions(newExtensions);
        setError(null);

        // 更新缓存
        if (enableCache) {
          cacheManager.current.set(newExtensions);
        }
      }
    } catch (err) {
      console.error('[useExtensionStatus] Fetch error:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [enableCache, cacheExpiry]);

  /**
   * 手动刷新（跳过缓存）
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchStatus(false); // 跳过缓存
  }, [fetchStatus]);

  /**
   * 清除缓存
   */
  const clearCache = useCallback(() => {
    cacheManager.current.clear();
  }, []);

  /**
   * 初始加载
   */
  useEffect(() => {
    if (immediate) {
      fetchStatus(true);
    }
  }, [immediate, fetchStatus]);

  /**
   * 自动刷新
   */
  useEffect(() => {
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        fetchStatus(true);
      }, refreshInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [refreshInterval, fetchStatus]);

  /**
   * 组件卸载清理
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    extensions,
    loading,
    error,
    refresh,
    clearCache
  };
}

/**
 * 轻量级 Hook - 只订阅指定插件
 * 避免不必要的状态更新
 *
 * 使用示例:
 * ```tsx
 * const mepbridge = useExtension('mepbridge');
 *
 * if (mepbridge.available) {
 *   // MEPBridge 可用
 * }
 * ```
 */
export function useExtension(name: string, options: UseExtensionStatusOptions = {}) {
  const { extensions, loading, error, refresh } = useExtensionStatus(options);

  const extension = extensions[name.toLowerCase()] || {
    available: false,
    features: []
  };

  return {
    ...extension,
    loading,
    error,
    refresh
  };
}
