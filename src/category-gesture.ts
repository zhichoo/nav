type Point = { x: number; y: number };
type Clock = { set: (callback: () => void, delay: number) => unknown; clear: (timer: unknown) => void };
type Callbacks = { onStart: () => void; onMove: (point: Point) => void; onEnd: (cancelled: boolean) => void };
const browserClock: Clock = {
  set: (callback, delay) => globalThis.setTimeout(callback, delay),
  clear: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function createCategoryGesture(callbacks: Callbacks, clock: Clock = browserClock) {
  let session: { origin: Point; point: Point; touch: boolean; active: boolean } | null = null;
  let timer: unknown;
  let suppressClick = false;
  function clearTimer() { if (timer !== undefined) clock.clear(timer); timer = undefined; }
  function activate() {
    if (!session || session.active) return;
    session.active = true;
    suppressClick = true;
    callbacks.onStart();
    callbacks.onMove(session.point);
  }
  function finish(cancelled = false) {
    clearTimer();
    const current = session;
    session = null;
    if (current?.active) callbacks.onEnd(cancelled);
    if (cancelled && current) suppressClick = true;
    return Boolean(current?.active);
  }
  return {
    start(point: Point, touch: boolean) {
      finish(true);
      suppressClick = false;
      session = { origin: point, point, touch, active: false };
      if (touch) timer = clock.set(() => { timer = undefined; activate(); }, 350);
    },
    move(point: Point) {
      if (!session) return false;
      session.point = point;
      const distance = Math.hypot(point.x - session.origin.x, point.y - session.origin.y);
      if (!session.active && distance >= 8) {
        // Before the hold completes, movement belongs to native page scrolling.
        if (session.touch) { finish(true); return false; }
        activate();
      } else if (session.active) callbacks.onMove(point);
      return Boolean(session?.active);
    },
    finish,
    isTracking: () => session !== null,
    consumeClick() { const suppressed = suppressClick; suppressClick = false; return suppressed; },
  };
}
