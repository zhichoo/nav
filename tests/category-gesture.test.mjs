import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCategoryGesture } from "../src/category-gesture.ts";

function fixture() {
  let now = 0, sequence = 0;
  const tasks = new Map(), events = [];
  const gesture = createCategoryGesture({
    onStart: () => events.push("start"),
    onMove: point => events.push(["move", point]),
    onEnd: cancelled => events.push(["end", cancelled]),
  }, {
    set: (callback, delay) => { const id = ++sequence; tasks.set(id, { callback, at: now + delay }); return id; },
    clear: id => tasks.delete(id),
  });
  return { gesture, events, tasks, advance(ms) {
    now += ms;
    for (const [id, task] of tasks) if (task.at <= now) { tasks.delete(id); task.callback(); }
  } };
}
const point = (x, y = 0) => ({ x, y });

test("mouse tap and sub-threshold movement remain ordinary category clicks", () => {
  const { gesture, events } = fixture();
  gesture.start(point(20, 20), false);
  assert.equal(gesture.move(point(25, 22)), false);
  assert.equal(gesture.finish(), false);
  assert.equal(gesture.consumeClick(), false);
  assert.deepEqual(events, []);
});

test("mouse dragging starts at 8px and suppresses only the following pointer click", () => {
  const { gesture, events } = fixture();
  gesture.start(point(20), false);
  assert.equal(gesture.move(point(28)), true);
  assert.equal(gesture.move(point(60)), true);
  assert.equal(gesture.finish(), true);
  assert.deepEqual(events, ["start", ["move", point(28)], ["move", point(60)], ["end", false]]);
  assert.equal(gesture.consumeClick(), true);
  assert.equal(gesture.consumeClick(), false);
  gesture.start(point(20), false);
  gesture.finish();
  assert.equal(gesture.consumeClick(), false);
});

test("quick touch tap selects without starting a drag or leaving a timer", () => {
  const { gesture, events, advance, tasks } = fixture();
  gesture.start(point(10), true);
  advance(349);
  assert.equal(gesture.finish(), false);
  advance(500);
  assert.deepEqual(events, []);
  assert.equal(tasks.size, 0);
  assert.equal(gesture.consumeClick(), false);
});

test("stationary touch activates only after the 350ms hold", () => {
  const { gesture, events, advance } = fixture();
  gesture.start(point(10), true);
  gesture.move(point(13));
  advance(349);
  assert.deepEqual(events, []);
  advance(1);
  assert.deepEqual(events, ["start", ["move", point(13)]]);
  assert.equal(gesture.move(point(80, 30)), true);
  gesture.finish();
  assert.deepEqual(events.at(-1), ["end", false]);
  assert.equal(gesture.consumeClick(), true);
});

test("touch movement before the hold belongs to native scrolling, with no late activation", () => {
  const { gesture, events, advance, tasks } = fixture();
  gesture.start(point(10), true);
  assert.equal(gesture.move(point(10, 8)), false);
  assert.equal(gesture.isTracking(), false);
  advance(1000);
  assert.equal(gesture.move(point(80)), false);
  assert.equal(gesture.finish(), false);
  assert.deepEqual(events, []);
  assert.equal(tasks.size, 0);
  assert.equal(gesture.consumeClick(), true);
});

test("Escape, cancellation, scrolling or unmount can cancel pending and active gestures", () => {
  for (const touch of [true, false]) {
    const { gesture, events, advance } = fixture();
    gesture.start(point(0), touch);
    gesture.finish(true);
    advance(500);
    assert.deepEqual(events, []);
    gesture.start(point(0), touch);
    if (touch) advance(350); else gesture.move(point(8));
    assert.equal(gesture.finish(true), true);
    assert.deepEqual(events.at(-1), ["end", true]);
    const count = events.length;
    gesture.finish(true);
    advance(500);
    assert.equal(events.length, count);
    assert.equal(gesture.consumeClick(), true);
  }
});

test("starting a new interaction clears old suppression and timers", () => {
  const { gesture, events, advance } = fixture();
  gesture.start(point(0), true);
  gesture.start(point(20), false);
  advance(1000);
  assert.deepEqual(events, []);
  gesture.finish();
  assert.equal(gesture.consumeClick(), false);
});

test("each category is one native button, with fixed ends and keyboard reordering", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const component = await read("src/CategoryTab.tsx");
  const app = await read("src/App.tsx");
  const css = await read("src/styles.css");
  const categories = app.slice(app.indexOf('<nav className="category-tabs"'), app.indexOf('<div className="reading-controls"'));
  assert.match(categories, /<CategoryTab/);
  assert.doesNotMatch(categories, /<DragHandle|<button/);
  assert.equal((component.match(/<button\b/g) || []).length, 1);
  assert.match(component, /id !== "all" && id !== "ignored"/);
  assert.match(component, /event.detail > 0 && gesture.consumeClick/);
  assert.match(component, /event.altKey/);
  assert.match(component, /Alt\+ArrowLeft Alt\+ArrowRight/);
  assert.match(component, /addEventListener\("touchmove", touchMove, \{ passive: false \}\)/);
  assert.match(component, /if \(gesture.move[\s\S]*event.preventDefault/);
  assert.match(component, /removeEventListener\("touchmove", touchMove\)/);
  assert.match(component, /addEventListener\("scroll", cancel/);
  assert.match(component, /event.key === "Escape"/);
  assert.match(css, /touch-action: pan-y pinch-zoom/);
  assert.doesNotMatch(css, /category-chip > button|category-tabs \.drag-handle/);
});
