import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPeerSignaling} from '../src/signaling.ts';
import {selectAudioOutput,playbackError,syncPlaybackTracks} from '../src/playback.ts';
import {createShareAudio} from '../src/shareAudio.ts';

function peer() {
  return {
    signalingState:'stable',remoteDescription:null,localDescription:null,candidates:[],events:[],
    async setLocalDescription(){const type=this.signalingState==='have-remote-offer'?'answer':'offer';this.localDescription={type,sdp:type};this.signalingState=type==='answer'?'stable':'have-local-offer';this.events.push('local:'+type);},
    async setRemoteDescription(description){this.events.push('remote:'+description.type);this.remoteDescription=description;this.signalingState=description.type==='offer'?'have-remote-offer':'stable';},
    async addIceCandidate(candidate){assert.ok(this.remoteDescription);this.candidates.push(candidate);},
  };
}
test('responder attaches local media before answering and does not create an initial competing offer',async()=>{
  const pc=peer(),sent=[];
  const signal=createPeerSignaling(pc,true,data=>sent.push(data),async()=>pc.events.push('attach:local-media'),false);
  await signal.negotiate();assert.equal(sent.length,0);
  await signal.receive({description:{type:'offer',sdp:'offer'}});
  assert.deepEqual(pc.events,['remote:offer','attach:local-media','local:answer']);assert.equal(sent[0].description.type,'answer');
});
test('joining peer sends its offer and accepts the remote answer',async()=>{
  const pc=peer(),sent=[];
  const signal=createPeerSignaling(pc,false,data=>sent.push(data),async()=>{},true);
  await signal.negotiate();assert.equal(sent[0].description.type,'offer');
  await signal.receive({description:{type:'answer',sdp:'answer'}});assert.equal(pc.signalingState,'stable');
});
test('candidates arriving before a remote description are queued and then applied',async()=>{
  const pc=peer();const signal=createPeerSignaling(pc,true,()=>{},async()=>{},false);
  const candidate={candidate:'test-candidate'};await signal.receive({candidate});assert.equal(pc.candidates.length,0);
  await signal.receive({description:{type:'offer',sdp:'offer'}});assert.deepEqual(pc.candidates,[candidate]);
});
test('impolite peer ignores colliding offers and their candidates, then accepts the answer',async()=>{
  const pc=peer();const signal=createPeerSignaling(pc,false,()=>{},async()=>{},true);
  await signal.negotiate();await signal.receive({description:{type:'offer',sdp:'collision'}});await signal.receive({candidate:{candidate:'ignored'}});
  assert.equal(pc.remoteDescription,null);assert.equal(pc.candidates.length,0);
  await signal.receive({description:{type:'answer',sdp:'answer'}});await signal.receive({candidate:{candidate:'accepted'}});
  assert.equal(pc.candidates[0].candidate,'accepted');
});
test('polite peer accepts a colliding offer and prepares its answer',async()=>{
  const pc=peer(),sent=[];const signal=createPeerSignaling(pc,true,data=>sent.push(data),async()=>{},true);
  await signal.negotiate();await signal.receive({description:{type:'offer',sdp:'collision'}});
  assert.equal(pc.signalingState,'stable');assert.deepEqual(sent.map(data=>data.description.type),['offer','answer']);
});
test('an offer arriving while a remote answer is pending is processed after the answer',async()=>{
  const pc=peer();let release;const gate=new Promise(resolve=>release=resolve);
  const apply=pc.setRemoteDescription.bind(pc);
  pc.setRemoteDescription=async description=>{if(description.type==='answer')await gate;await apply(description);};
  const signal=createPeerSignaling(pc,false,()=>{},async()=>{},true);await signal.negotiate();
  const answer=signal.receive({description:{type:'answer',sdp:'answer'}});
  const offer=signal.receive({description:{type:'offer',sdp:'next-offer'}});
  release();await Promise.all([answer,offer]);
  assert.deepEqual(pc.events,['local:offer','remote:answer','remote:offer','local:answer']);
});
test('closing a peer cancels a pending answer and prevents later signals',async()=>{
  const pc=peer(),sent=[];let release;const gate=new Promise(resolve=>release=resolve);
  const signal=createPeerSignaling(pc,true,data=>sent.push(data),()=>gate,false);
  const pending=signal.receive({description:{type:'offer',sdp:'offer'}});await Promise.resolve();await Promise.resolve();
  signal.close();release();await pending;await signal.negotiate();await signal.receive({candidate:{candidate:'late'}});
  assert.equal(sent.length,0);assert.equal(pc.candidates.length,0);
});
test('a rejected signal does not prevent later valid messages from being handled',async()=>{
  const pc=peer();let first=true;const apply=pc.setRemoteDescription.bind(pc);
  pc.setRemoteDescription=async description=>{if(first){first=false;throw new Error('bad SDP');}await apply(description);};
  const signal=createPeerSignaling(pc,true,()=>{},async()=>{},false);
  await assert.rejects(signal.receive({description:{type:'offer',sdp:'bad'}}),/bad SDP/);
  await signal.receive({description:{type:'offer',sdp:'valid'}});assert.equal(pc.signalingState,'stable');
});
test('expired output device falls back to system default while denied output remains denied',async()=>{
  const calls=[];
  assert.equal(await selectAudioOutput({setSinkId:async id=>{calls.push(id);if(id)throw new DOMException('','NotFoundError');}},'expired-speaker'),true);
  assert.deepEqual(calls,['expired-speaker','']);
  let attempts=0;
  await assert.rejects(selectAudioOutput({setSinkId:async()=>{attempts++;throw new DOMException('','NotAllowedError');}},'speaker'),{name:'NotAllowedError'});
  assert.equal(attempts,1);
  assert.match(playbackError(new DOMException('','NotAllowedError')),/Play audio/);
});
class Stream {
  tracks=[];
  getTracks(){return [...this.tracks];}
  addTrack(track){this.tracks.push(track);}
  removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}
}
test('camera/screen changes preserve the audible track and preview never plays local audio',()=>{
  const audio=new Stream(),video=new Stream();
  const mic={kind:'audio',readyState:'live'},camera={kind:'video',readyState:'live'},screen={kind:'video',readyState:'live'};
  syncPlaybackTracks(audio,video,[mic,camera]);assert.deepEqual(audio.getTracks(),[mic]);assert.deepEqual(video.getTracks(),[camera]);
  syncPlaybackTracks(audio,video,[mic,screen]);assert.deepEqual(audio.getTracks(),[mic]);assert.deepEqual(video.getTracks(),[screen]);
  syncPlaybackTracks(audio,video,[mic]);assert.deepEqual(audio.getTracks(),[mic]);assert.equal(video.getTracks().length,0);
  syncPlaybackTracks(audio,video,[mic,camera],true);assert.equal(audio.getTracks().length,0);
  camera.readyState='ended';syncPlaybackTracks(audio,video,[mic,camera]);assert.deepEqual(audio.getTracks(),[mic]);assert.equal(video.getTracks().length,0);
});

