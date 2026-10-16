import {test} from 'node:test';
import assert from 'node:assert/strict';
import {microphoneLevel,createMicrophoneMonitor} from '../src/microphoneMonitor.ts';

function fixture() {
  const frames=new Map(),readings=[],errors=[],connections=[];
  let sequence=0;
  const track={enabled:true,muted:false,readyState:'live',label:'Test microphone',stops:0,stop(){this.stops++;this.readyState='ended';}};
  const stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
  const analyser={fftSize:2048,getFloatTimeDomainData:samples=>samples.fill(.1),disconnects:0,disconnect(){this.disconnects++;}};
  const source={connect:node=>connections.push(node),disconnects:0,disconnect(){this.disconnects++;}};
  const context={state:'running',closes:0,destination:{},async resume(){this.state='running';},async close(){this.closes++;this.state='closed';},createMediaStreamSource:()=>source,createAnalyser:()=>analyser};
  let opened=0,fallbacks=0;
  const options={preferences:{input:'',noise:true},createContext:()=>context,openInput:async()=>{opened++;return {stream,usedDefault:false};},onReading:value=>readings.push(value),onError:error=>errors.push(error),onFallback:()=>fallbacks++,schedule:callback=>{const id=++sequence;frames.set(id,callback);return id;},cancel:id=>frames.delete(id)};
  return {track,stream,context,analyser,source,frames,readings,errors,connections,options,get opened(){return opened;},get fallbacks(){return fallbacks;},advance(time=100){const [id,callback]=frames.entries().next().value;frames.delete(id);callback(time);}};
}
test('silence and empty samples display zero without an infinite numeric label',()=>{
  for(const samples of [new Float32Array(0),new Float32Array(2048)])assert.deepEqual(microphoneLevel(samples),{percent:0,decibels:null,detected:false,clipping:false});
});
test('meter accurately measures the RMS of a known sine wave in dBFS',()=>{
  const samples=Float32Array.from({length:4096},(_,i)=>.1*Math.sin(2*Math.PI*i/64));
  const level=microphoneLevel(samples);
  assert.ok(Math.abs(level.decibels-(-23.0102999566))<.00001);assert.ok(Math.abs(level.percent-61.6495000723)<.0001);assert.equal(level.detected,true);assert.equal(level.clipping,false);
});
test('very low input stays dark and clipping/non-finite samples remain bounded',()=>{
  assert.equal(microphoneLevel(new Float32Array(2048).fill(.00001)).percent,0);
  const level=microphoneLevel(new Float32Array([1,-1,NaN,Infinity]));
  assert.equal(level.clipping,true);assert.ok(Number.isFinite(level.percent));assert.ok(level.percent<=100&&level.percent>=0);
});
test('stopping a standalone test releases capture and animation exactly once',async()=>{
  const f=fixture(),monitor=createMicrophoneMonitor(f.options);await monitor.ready;
  f.advance();assert.equal(f.readings[0].detected,true);assert.equal(f.readings[0].device,'Test microphone');
  assert.equal(f.connections[0],f.analyser);assert.equal(f.connections.includes(f.context.destination),false);
  monitor.stop();monitor.stop();assert.equal(f.track.stops,1);assert.equal(f.context.closes,1);assert.equal(f.frames.size,0);assert.equal(f.source.disconnects,1);
});
test('monitoring an existing call never opens or stops its microphone',async()=>{
  const f=fixture(),monitor=createMicrophoneMonitor({...f.options,activeStream:f.stream});await monitor.ready;
  assert.equal(f.opened,0);f.advance();monitor.stop();assert.equal(f.track.stops,0);assert.equal(f.context.closes,1);
});
test('a permission response arriving after cancellation releases its late stream',async()=>{
  const f=fixture();let complete;
  const capture=new Promise(resolve=>complete=resolve);
  const monitor=createMicrophoneMonitor({...f.options,openInput:()=>capture});monitor.stop();
  complete({stream:f.stream,usedDefault:false});await monitor.ready;
  assert.equal(f.track.stops,1);assert.equal(f.context.closes,1);assert.equal(f.connections.length,0);assert.equal(f.frames.size,0);assert.equal(f.readings.length,0);
});
test('permission rejection closes analysis resources and produces a diagnostic',async()=>{
  const f=fixture(),error=new DOMException('','NotAllowedError');
  const monitor=createMicrophoneMonitor({...f.options,openInput:async()=>{throw error;}});await monitor.ready;
  assert.equal(f.errors[0],error);assert.equal(f.context.closes,1);assert.equal(f.frames.size,0);
});
test('muted call tracks and suspended analysis show zero until resumed',async()=>{
  const f=fixture(),monitor=createMicrophoneMonitor({...f.options,activeStream:f.stream});await monitor.ready;
  f.track.enabled=false;f.advance(100);assert.equal(f.readings.at(-1).muted,true);assert.equal(f.readings.at(-1).percent,0);
  f.track.enabled=true;f.context.state='suspended';f.advance(200);assert.equal(f.readings.at(-1).paused,true);assert.equal(f.readings.at(-1).percent,0);
  await monitor.resume();f.advance(300);assert.equal(f.readings.at(-1).detected,true);monitor.stop();
});
test('expired input fallback is reported and disconnecting ends the test',async()=>{
  const f=fixture();const monitor=createMicrophoneMonitor({...f.options,openInput:async()=>({stream:f.stream,usedDefault:true})});await monitor.ready;
  assert.equal(f.fallbacks,1);f.track.readyState='ended';f.advance();assert.match(f.errors[0].message,/disconnected/);assert.equal(f.frames.size,0);assert.equal(f.context.closes,1);
});
