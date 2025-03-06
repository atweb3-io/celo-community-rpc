import { handleRequest } from './config.js';

// Use the same pattern as the health-check-worker
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};