import test from "node:test";
import assert from "node:assert/strict";
import { SOURCES, parseSource, fetchSourceDetailed } from "../server/sources.mjs";
import { createFeedService } from "../server/feed-service.mjs";

const source = SOURCES.find(item => item.id === "nodeloc");
const topic = (id, extra = {}) => ({id,title:`Topic ${id}`,created_at:"2026-10-28T04:31:05.558Z",posts_count:6,reply_count:0,like_count:99,visible:true,can_read_topic:true,archetype:"regular",...extra});
const payload = (topics, filter = "hot") => ({topic_list:{filter,topics}});

test("NodeLoc uses the official hot list and links to /hot instead of latest RSS", () => {
  assert.equal(source.feed, "https://www.nodeloc.com/hot.json");
  assert.equal(source.home, "https://www.nodeloc.com/hot");
  assert.equal(source.kind, "nodeloc");
  assert.equal(source.category, "nomad");
});

test("official rank order survives normalization without ranking by date, replies or likes", () => {
  const articles = parseSource(source, payload([
    topic(8,{posts_count:96,like_count:17,image_url:"/uploads/example.png",tags:["VPS",{name:"AI"}]}),
    topic(2,{posts_count:5,like_count:63,created_at:"2026-10-28T05:00:00Z"}),topic(4),
  ]));
  assert.deepEqual(articles.map(item => item.title), ["Topic 8","Topic 2","Topic 4"]);
  assert.deepEqual(articles.map(item => item.comments), [95,4,5]);
  assert.ok(articles.every(item => item.points === null));
  assert.equal(articles[0].url,"https://www.nodeloc.com/t/8");
  assert.equal(articles[0].discussionUrl,articles[0].url);
  assert.equal(articles[0].image,"https://www.nodeloc.com/uploads/example.png");
  assert.equal(articles[0].publishedAt,"2026-10-28T04:31:05.558Z");
  assert.deepEqual(articles[0].tags,["VPS","AI"]);
});

test("malformed, deleted, invisible, private and duplicate topics cannot enter the hot feed", () => {
  const rows = [null,{},topic(-1),topic("2"),topic(0),topic(1,{deleted:true}),topic(2,{deleted_at:"2026-10-28"}),topic(3,{visible:false}),topic(4,{can_read_topic:false}),topic(5,{archetype:"private_message"}),topic(6,{title:""}),topic(7),topic(7),topic(8,{created_at:"invalid",posts_count:-1,image_url:"javascript:alert(1)",tags:[null,{},5]})];
  const articles = parseSource(source,payload(rows));
  assert.deepEqual(articles.map(item=>item.title),["Topic 7","Topic 8"]);
  assert.equal(articles[1].publishedAt,null);
  assert.equal(articles[1].comments,null);
  assert.equal(articles[1].image,null);
  assert.deepEqual(articles[1].tags,[]);
  assert.equal(parseSource(source,payload([topic(1,{posts_count:1})]))[0].comments,0);
  assert.equal(parseSource(source,payload(Array.from({length:30},(_,i)=>topic(i+1)))).length,24);
});

test("wrong lists and changed response schemas fail rather than silently showing newest topics", () => {
  for (const data of [null,[],{},payload([topic(1)],"latest"),payload([topic(1)],"top"),{topic_list:{filter:"hot"}},payload({})]) {
    assert.throws(()=>parseSource(source,data),/Invalid NodeLoc hot response/);
  }
});

test("hot collection retries the same official URL via proxy and never falls back to latest RSS", async () => {
  const urls=[];
  const result=await fetchSourceDetailed(source,{
    proxyUrl:"",fetcher:async url=>{urls.push(url);return {ok:false,status:403};},
    proxyFetcher:async url=>{urls.push(url);return {ok:true,json:async()=>payload([topic(1)])};},
  });
  assert.equal(result.transport,"proxy");
  assert.deepEqual(urls,[source.feed,source.feed]);
  assert.equal(result.articles.length,1);
  await assert.rejects(fetchSourceDetailed(source,{proxyUrl:"",fetcher:async()=>({ok:true,json:async()=>payload([])})}),error=>error.feedCode==="PARSE");
});

test("old latest cache is discarded and matching hot cache survives an upstream failure", async () => {
  const old={...source,feed:"https://www.nodeloc.com/latest.rss",kind:"rss",articles:[{title:"Old latest topic"}],updatedAt:"2026-10-28T00:00:00Z"};
  const changed=createFeedService({sources:[source],initial:[old]});
  assert.deepEqual(changed.snapshot()[0].articles,[]);
  assert.equal(changed.snapshot()[0].status,"loading");
  const articles=parseSource(source,payload([topic(1),topic(2)]));
  let fail=true;
  const service=createFeedService({sources:[source],initial:[{...source,articles,updatedAt:old.updatedAt}],fetcher:async()=>{
    if(fail)throw new Error("unavailable");
    return parseSource(source,payload([topic(3)]));
  }});
  await service.refresh();
  assert.equal(service.snapshot()[0].status,"stale");
  assert.deepEqual(service.snapshot()[0].articles,articles);
  fail=false;
  await service.refresh({force:true});
  assert.deepEqual(service.snapshot()[0].articles.map(item=>item.title),["Topic 3"]);
});
