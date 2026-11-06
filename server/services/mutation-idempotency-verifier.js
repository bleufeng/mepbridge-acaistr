/**
 * V19-EXEC-01: command-scoped outcome verification, never selection/count heuristics.
 * Production without a request-bound verifier stays UNKNOWN. Memory receipts and
 * current existence do not establish exactly-once execution or completed geometry.
 */
'use strict';
const { resolvePlanCommand } = require('./semantic-fidelity-gate');
const unknown = reason => ({ state: 'unknown', reason });
async function verifyMutationState(step, endpoint, context = {}) {
  if (!step) return unknown('步骤对象为空');
  // Injected internal verifier is trusted code, not a request field. Validate its
  // result so malformed output cannot fall through into a retry permission.
  if (typeof context.verifierHook === 'function') {
    try {
      const result = await context.verifierHook(step, endpoint, context);
      if (!result || !['absent', 'present', 'unknown'].includes(result.state)) return unknown('无效核验结果');
      return result;
    } catch (e) { return unknown('核验失败: ' + e.message); }
  }
  const command = resolvePlanCommand(step);
  const name = command.parameters?.addOnCommandId?.commandName || command.command;
  const params = command.parameters?.addOnCommandParameters || command.parameters || {};
  if (['DeleteElements', 'DeleteMepElements'].includes(name)) {
    // This read dependency must already be bound to the original dispatch's
    // instance/project identity. Never probe the mutable global/default endpoint.
    if (context.identityVerified !== true || typeof context.confirmAbsent !== 'function') return unknown('缺少同源目标身份及删除核验器');
    const guids = params.guids || (params.guid ? [params.guid] : []);
    if (!Array.isArray(guids) || !guids.length || guids.length > 500 || guids.some(g => typeof g !== 'string' || !g.trim())) return unknown('删除GUID列表无效');
    const unique = [...new Set(guids)];
    try {
      const states = [];
      for (const guid of unique) {
        const result = await context.confirmAbsent(endpoint, guid);
        if (!result || !['absent', 'present'].includes(result.state)) return unknown('删除批量存在未确证项');
        states.push(result.state);
      }
      if (states.every(state => state === 'absent')) return { state: 'present', reason: '全部目标确证已不存在，删除后置条件满足', adoptedData: { deletedGuids: unique } };
      // Mixed presence is partial/unknown; it is never safe to resend the whole batch.
      return unknown(states.every(state => state === 'present') ? '仍存在不能证明原请求已结束且未生效' : '删除部分生效，禁止整批重发');
    } catch (e) { return unknown('删除核验失败: ' + e.message); }
  }
  // A changed selection may be an unrelated edit; unchanged selection does not
  // prove a command was not accepted. No network call or auto-adoption here.
  return unknown('缺少同源命令级完成证据，禁止根据选择集或计数自动采纳／重发');
}
module.exports = { verifyMutationState };
