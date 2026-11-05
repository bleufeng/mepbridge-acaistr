// MACAI platform: explicit story-change capture; no automatic write on refresh.
import {workbenchFetch} from './execution-recovery';
type Preview = {ok:boolean;previewId:string;previewHash:string;targetPort:number;requestedStory:{index:number;name:string};previousStoryIndex:number;effect:string};
export async function fetchViewportSnapshot(targetPort: number | null, storyIndex: number | null | undefined,
  confirmChange: (preview: Preview) => boolean, request: typeof workbenchFetch = workbenchFetch) {
  if (!Number.isInteger(targetPort) || targetPort! < 19723 || targetPort! > 19743) throw Error('CAPTURE_EXPLICIT_TARGET_REQUIRED');
  if (storyIndex === null || storyIndex === undefined) {
    const response = await request('/api/plan-chain/capture?includeImage=true&maxElements=100&targetPort='+targetPort);
    const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||data.message||'CAPTURE_FAILED');
    if(data.targetPort!==targetPort||!Number.isInteger(data.storyIndex))throw Error('CAPTURE_TARGET_READBACK_MISMATCH');return data;
  }
  if (!Number.isInteger(storyIndex)) throw Error('CAPTURE_INVALID_STORY_INDEX');
  const response=await request('/api/plan-chain/capture/preview',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({targetPort,storyIndex,includeImage:true,maxElements:100})});
  const preview=await response.json();
  if(!response.ok||!preview.ok||preview.targetPort!==targetPort||preview.requestedStory?.index!==storyIndex||preview.effect!=='CHANGE_ACTIVE_STORY_AND_CAPTURE')throw Error(preview.error||'CAPTURE_PREVIEW_FAILED');
  if(!confirmChange(preview))return null;
  const captured=await request('/api/plan-chain/capture',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({previewId:preview.previewId,previewHash:preview.previewHash,targetPort,confirmRequired:true})});
  const data=await captured.json();if(!captured.ok||!data.ok)throw Error(data.error||data.message||'CAPTURE_FAILED');
  if(data.targetPort!==targetPort||data.storyIndex!==storyIndex||data.viewType!=='FloorPlan')throw Error('CAPTURE_TARGET_READBACK_MISMATCH');
  return data;
}
