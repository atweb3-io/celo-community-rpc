import { handleRequest } from './config.js';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.env));
});