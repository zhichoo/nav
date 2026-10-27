import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sourceDropTarget } from "../src/source-drop.ts";
import { moveVisibleSources } from "../src/organization.ts";

const zones = [
  {id:"first",top:200,bottom:250,split:225},
  {id:"second",top:258,bottom:550,split:283},
  {id:"last",top:558,bottom:850,split:583},
];

test("source insertion includes the first edge, all gaps and the final edge", () => {
  for (const y of [188,199,200,220,225]) assert.deepEqual(sourceDropTarget(zones,y), {target:"first",position:"before"});
  assert.deepEqual(sourceDropTarget(zones,240), {target:"first",position:"after"});
  for (const y of [254,258,270]) assert.deepEqual(sourceDropTarget(zones,y), {target:"second",position:"before"});
  assert.deepEqual(sourceDropTarget(zones,400), {target:"second",position:"after"});
  assert.deepEqual(sourceDropTarget(zones,554), {target:"last",position:"before"});
  for (const y of [800,850,862]) assert.deepEqual(sourceDropTarget(zones,y), {target:"last",position:"after"});
  assert.equal(sourceDropTarget([],200), null);
});

test("leading and trailing targets reorder only the current category slots", () => {
  const order = ["unrelated","first","second","hidden","last"];
  const visible = ["first","second","last"];
  const leading = sourceDropTarget(zones,199);
  assert.deepEqual(moveVisibleSources(order,visible,"last",leading.target,leading.position), ["unrelated","last","first","hidden","second"]);
  const trailing = sourceDropTarget(zones,860);
  assert.deepEqual(moveVisibleSources(order,visible,"first",trailing.target,trailing.position), ["unrelated","second","last","hidden","first"]);
  assert.deepEqual(sourceDropTarget([{id:"only",top:200,bottom:250,split:225}],199), {target:"only",position:"before"});
});

test("source insertion markers stay inside open/closed summaries and ignored rows", async () => {
  const css = await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  const component = await readFile(new URL("../src/DragHandle.tsx",import.meta.url),"utf8");
  assert.match(css,/\.feed-section \{[^}]*position: relative/);
  assert.match(css,/\.ignored-row \{[^}]*position: relative/);
  assert.match(css,/\.feed-section\.drop-before > \.source-summary::after, \.ignored-row\.drop-before::after \{ top: 1px;/);
  assert.match(css,/\.feed-section\.drop-after > \.source-summary::after, \.ignored-row\.drop-after::after \{ bottom: 1px;/);
  assert.match(css,/pointer-events: none; z-index: 2/);
  assert.doesNotMatch(css,/box-shadow: 0 -?3px 0 var\(--accent\)/);
  assert.match(component,/sourceDropTarget\(zones, current.y\)/);
  assert.match(component,/!overToolbar \|\| first.top >=/);
});
