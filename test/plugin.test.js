const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPlugin } = require("./harness/sandbox");
const { makeHost } = require("./harness/host");
const { PORTISHEAD_ASSETS, result, asset } = require("./fixtures");

function setup(page) {
  const plugin = loadPlugin();
  const host = makeHost({ page });
  plugin.activate(host.api);
  return { plugin, host };
}

const okPage = (assets, extra) => () => ({ type: "getty-result", data: result(assets, extra) });

// ---------------------------------------------------------------------------
// The probe script, run against a fake page
// ---------------------------------------------------------------------------
function runProbe(script, page) {
  const sent = [];
  const window = { __viboplr: { send: (type, data) => sent.push({ type, data }) } };
  const document = {
    title: page.title || "",
    readyState: page.readyState || "complete",
    body: { innerText: page.text || "" },
    querySelector(sel) {
      if (sel.indexOf("data-component") !== -1) return page.json === undefined ? null : { textContent: page.json };
      if (sel.indexOf("/detail/") !== -1) return page.hasLinks ? {} : null;
      return null;
    },
  };
  const location = { hostname: "hostname" in page ? page.hostname : "www.gettyimages.com", href: "https://www.gettyimages.com/x" };
  new Function("window", "document", "location", script)(window, document, location);
  return sent;
}

