import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  operationType: "move" | "modify-properties" | "mutation";
  affectedElementCount: number;
  details?: {
    deltaMm?: { x: number; y: number; z: number };
    propertyChanges?: Array<{
      propertyName: string;
      before?: any;
      after: any;
    }>;
    dryRunResult?: any;
  };
  language?: "zh-CN" | "en-US";
}

const translations = {
  "zh-CN": {
    confirmTitle: "确认操作",
    cancelButton: "取消",
    confirmButton: "批准执行",
    affectedElements: "影响的构件数",
    operationDetails: "操作详情",
    moveOperation: "移动构件",
    modifyPropertiesOperation: "修改属性",
    mutationOperation: "变更操作",
    displacement: "位移量",
    propertyChanges: "属性变化",
    dryRunPreview: "Dry-run 预览",
    warningMessage: "此操作将修改 Archicad 模型，请仔细检查后确认。"
  },
  "en-US": {
    confirmTitle: "Confirm Operation",
    cancelButton: "Cancel",
    confirmButton: "Approve & Execute",
    affectedElements: "Affected Elements",
    operationDetails: "Operation Details",
    moveOperation: "Move Elements",
    modifyPropertiesOperation: "Modify Properties",
    mutationOperation: "Mutation Operation",
    displacement: "Displacement",
    propertyChanges: "Property Changes",
    dryRunPreview: "Dry-run Preview",
    warningMessage: "This operation will modify the Archicad model. Please review carefully before confirming."
  }
};

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onCancel,
  title,
  message,
  operationType,
  affectedElementCount,
  details,
  language = "zh-CN"
}) => {
  const t = translations[language];

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  const getOperationTypeLabel = () => {
    switch (operationType) {
      case "move":
        return t.moveOperation;
      case "modify-properties":
        return t.modifyPropertiesOperation;
      default:
        return t.mutationOperation;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleCancel}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 max-w-2xl w-full max-h-[80vh] overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-orange-500/10">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-400" />
                  <h2 className="text-xl font-semibold text-white">
                    {title || t.confirmTitle}
                  </h2>
                </div>
                <button
                  onClick={handleCancel}
                  className="p-1 hover:bg-slate-700/50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-6 space-y-6 overflow-y-auto max-h-[60vh]">
                {/* Warning Message */}
                <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-100/90">
                    {t.warningMessage}
                  </p>
                </div>

                {/* Message */}
                {message && (
                  <div className="text-slate-300 text-base">
                    {message}
                  </div>
                )}

                {/* Summary */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                    <div className="text-xs text-slate-400 mb-1">
                      {t.operationDetails}
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {getOperationTypeLabel()}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                    <div className="text-xs text-slate-400 mb-1">
                      {t.affectedElements}
                    </div>
                    <div className="text-lg font-semibold text-cyan-400">
                      {affectedElementCount}
                    </div>
                  </div>
                </div>

                {/* Details */}
                {details && (
                  <div className="space-y-4">
                    {/* Move Operation Details */}
                    {operationType === "move" && details.deltaMm && (
                      <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="text-sm font-medium text-slate-300 mb-3">
                          {t.displacement}
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-slate-400">X: </span>
                            <span className="text-cyan-400 font-mono">
                              {details.deltaMm.x > 0 ? "+" : ""}
                              {details.deltaMm.x.toFixed(1)} mm
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Y: </span>
                            <span className="text-cyan-400 font-mono">
                              {details.deltaMm.y > 0 ? "+" : ""}
                              {details.deltaMm.y.toFixed(1)} mm
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Z: </span>
                            <span className="text-cyan-400 font-mono">
                              {details.deltaMm.z > 0 ? "+" : ""}
                              {details.deltaMm.z.toFixed(1)} mm
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Property Changes */}
                    {operationType === "modify-properties" && details.propertyChanges && (
                      <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="text-sm font-medium text-slate-300 mb-3">
                          {t.propertyChanges}
                        </div>
                        <div className="space-y-2">
                          {details.propertyChanges.map((change, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-3 text-sm p-2 bg-slate-900/50 rounded-lg"
                            >
                              <div className="font-medium text-slate-300 min-w-[120px]">
                                {change.propertyName}
                              </div>
                              <div className="flex items-center gap-2 flex-1">
                                {change.before !== undefined && (
                                  <>
                                    <span className="text-slate-500 font-mono text-xs">
                                      {String(change.before)}
                                    </span>
                                    <span className="text-slate-600">→</span>
                                  </>
                                )}
                                <span className="text-cyan-400 font-mono text-xs font-semibold">
                                  {String(change.after)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Dry-run Result */}
                    {details.dryRunResult && (
                      <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        <div className="text-sm font-medium text-slate-300 mb-3">
                          {t.dryRunPreview}
                        </div>
                        <pre className="text-xs text-slate-400 font-mono overflow-x-auto">
                          {JSON.stringify(details.dryRunResult, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-700/50 flex items-center justify-end gap-3 bg-slate-900/50">
                <button
                  onClick={handleCancel}
                  className="px-5 py-2.5 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-medium transition-all duration-200 border border-slate-600/50"
                >
                  {t.cancelButton}
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold shadow-lg shadow-cyan-500/20 transition-all duration-200 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {t.confirmButton}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ConfirmationDialog;
