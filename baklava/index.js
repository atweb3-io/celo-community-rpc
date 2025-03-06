import { handleRequest } from './config.js';

addEventListener('fetch', event => {
  // Pass env and ctx directly to handleRequest like in health-check-worker
  event.respondWith(handleRequest(event.request, event.env, event.ctx));
});