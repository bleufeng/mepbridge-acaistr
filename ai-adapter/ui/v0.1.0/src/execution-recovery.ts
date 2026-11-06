// MACAI platform: durable operation IDs retained before outbound dispatch. No automatic retries.
export type OperationRecord = { operationId: string; action: string; createdAt: string; status: string };
const STORAGE_KEY = 'mepbridge-execution-recovery-v1';
const volatileRecords = new Map<string, OperationRecord>();
function validRows(rows: unknown): rows is OperationRecord[] {
  return Array.isArray(rows) && rows.length <= 200 && rows.every(r => /^[a-f0-9]{64}$/.test(r?.operationId || '') && typeof r.status === 'string');
}
export function recoveryRecords(): OperationRecord[] {
  let persistent: OperationRecord[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const rows = JSON.parse(raw);
      if (validRows(rows)) persistent = rows;
    }
  } catch (_) { /* server receipt + volatile ID remain authoritative */ }
  const merged = new Map(persistent.map(row => [row.operationId, row]));
  for (const row of volatileRecords.values()) merged.set(row.operationId, row);
  return [...merged.values()].slice(-200);
}
function saveRecord(record: OperationRecord) {
  volatileRecords.set(record.operationId, record); // retained before dispatch even when storage is unavailable
  let rows = recoveryRecords().filter(r => r.operationId !== record.operationId);
  if (rows.length >= 200) {
    const completedIdx = rows.findIndex(r => r.status === 'COMPLETED');
    if (completedIdx !== -1) rows.splice(completedIdx, 1);
    else rows = rows.slice(rows.length - 199);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...rows, record]));
  window.dispatchEvent(new Event('mepbridge-execution-recovery'));
}
export async function queryOperation(operationId: string) {
  if (!/^[a-f0-9]{64}$/.test(operationId)) throw Error('EXEC_INVALID_OPERATION_ID');
  const response = await window.fetch(`/api/execute/operations/${operationId}`);
  const data = await response.json();
  if (!response.ok || !data.ok) throw Error(data.error || 'EXEC_QUERY_FAILED');
  const previous = recoveryRecords().find(r => r.operationId === operationId);
  if (previous) saveRecord({...previous,status:data.execution.status});
  return data.execution;
}
export async function workbenchFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if ((input !== '/api/execute' && input !== '/api/execute-step' && input !== '/api/snapshot-replay/apply' && input !== '/api/plan-chain/capture' && !(typeof input==='string' && /^\/api\/model-audit\/[a-f0-9]{64}\/runs\/[a-f0-9-]{36}\/locate$/.test(input))) || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') return window.fetch(input, init);
  const body = JSON.parse(init.body);
  if(input === '/api/snapshot-replay/apply' && body.dryRun === true)return window.fetch(input,init);
  const namedCommand = typeof body.command === 'string' ? body.command : body.commandName || body.action;
  const command = body.command?.command || body.commandJson?.command || (typeof namedCommand === 'string' && namedCommand.startsWith('API.') ? namedCommand : undefined);
  // Guarded Graphisoft property-write protocol remains a separate authorization path.
  if (typeof command === 'string' && command !== 'API.ExecuteAddOnCommand') return window.fetch(input,init);
  const action = (input === '/api/snapshot-replay/apply' ? 'SnapshotReplay' : input === '/api/plan-chain/capture' ? 'ViewportStoryCapture' : typeof input==='string' && input.endsWith('/locate') ? 'ModelAuditLocate' : null) || body.commandName || body.action || body.command?.parameters?.addOnCommandId?.commandName || body.commandJson?.parameters?.addOnCommandId?.commandName || body.params?.addOnCommandId?.commandName || (typeof body.command === 'string' ? body.command : 'Command');
  if (body.execution !== undefined) {
    const protocol = body.execution;
    if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol) || Object.keys(protocol).some(key => key !== 'operationId')) throw Error('EXEC_INVALID_PROTOCOL');
    if (typeof protocol.operationId !== 'string' || !/^[a-f0-9]{64}$/.test(protocol.operationId)) throw Error('EXEC_INVALID_OPERATION_ID');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const operationId = body.execution?.operationId || Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const record = {operationId,action,createdAt:new Date().toISOString(),status:'PENDING'};
  saveRecord(record); // failure here prevents dispatch rather than losing recovery identity
  try {
    const response = await window.fetch(input,{...init,body:JSON.stringify({...body,execution:{operationId}})});
    const data = await response.clone().json();
    if ((data.ok || data.success) && !data.execution) {
      volatileRecords.delete(operationId);
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify(recoveryRecords().filter(r=>r.operationId!==operationId))); } catch (_) { /* no execution blocker */ }
      window.dispatchEvent(new Event('mepbridge-execution-recovery'));
    } else saveRecord({...record,status:data.execution?.status || 'UNKNOWN'});
    return response;
  } catch (error: any) {
    try { saveRecord({...record,status:'UNKNOWN'}); } catch (_) { /* initial ID remains retained */ }
    throw Error(`${error.message}; operationId=${operationId}; UNKNOWN — query status before another write`);
  }
}
