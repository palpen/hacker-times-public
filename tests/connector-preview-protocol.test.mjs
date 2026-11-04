import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationSchema, driverMessageSchema, grantsSchema, sessionOptionsSchema } from '../scripts/connector-preview/protocol.mjs';

test('preview invocation accepts bounded names and arbitrary JSON argument keys', () => {
  const input = {connectorId:'example',actionName:'read',arguments:{query:'news',count:2,nested:{ok:true},list:[1,null]}};
  assert.deepEqual(invocationSchema.parse(input), input);
  for (const value of [{...input,extra:true},{...input,connectorId:'bad/name'},{...input,arguments:[]},{...input,arguments:null}]) assert.equal(invocationSchema.safeParse(value).success,false);
});
test('preview driver envelopes remain strict with record results', () => {
  const input={jsonrpc:'2.0',id:'00000000-0000-4000-8000-000000000001',result:{content:[],structuredContent:{ok:true}}};
  assert.deepEqual(driverMessageSchema.parse(input),input);
  assert.equal(driverMessageSchema.safeParse({...input,extra:true}).success,false);
  assert.equal(driverMessageSchema.safeParse({...input,result:[]}).success,false);
  assert.deepEqual(driverMessageSchema.parse({jsonrpc:'2.0',method:'stop'}),{jsonrpc:'2.0',method:'stop'});
});
test('preview grants remain read-only and session limits stay bounded', () => {
  assert.equal(grantsSchema.safeParse([{connectorId:'example',actionName:'read',readOnly:false}]).success,false);
  assert.equal(sessionOptionsSchema.safeParse({timeoutMs:0}).success,false);
  assert.equal(sessionOptionsSchema.safeParse({lifetimeMs:2**31}).success,false);
  assert.equal(sessionOptionsSchema.parse({}).timeoutMs,120000);
});