test("probe: reads search.gallery from the page's Search data", () => {
  const plugin = loadPlugin();
  const json = JSON.stringify({ search: { gallery: { counts: { images: 1076 }, page: 1, lastPage: 18, assets: PORTISHEAD_ASSETS.slice(0, 2) } } });
  const sent = runProbe(plugin._probeScript, { title: "Portishead - Getty Images", json, hostname: "www.gettyimages.at" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "getty-result");
  assert.equal(sent[0].data.total, 1076);
  assert.equal(sent[0].data.host, "www.gettyimages.at");
  assert.equal(sent[0].data.assets[0].id, "480270124");
  assert.equal(sent[0].data.assets[0].artist, "Edu Hawkins");
  assert.match(sent[0].data.assets[0].thumbUrl, /SIGNATURE1/);
});

test("probe: a Cloudflare block and a Cloudflare check are told apart", () => {
  const plugin = loadPlugin();
  assert.equal(runProbe(plugin._probeScript, { title: "Attention Required! | Cloudflare" })[0].type, "getty-blocked");
  assert.equal(runProbe(plugin._probeScript, { title: "Just a moment..." })[0].type, "getty-challenge");
});

test("probe: says nothing while the page is still loading", () => {
  const plugin = loadPlugin();
  assert.deepEqual(runProbe(plugin._probeScript, { readyState: "interactive" }), []);
  assert.deepEqual(runProbe(plugin._probeScript, { hostname: "" }), []);
});

test("probe: a loaded Getty page without the data is unreadable, not empty", () => {
  const plugin = loadPlugin();
  assert.equal(runProbe(plugin._probeScript, { title: "Getty Images" })[0].type, "getty-unreadable");
  assert.equal(runProbe(plugin._probeScript, { json: "{\"search\":{}}" })[0].type, "getty-unreadable");
});

// ---------------------------------------------------------------------------
// Normalizing
// ---------------------------------------------------------------------------
test("photos: links are locale-neutral detail pages; bad rows are dropped", () => {
  const plugin = loadPlugin();
  const photos = plugin._photosOf(result(PORTISHEAD_ASSETS));
  assert.deepEqual(photos.map((p) => p.id), ["480270124", "992089350", "1234567890", "119675320", "905500670"]);
  const first = photos[0];
  assert.equal(first.url, "https://www.gettyimages.com/detail/480270124");
  assert.equal(first.photographer, "Edu Hawkins");
  assert.equal(first.collection, "Redferns");
  assert.equal(first.year, 2015);
  assert.equal(first.date, "10. Juli 2015");
  assert.equal(first.orientation, "horizontal");
  // The signed preview is kept whole; a preview off Getty's CDN is not kept.
  assert.match(first.thumbUrl, /^https:\/\/media\.gettyimages\.com\/.*c=SIGNATURE1$/);
  assert.equal(photos[3].thumbUrl, undefined);
  // The year is the photo's, not the upload's.
  assert.equal(photos[1].year, 1995);
});

test("searchUrl: editorial, best match by default", () => {
  const plugin = loadPlugin();
  assert.equal(plugin._searchUrl("Sigur Rós"), "https://www.gettyimages.com/search/2/image?family=editorial&phrase=Sigur%20R%C3%B3s&sort=best");
  assert.match(plugin._searchUrl("x", { page: 3, sort: "newest" }), /sort=newest&page=3$/);
});

// ---------------------------------------------------------------------------
// The artist tab
// ---------------------------------------------------------------------------
test("tab: a card grid of photos about the artist, each opening on Getty", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  const out = await host.infoHandlers.getty_photos({ kind: "artist", name: "Portishead", id: 1 });
  assert.equal(out.status, "ok");
  const [intro, grid, button] = out.value.view.children;
  assert.equal(intro.type, "text");
  assert.match(intro.content, /1,076 editorial photos/);
  assert.equal(grid.type, "card-grid");
  // The Massive Attack photo is not about Portishead, and the docks are the town.
  assert.deepEqual(grid.items.map((i) => i.id), ["480270124", "992089350", "119675320"]);
  assert.equal(grid.items[0].subtitle, "2015 · Edu Hawkins / Redferns");
  assert.equal(grid.items[0].action, "open-photo");
  assert.equal(button.action, "open-search");

  // The same photos as a gallery, for cue sheets (manifest contextImages).
  assert.deepEqual(out.value.images.map((i) => i.pageUrl), [
    "https://www.gettyimages.com/detail/480270124",
    "https://www.gettyimages.com/detail/992089350",
  ]); // the third has a preview off Getty's CDN, so no picture to offer
  assert.equal(out.value.images[0].author, "Edu Hawkins");
  assert.equal(out.value.images[0].source, "Getty Images / Redferns");
  assert.match(out.value.images[0].url, /^https:\/\/media\.gettyimages\.com\//);

  // The window was hidden, closed afterwards, and loaded an editorial search.
  assert.equal(host.windows.length, 1);
  assert.equal(host.windows[0].opts.visible, false);
  assert.equal(host.windows[0].closed, true);
  assert.equal(host.windows[0].url.searchParams.get("family"), "editorial");
  assert.equal(host.windows[0].url.searchParams.get("phrase"), "Portishead");

  host.actions["open-photo"]({ itemId: "992089350", entity: { kind: "artist", name: "Portishead" } });
  host.actions["open-search"]({ entity: { kind: "artist", name: "Portishead" } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(host.opened, [
    "https://www.gettyimages.com/detail/992089350",
    "https://www.gettyimages.com/search/2/image?family=editorial&phrase=Portishead&sort=best",
  ]);
});

test("tab: open-photo ignores anything that isn't a Getty id", async () => {
  const { host } = setup(okPage([]));
  host.actions["open-photo"]({ itemId: "https://evil.example.com" });
  host.actions["open-photo"]({});
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(host.opened, []);
});

test("tab: no photo about the artist → not_found (the tab hides)", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  const out = await host.infoHandlers.getty_photos({ kind: "artist", name: "Tricky" });
  assert.deepEqual(out, { status: "not_found" });
});

test("tab: a blocked search is an error, and pauses the next one without a window", async () => {
  const { host } = setup(() => ({ type: "getty-blocked", data: { title: "Attention Required! | Cloudflare" } }));
  const first = await host.infoHandlers.getty_photos({ kind: "artist", name: "Portishead" });
  assert.equal(first.status, "error");
  assert.match(first.message, /turned the search away/);
  const second = await host.infoHandlers.getty_photos({ kind: "artist", name: "Björk" });
  assert.equal(second.status, "error");
  assert.match(second.message, /paused until/);
  assert.equal(host.windows.length, 1);
});

test("tab: an unreadable page is an error, never an empty tab", async () => {
  const { host } = setup(() => ({ type: "getty-unreadable", data: {} }));
  const out = await host.infoHandlers.getty_photos({ kind: "artist", name: "Portishead" });
  assert.equal(out.status, "error");
  assert.match(out.message, /site may have changed/);
  assert.equal(host.windows[0].closed, true);
});

// ---------------------------------------------------------------------------
// Assistant tool
// ---------------------------------------------------------------------------
test("search_photos: links, credits and paging; nothing filtered by name", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  const out = await host.tools.search_photos({ query: "Portishead", limit: 3 });
  assert.equal(out.total, 1076);
  assert.equal(out.lastPage, 18);
  assert.equal(out.family, "editorial");
  assert.equal(out.photos.length, 3);
  assert.equal(out.photos[2].id, "1234567890");
  assert.equal(out.photos[0].url, "https://www.gettyimages.com/detail/480270124");
  assert.match(out.searchUrl, /phrase=Portishead/);
  assert.match(out.note, /612px preview/);
});

test("search_photos: orientation filters locally; bad arguments are readable errors", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  const out = await host.tools.search_photos({ query: "Portishead", orientation: "vertical" });
  assert.deepEqual(out.photos.map((p) => p.id), ["992089350"]);
  await assert.rejects(host.tools.search_photos({}), /query is required/);
  await assert.rejects(host.tools.search_photos({ query: "x", sort: "random" }), /Unknown sort 'random'/);
  await assert.rejects(host.tools.search_photos({ query: "x", limit: "lots" }), /expected a number/);
});

test("manifest: the tool is read-only and the tab is a lazy plugin_view", () => {
  const manifest = require("../manifest.json");
  const tool = manifest.contributes.assistant.tools.find((t) => t.name === "search_photos");
  assert.equal(tool.readOnly, true);
  const type = manifest.contributes.informationTypes[0];
  assert.equal(type.id, "getty_photos");
  assert.equal(type.displayKind, "plugin_view");
  assert.equal(type.entity, "artist");
  assert.equal(type.contextImages, true);
  assert.equal(manifest.runtime, "worker");
  // No network permission: the plugin never fetches anything itself.
  assert.ok(!manifest.permissions.some((p) => p.startsWith("network:")));
});

