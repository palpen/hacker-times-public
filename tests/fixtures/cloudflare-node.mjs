// Reader fixtures bundle the production entrypoint in Node. Workerd tests use
// Cloudflare's real WorkerEntrypoint implementation instead of this stub.
export const cloudflareNode={
 name:'cloudflare-node-fixture',
 setup(build){
  build.onResolve({filter:/^cloudflare:workers$/},args=>({path:args.path,namespace:'cloudflare-fixture'}));
  build.onLoad({filter:/.*/,namespace:'cloudflare-fixture'},()=>({contents:'export class WorkerEntrypoint {}'}));
 },
};
