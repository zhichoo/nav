// Local Undici proxy sockets are deliberately excluded from the Workers bundle.
export class ProxyAgent {
  constructor() { throw new Error("HTTP proxy dispatchers are unavailable on Workers"); }
}
