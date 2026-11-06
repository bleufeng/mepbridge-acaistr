// SPDX-License-Identifier: MIT
'use strict';
// Roof snapshot adapter. Pure data validation, never reads or writes a model.
const TOLERANCE = 0.0001;
function point(p) { return p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y); }
function equal(a,b) { return point(a) && point(b) && Math.abs(a.x-b.x)<=TOLERANCE && Math.abs(a.y-b.y)<=TOLERANCE; }
function ring(input) {
  if (!Array.isArray(input) || input.length<3 || input.length>4097 || !input.every(point)) return null;
  const result=input.map(p=>({x:p.x,y:p.y}));
  if(equal(result[0],result[result.length-1]))result.pop();
  if(result.length<3)return null;
  return result;
}
function boundary(g) {
  if (!g || g.supported === false || g.roofClass!=='PlaneRoof' || g.coordinateSystem!=='model' || g.polygonCollectionStatus!=='ok' || g.boundaryRepresentation!=='linear-rings-v1') throw Error('ROOF_BOUNDARY_RECAPTURE_REQUIRED');
  if (!Array.isArray(g.holes) || g.holes.length>500 || g.holeCount!==g.holes.length) throw Error('ROOF_HOLE_COLLECTION_INCOMPLETE');
  const outer=ring(g.polygon), holes=g.holes.map(h=>ring(h?.vertices));
  if (!outer || holes.some(h=>!h) || outer.length+holes.reduce((n,h)=>n+h.length,0)>4096) throw Error('ROOF_BOUNDARY_INVALID_OR_OVER_BUDGET');
  return {outer,holes};
}
function sameRing(a,b) {
  if(a.length!==b.length)return false;
  for(let start=0;start<b.length;start++) {
    if(!equal(a[0],b[start]))continue;
    if(a.every((p,i)=>equal(p,b[(start+i)%b.length])) || a.every((p,i)=>equal(p,b[(start+b.length-i)%b.length])))return true;
  }
  return false;
}
function sameBoundary(expected,actual) {
  let a,b;try {a=boundary(expected);b=boundary(actual);}catch(_){return false;}
  if(!sameRing(a.outer,b.outer)||a.holes.length!==b.holes.length)return false;
  const unused=new Set(b.holes.map((_,i)=>i));
  for(const hole of a.holes){const index=[...unused].find(i=>sameRing(hole,b.holes[i]));if(index===undefined)return false;unused.delete(index);}
  return true;
}
module.exports={boundary,sameBoundary};
