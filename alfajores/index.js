import { handleRequest } from './config.js';

addEventListener('fetch', event => {
  // In Cloudflare Workers, environment bindings are available as 'env', not 'event.env'
  event.respondWith(handleRequest(event.request, env));
});