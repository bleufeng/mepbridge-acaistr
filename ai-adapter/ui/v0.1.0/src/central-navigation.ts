// MACAI platform navigation only; never changes execution permissions.
export const EXTENSION_ORDER = ['modules','knowledge','modelAudit','templates','commands','instances','buildingJson','cadLayers','settings'] as const;
export type ExtensionTab = typeof EXTENSION_ORDER[number];
export type SettingsSection = 'proactive' | 'memory' | 'preset' | 'audit';
export const PREVIEW_TABS = new Set<ExtensionTab>(['buildingJson','cadLayers']);
export function nextExtensionTab(current: ExtensionTab | null, requested: ExtensionTab): ExtensionTab | null {
  if (!EXTENSION_ORDER.includes(requested) || PREVIEW_TABS.has(requested)) return current;
  return current === requested ? null : requested;
}
