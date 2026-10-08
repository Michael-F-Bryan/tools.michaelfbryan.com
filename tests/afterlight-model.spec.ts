import {test} from '@playwright/test';
import assert from 'node:assert/strict';
import {random,addStar,connections,encode,decode,frequency,MAX_STARS, type Star} from '../src/entries/afterlight/model';

test('the background is reproducible and seed-specific',()=>{
  const a=random(42),b=random(42),c=random(43);
  const first=Array.from({length:100},a);
  assert.deepEqual(first,Array.from({length:100},b));
  assert.notDeepEqual(first,Array.from({length:100},c));
  assert.ok(first.every(x=>x>=0&&x<1));
});
test('planting spaces stars, clamps coordinates and rejects invalid input',()=>{
  const stars: Star[]=[];
  assert.equal(addStar(stars,.5,.5,1),true);
  assert.equal(addStar(stars,.51,.51,1),false);
  assert.equal(addStar(stars,Infinity,0,1),false);
  assert.equal(addStar(stars,NaN,0,1),false);
  assert.equal(addStar(stars,-1,2,2),true);
  assert.deepEqual(stars[1],{x:0,y:1,gesture:2});
});
test('the sky has a bounded capacity',()=>{
  const stars: Star[]=[];
  for(let x=0;x<10;x++) for(let y=0;y<10;y++) addStar(stars,x/10,y/10,1);
  assert.equal(stars.length,MAX_STARS);
  assert.equal(addStar(stars,.99,.99,2),false);
});
test('edges connect the closest predecessor without crossing empty expanses',()=>{
  const stars=[{x:.1,y:.1,gesture:1},{x:.2,y:.1,gesture:1},{x:.25,y:.15,gesture:1},{x:.9,y:.9,gesture:1}];
  assert.deepEqual(connections(stars),[[0,1],[1,2]]);
  assert.deepEqual(connections([]),[]);
});
test('share links preserve shape and undo groups to millimetre precision',()=>{
  const stars=[{x:.1234,y:.9999,gesture:1},{x:0,y:0,gesture:2}];
  assert.deepEqual(decode(encode(stars)),[{x:.123,y:1,gesture:1},{x:0,y:0,gesture:2}]);
  assert.deepEqual(decode(encode([])),[]);
});
test('full constellations fit in the link budget',()=>{
  const stars=Array.from({length:MAX_STARS},(_,i)=>({x:i/100,y:i/100,gesture:i+1}));
  assert.equal(decode(encode(stars)).length,MAX_STARS);
});
test('damaged, unsupported and oversized links are rejected',()=>{
  for(const link of ['v2.1,2,3','v1.a,2,3','v1.1001,2,3','v1.-1,2,3','v1.1,2,3,4','v1.1,,3','v1.1,2,99999','v1.'+'1,2,3;'.repeat(100)+'1,2,3','x'.repeat(2500)]) assert.throws(()=>decode(link));
});
test('height maps onto a bounded pentatonic register',()=>{
  assert.ok(Math.abs(frequency({y:1})-130.81278265)<.001);
  assert.ok(frequency({y:0})>frequency({y:1}));
  for(let i=0;i<=100;i++) assert.ok(Number.isFinite(frequency({y:i/100})));
});
