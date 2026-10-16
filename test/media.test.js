import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openMicrophone,formatMicrophoneError} from '../src/media.ts';

const preferences={input:'',noise:true};
const stream={getTracks:()=>[]};
const failure=(name,extra={})=>Object.assign(new DOMException('',name),extra);

test('blank native microphone errors include their code and a recovery action',()=>{
  for(const name of ['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError','SecurityError','AbortError']){
    const text=formatMicrophoneError(failure(name));
    assert.ok(text.length>40);assert.ok(text.includes(`[${name}]`));
  }
  assert.match(formatMicrophoneError(failure('NotReadableError')),/PipeWire\/PulseAudio/);
  assert.match(formatMicrophoneError(failure('NotFoundError')),/System default/);
});
test('unknown or missing errors never produce an empty diagnostic',()=>{
  for(const error of [undefined,null,{},'',new Error('')])assert.ok(formatMicrophoneError(error).length>30);
  assert.match(formatMicrophoneError(new Error('native diagnostic')),/native diagnostic/);
});
test('system-default capture does not force a persisted device ID',async()=>{
  let constraints;
  const result=await openMicrophone(preferences,{getUserMedia:async value=>{constraints=value;return stream;}});
  assert.equal(result.stream,stream);assert.equal(result.usedDefault,false);
  assert.equal('deviceId' in constraints.audio,false);assert.equal(constraints.audio.echoCancellation,true);
});
test('an expired selected microphone ID retries with system default',async()=>{
  const calls=[];
  const result=await openMicrophone({...preferences,input:'expired-id'},{getUserMedia:async value=>{calls.push(value);if(calls.length===1)throw failure('OverconstrainedError',{constraint:'deviceId'});return stream;}});
  assert.equal(result.stream,stream);assert.equal(result.usedDefault,true);assert.equal(calls.length,2);
  assert.equal(calls[0].audio.deviceId.exact,'expired-id');assert.equal('deviceId' in calls[1].audio,false);
});
test('a disconnected microphone can recover to another available default input',async()=>{
  let calls=0;
  const result=await openMicrophone({...preferences,input:'unplugged'},{getUserMedia:async()=>{if(++calls===1)throw failure('NotFoundError');return stream;}});
  assert.equal(result.usedDefault,true);assert.equal(calls,2);
});
test('permission denial, busy devices and unrelated constraints never select another input',async()=>{
  for(const error of [failure('NotAllowedError'),failure('NotReadableError'),failure('OverconstrainedError',{constraint:'sampleRate'})]){
    let calls=0;
    await assert.rejects(openMicrophone({...preferences,input:'chosen'},{getUserMedia:async()=>{calls++;throw error;}}),e=>e===error);
    assert.equal(calls,1);
  }
});
test('default failures are not retried and failed recovery exposes the final audio error',async()=>{
  let calls=0;
  await assert.rejects(openMicrophone(preferences,{getUserMedia:async()=>{calls++;throw failure('NotFoundError');}}),{name:'NotFoundError'});
  assert.equal(calls,1);calls=0;
  await assert.rejects(openMicrophone({...preferences,input:'expired'},{getUserMedia:async()=>{throw failure(++calls===1?'NotFoundError':'NotReadableError');}}),{name:'NotReadableError'});
  assert.equal(calls,2);
});
test('unavailable capture API explains secure-context requirements',async()=>{
  await assert.rejects(openMicrophone(preferences,{}),error=>{
    assert.equal(error.name,'MediaDevicesUnavailable');assert.match(formatMicrophoneError(error),/HTTPS or localhost/);return true;
  });
});
test('changed origin device IDs recover by saved label and release the temporary default capture',async()=>{
  const calls=[];let stops=0;
  const probe={getTracks:()=>[{stop(){stops++;}}]};
  const recovered={getTracks:()=>[]};
  const result=await openMicrophone({...preferences,input:'old-id',inputLabel:'USB Microphone'},{
    getUserMedia:async constraints=>{calls.push(constraints);if(calls.length===1)throw failure('NotFoundError');return calls.length===2?probe:recovered;},
    enumerateDevices:async()=>[{kind:'audioinput',deviceId:'new-id',label:'USB Microphone'}],
  });
  assert.equal(result.stream,recovered);assert.equal(result.usedDefault,false);assert.equal(stops,1);assert.equal(calls[2].audio.deviceId.exact,'new-id');
});