// ---------------------------------------------------------------------------
// Context images (api.contextImages)
// ---------------------------------------------------------------------------
const contextRequest = (year, limit = 24) => ({
  subject: "track",
  track: { title: "Glory Box", artistName: "Portishead", albumTitle: "Dummy", albumArtistName: "Portishead", year, durationSecs: 301 },
  artist: { name: "Portishead" },
  album: { title: "Dummy", artistName: "Portishead", year },
  purpose: "nowplaying",
  limit,
});

// An archive photo only the year search finds.
const ERA_ASSET = asset({
  id: "777000111",
  title: "Portishead In Concert",
  caption: "Beth Gibbons of Portishead performs on stage in London, 1994. (Photo by Mick Hutson/Redferns)",
  artist: "Mick Hutson",
  collectionName: "Redferns",
  dateCreated: "1. Oktober 1994",
  people: "Beth Gibbons",
  thumbUrl: "https://media.gettyimages.com/id/777000111/de/foto/portishead.jpg?s=612x612&w=0&k=20&c=SIGNATURE7",
});

test("context images: registers its provider, and stays on the tab for older hosts", () => {
  assert.equal(typeof setup(okPage([])).host.contextHandlers["artist-era"], "function");
  const plugin = loadPlugin();
  const old = makeHost({ page: okPage([]), noContextImages: true });
  assert.doesNotThrow(() => plugin.activate(old.api));
  assert.equal(typeof old.infoHandlers.getty_photos, "function");
});

test("context images: few photos near the year → one more search with the year, then the era first", async () => {
  const { host } = setup((u) => ({
    type: "getty-result",
    data: result(u.searchParams.get("phrase") === "Portishead 1994" ? [ERA_ASSET] : PORTISHEAD_ASSETS),
  }));
  const out = await host.contextHandlers["artist-era"](contextRequest(1994));
  assert.equal(out.status, "ok");
  assert.deepEqual(host.windows.map((w) => w.url.searchParams.get("phrase")), ["Portishead", "Portishead 1994"]);
  // 1994 (±0) → 1995 (±1) → 2015; the town's docks, Massive Attack and the
  // off-CDN preview are left out, as on the tab.
  assert.deepEqual(out.images.map((i) => i.year), [1994, 1995, 2015]);
  const [first] = out.images;
  assert.equal(first.relevance, 1);
  assert.equal(first.reason, "Taken in 1994, the year of this record");
  assert.equal(first.author, "Mick Hutson");
  assert.equal(first.source, "Getty Images / Redferns");
  assert.equal(first.pageUrl, "https://www.gettyimages.com/detail/777000111");
  assert.match(first.url, /^https:\/\/media\.gettyimages\.com\//);
  assert.equal(first.about, "artist");
});

test("context images: enough era photos already → no second search; without a year, Getty's order", async () => {
  const many = [1995, 1995, 1996, 1997].map((y, i) => asset({
    id: String(800000000 + i), title: "Portishead Live", caption: "Portishead perform on stage",
    collectionName: "Redferns", dateCreated: String(y),
    thumbUrl: `https://media.gettyimages.com/id/${800000000 + i}/x.jpg?s=612x612&w=0&k=20&c=S`,
  }));
  const { host } = setup(okPage(many));
  const dated = await host.contextHandlers["artist-era"](contextRequest(1995));
  assert.equal(host.windows.length, 1);
  assert.equal(dated.images.length, 4);
  // Same artist again with no year: the cached search, no window.
  const undated = await host.contextHandlers["artist-era"](contextRequest(null));
  assert.equal(host.windows.length, 1);
  assert.ok(undated.images.every((i) => i.relevance === 0.5 && i.reason === undefined));
});

test("context images: the tab and the provider share one search", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  await host.infoHandlers.getty_photos({ kind: "artist", name: "Portishead" });
  await host.contextHandlers["artist-era"](contextRequest(null));
  assert.equal(host.windows.length, 1);
});

test("context images: nothing about the artist is not_found; a blocked search is an error", async () => {
  const { host } = setup(okPage(PORTISHEAD_ASSETS));
  const none = await host.contextHandlers["artist-era"]({ ...contextRequest(null), artist: { name: "Tricky" }, track: undefined });
  assert.deepEqual(none, { status: "not_found" });
  const blocked = setup(() => ({ type: "getty-blocked", data: { title: "Attention Required! | Cloudflare" } }));
  const out = await blocked.host.contextHandlers["artist-era"](contextRequest(1994));
  assert.equal(out.status, "error");
  assert.match(out.message, /turned the search away/);
});

test("eraFit", () => {
  const plugin = loadPlugin();
  assert.deepEqual(plugin._eraFit(1994, 1994), { relevance: 1, reason: "Taken in 1994, the year of this record" });
  assert.equal(plugin._eraFit(1999, 1994).reason, "Taken in 1999, 5 years after this record");
  assert.deepEqual(plugin._eraFit(null, 1994), { relevance: 0.35 });
  assert.deepEqual(plugin._eraFit(2000, null), { relevance: 0.5 });
});
