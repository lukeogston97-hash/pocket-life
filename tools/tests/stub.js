// Stands in for 'cloudflare:workers' when the server runs on this computer for tests.
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