// Exercise the real mixer with a small Web Audio graph double. Each source reads
// its track's current enabled flag, like a live MediaStreamAudioSourceNode.
function mixerFixture() {
  const mic={enabled:true,readyState:'live',value:.2,stops:0,stop(){this.stops++;}},system={enabled:true,readyState:'live',value:.4,stops:0,stop(){this.stops++;}};
  const stream=track=>({getAudioTracks:()=>[track],getTracks:()=>[track]});
  const generated={stops:0,stop(){this.stops++;}},sources=[];
  const destination={stream:stream(generated),channelCount:2};
  const context={state:'suspended',closes:0,destination:{speakers:true},createMediaStreamDestination:()=>destination,
    createMediaStreamSource(input){const source={input,target:null,connect(target){this.target=target;},disconnect(){this.target=null;}};sources.push(source);return source;},
    async resume(){this.state='running';},async close(){this.closes++;this.state='closed';}};
  const mixer=createShareAudio(stream(mic),context);
  const sample=()=>sources.filter(s=>s.target===destination).reduce((sum,s)=>sum+s.input.getAudioTracks().reduce((n,t)=>n+(t.enabled?t.value:0),0),0);
  return {mic,system,stream,generated,sources,destination,context,mixer,sample};
}
test('share audio mixes microphone and system sound into one sender without local playback',async()=>{
  const f=mixerFixture();await f.mixer.resume();f.mixer.setScreen(f.stream(f.system));
  assert.ok(Math.abs(f.sample()-.6)<1e-10);assert.equal(f.mixer.track,f.generated);
  assert.equal(f.destination.channelCount,1);assert.ok(f.sources.every(s=>s.target!==f.context.destination));f.mixer.close();
});
test('mute and push-to-talk gate microphone without muting shared sound',()=>{
  const f=mixerFixture();f.mixer.setScreen(f.stream(f.system));f.mic.enabled=false;
  assert.equal(f.sample(),.4);assert.equal(f.system.enabled,true);
  f.mic.enabled=true;assert.ok(Math.abs(f.sample()-.6)<1e-10);f.mixer.close();
});
test('stopping and restarting sharing disconnects old capture and preserves voice',()=>{
  const f=mixerFixture();f.mixer.setScreen(f.stream(f.system));const old=f.sources.at(-1);
  f.mixer.setScreen(null);assert.equal(old.target,null);assert.equal(f.sample(),.2);
  f.mixer.setScreen(f.stream(f.system));assert.ok(Math.abs(f.sample()-.6)<1e-10);
  assert.equal(f.mic.stops,0);assert.equal(f.system.stops,0);f.mixer.close();
});
test('closing the mixer stops only its generated track and is idempotent',()=>{
  const f=mixerFixture();f.mixer.setScreen(f.stream(f.system));f.mixer.close();f.mixer.close();
  assert.equal(f.generated.stops,1);assert.equal(f.context.closes,1);assert.equal(f.mic.stops,0);assert.equal(f.system.stops,0);
  assert.ok(f.sources.every(s=>s.target===null));f.mixer.setScreen(f.stream(f.system));assert.equal(f.sources.length,2);
});
test('missing or ended system tracks do not replace the microphone source',()=>{
  const f=mixerFixture();f.system.readyState='ended';f.mixer.setScreen(f.stream(f.system));
  f.mixer.setScreen({getAudioTracks:()=>[]});assert.equal(f.sources.length,1);assert.equal(f.sample(),.2);f.mixer.close();
});
test('a suspended or cancelled mixer cannot silently report successful startup',async()=>{
  const f=mixerFixture();f.context.resume=async()=>{};await assert.rejects(f.mixer.resume(),/paused/);
  f.mixer.close();f.context.resume=async()=>{f.context.state='running';};await assert.rejects(f.mixer.resume(),/paused/);
});
