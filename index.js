// viboplr-gettyimages — editorial photos of an artist from Getty Images, as links.
//
// Design notes:
//  - LINKS, NEVER FILES. Getty's photos are licensed. The plugin returns each
//    photo's page on Getty Images and Getty's own 612px preview (no watermark:
//    `w=0`), and the app shows the preview from Getty's CDN. A cue sheet may
//    link a preview with credit, which is the host's rule for press photos. Nothing is downloaded, cached as
//    artwork or offered as an image provider, and the assistant instructions say
//    the same to a model.
//  - A HIDDEN BROWSER WINDOW, NOT A FETCH. Getty sits behind Cloudflare, which
//    answers 403 to every non-browser client — robots.txt included, from home
//    and data-centre addresses alike (checked 2026-11-06). The app's embedded
//    browse window is a real webview, so the plugin loads the search page there
//    and reads it. There is no free API: Getty's API is for paying customers.
//  - THE PAGE CARRIES ITS OWN DATA. The search page ships its results as JSON in
//    <script type="application/json" data-component="Search">, under
//    search.gallery.assets (60 per page): id, titles, the photographer's caption,
//    photographer, collection, date, people, and a signed preview URL. The probe
//    reads that, never the rendered grid, so a restyle doesn't break it.
//  - LOCALE-NEUTRAL LINKS. Getty redirects each visitor to their country's site
//    (gettyimages.at, …) and localizes dates and URL slugs. A photo's link is
//    https://www.gettyimages.com/detail/<id>, which redirects the user to their
//    own country's page for it. `date` stays as the page wrote it; `year` is
//    parsed out for sorting and display.
//  - ONE WINDOW AT A TIME (`paced`). Each search opens a window, so they queue,
//    start MIN_GAP_MS apart, and a Cloudflare block stops them all for
//    BLOCK_COOLDOWN_MS instead of hammering a flagged address.
//  - THE TAB IS LAZY. `plugin_view` information types are fetched only when
//    their tab is shown, so opening an artist page costs nothing.
//  - WORKER RUNTIME. No fetch, no DOM: only the browse window and openUrl.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var SEARCH_PAGE = "https://www.gettyimages.com/search/2/image";
var DETAIL_PAGE = "https://www.gettyimages.com/detail/";
var INFO_TYPE_ID = "getty_photos";
var PAGE_TIMEOUT_MS = 30000;
var POLL_MS = 700;
var MIN_GAP_MS = 3000;
var BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
var PAGE_SIZE = 60;
var TAB_LIMIT = 24;
var DEFAULT_LIMIT = 20;
var CAPTION_CAP = 400;
var FAMILIES = { editorial: "editorial", creative: "creative" };
var SORTS = { best: "best", newest: "newest" };
var ORIENTATIONS = { horizontal: "Horizontal", vertical: "Vertical", square: "Square" };
// The artist tab keeps only photos that are about music (see isAbout).
// Photographers' captions say so in a handful of words; Redferns and Michael
// Ochs are music-only collections.
var MUSIC_CONTEXT = /\b(performs?|performing|performed|performance|concert|gig|on stage|onstage|live at|band|singer|singers|musician|musicians|rapper|dj|guitarist|bassist|drummer|vocalist|keyboardist|pianist|composer|songwriter|festival|tour|album|recording|studio|music|duo|trio|group)\b/i;
var MUSIC_COLLECTIONS = /\b(Redferns|Michael Ochs Archives)\b/i;

// Runs inside the Getty page (the browse window), not in the worker. Reports
// one of: getty-result (the page's search data), getty-blocked (Cloudflare
// refused us), getty-challenge (Cloudflare is checking the browser — keep
// waiting), getty-unreadable (the page loaded but its data isn't where it was).
// Says nothing while the page is still loading; the poll asks again.
var PROBE_SCRIPT = "(function () {" +
  "  try {" +
  "    var title = document.title || '';" +
  "    var text = title + ' ' + ((document.body && document.body.innerText) || '').slice(0, 3000);" +
  "    if (/Attention Required|Sorry, you have been blocked|Access denied/i.test(text)) {" +
  "      window.__viboplr.send('getty-blocked', { title: title }); return;" +
  "    }" +
  "    if (/Just a moment|Checking your browser|Verify you are human/i.test(text)) {" +
  "      window.__viboplr.send('getty-challenge', { title: title }); return;" +
  "    }" +
  "    var node = document.querySelector('script[data-component=\"Search\"]');" +
  "    if (!node) {" +
  "      if (document.readyState === 'complete' && document.querySelector('a[href*=\"/detail/\"]') === null && /getty/i.test(location.hostname)) {" +
  "        window.__viboplr.send('getty-unreadable', { url: location.href }); return;" +
  "      }" +
  "      return;" +
  "    }" +
  "    var data = JSON.parse(node.textContent);" +
  "    var g = data && data.search && data.search.gallery;" +
  "    if (!g || !Array.isArray(g.assets)) { window.__viboplr.send('getty-unreadable', { url: location.href }); return; }" +
  "    var assets = g.assets.map(function (x) {" +
  "      return { id: x.id, title: x.shortTitle || x.title, caption: x.caption, artist: x.artist," +
  "        collectionName: x.collectionName, dateCreated: x.dateCreated, dateSubmitted: x.dateSubmitted," +
  "        people: x.people, thumbUrl: x.thumbUrl, orientation: x.orientation, assetType: x.assetType, family: x.family };" +
  "    });" +
  "    window.__viboplr.send('getty-result', {" +
  "      host: location.hostname, total: g.counts && g.counts.images, page: g.page, lastPage: g.lastPage, assets: assets" +
  "    });" +
  "  } catch (e) {" +
  "    window.__viboplr.send('getty-unreadable', { error: String(e && e.message || e) });" +
  "  }" +
  "})();";

var api = null;
var lastSearchAt = 0;
var blockedUntil = 0;
var searchChain = Promise.resolve();

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function normName(s) {
  if (!s) return "";
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normWords(s) {
  if (!s) return [];
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Whether `name` appears in `text` as a run of whole words ("Bush" matches
// "Kate Bush performs" but not "Bushwick"); a multi-word name may also appear
// run together ("AC/DC" in "ACDC").
function mentions(text, name) {
  var want = normWords(name);
  if (want.length === 0) {
    var n = normName(name);
    return !!n && normName(text).indexOf(n) !== -1;
  }
  var have = normWords(text);
  for (var i = 0; i + want.length <= have.length; i++) {
    var ok = true;
    for (var j = 0; j < want.length && ok; j++) ok = have[i + j] === want[j];
    if (ok) return true;
  }
  return want.length > 1 && have.indexOf(normName(name)) !== -1;
}

function clean(s, cap) {
  if (typeof s !== "string") return undefined;
  var t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (cap && t.length > cap) {
    var cut = t.slice(0, cap);
    var space = cut.lastIndexOf(" ");
    t = (space > cap * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.|-]+$/, "") + "…";
  }
  return t;
}

function clockTime(ms) {
  var d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
function searchUrl(phrase, opts) {
  opts = opts || {};
  var parts = [
    "family=" + encodeURIComponent(opts.family || "editorial"),
    "phrase=" + encodeURIComponent(phrase),
    "sort=" + encodeURIComponent(opts.sort || "best"),
  ];
  if (opts.page && opts.page > 1) parts.push("page=" + opts.page);
  return SEARCH_PAGE + "?" + parts.join("&");
}

function photoUrl(id) {
  return DETAIL_PAGE + id;
}

function isPhotoId(id) {
  return typeof id === "string" && /^\d{3,15}$/.test(id);
}

// Only Getty's own image CDN, over https. The preview URL is signed (its
// query string), so it is kept whole.
function safeThumb(url) {
  if (typeof url !== "string") return undefined;
  try {
    var u = new URL(url);
    if (u.protocol !== "https:") return undefined;
    if (!/(^|\.)gettyimages\.com$/i.test(u.hostname)) return undefined;
    return u.href;
  } catch (_e) {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Reading the search page
// ---------------------------------------------------------------------------
function blockedError() {
  blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
  return new Error("Getty Images turned the search away (its bot protection) — Getty searches are paused until " +
    clockTime(blockedUntil) + ". This happens more on shared or work networks.");
}

// Runs `task` when the gate allows: after every earlier search, MIN_GAP_MS
// after the last one started, and never while a block is being respected.
function paced(task) {
  var run = searchChain.then(async function () {
    if (Date.now() < blockedUntil) {
      throw new Error("Getty Images turned a search away a few minutes ago, so searches are paused until " + clockTime(blockedUntil));
    }
    var wait = lastSearchAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastSearchAt = Date.now();
    return task();
  });
  searchChain = run.catch(function () {});
  return run;
}

// Opens `url` hidden and resolves with the page's search data.
function readSearchPage(url) {
  var startedAt = Date.now();
  return api.network.openBrowseWindow(url, { visible: false, title: "Vibo — Getty Images", width: 1280, height: 900 })
    .then(function (handle) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var challenged = false;
        var pollTimer = null;
        var deadline = null;
        var unsubscribe = null;
        function done(err, value) {
          if (settled) return;
          settled = true;
          clearInterval(pollTimer);
          clearTimeout(deadline);
          if (typeof unsubscribe === "function") unsubscribe();
          handle.close().catch(function (e) { console.error("Failed to close the Getty Images window:", e); });
          api.log(err ? "warn" : "info", "search " + url + " → " + (err ? err.message : "read") +
            " in " + (Date.now() - startedAt) + "ms", "getty");
          if (err) reject(err);
          else resolve(value);
        }
        unsubscribe = handle.onMessage(function (msg) {
          if (!msg) return;
          if (msg.type === "getty-result") done(null, msg.data);
          else if (msg.type === "getty-blocked") done(blockedError());
          else if (msg.type === "getty-challenge") challenged = true;
          else if (msg.type === "getty-unreadable") {
            done(new Error("Getty Images' search page didn't carry its results where the plugin looks for them (the site may have changed)"));
          }
        });
        pollTimer = setInterval(function () {
          // A poll landing mid-navigation (the country redirect) can fail;
          // the next one or the deadline settles it.
          handle.eval(PROBE_SCRIPT).catch(function () { /* the page is navigating; the next poll retries */ });
        }, POLL_MS);
        deadline = setTimeout(function () {
          done(challenged
            ? new Error("Getty Images kept checking whether a browser was searching and never showed results — try again later")
            : new Error("Getty Images' search page didn't load within " + PAGE_TIMEOUT_MS / 1000 + "s"));
        }, PAGE_TIMEOUT_MS);
      });
    });
}

// A raw asset from the page → our photo shape, or null when it isn't usable.
function toPhoto(x) {
  if (!x || typeof x !== "object") return null;
  var id = typeof x.id === "number" ? String(x.id) : x.id;
  if (!isPhotoId(id)) return null;
  if (x.assetType && x.assetType !== "image") return null;
  var date = clean(x.dateCreated);
  var year = null;
  var m = /\b(18\d\d|19\d\d|20\d\d)\b/.exec(date || "");
  if (m) year = Number(m[1]);
  var orientation = clean(x.orientation);
  return {
    id: id,
    url: photoUrl(id),
    title: clean(x.title, 160),
    caption: clean(x.caption, CAPTION_CAP),
    photographer: clean(x.artist),
    collection: clean(x.collectionName),
    date: date,
    year: year,
    people: clean(x.people),
    orientation: orientation ? orientation.toLowerCase() : undefined,
    thumbUrl: safeThumb(x.thumbUrl),
  };
}

function photosOf(data) {
  var raw = data && Array.isArray(data.assets) ? data.assets : [];
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var p = toPhoto(raw[i]);
    if (!p || seen[p.id]) continue;
    seen[p.id] = true;
    out.push(p);
  }
  return out;
}

function search(phrase, opts) {
  var url = searchUrl(phrase, opts);
  return paced(function () { return readSearchPage(url); }).then(function (data) {
    return {
      url: url,
      total: typeof (data && data.total) === "number" ? data.total : null,
      page: data && typeof data.page === "number" ? data.page : (opts && opts.page) || 1,
      lastPage: data && typeof data.lastPage === "number" ? data.lastPage : null,
      photos: photosOf(data),
    };
  });
}

// Is this photo of the musician `name`? Getty's own words must name them
// (title, caption, people), and say it is music: a search for "Portishead"
// also brings back the town's docks, one for "Bush" every president.
function isAbout(photo, name) {
  if (!mentions([photo.title, photo.caption, photo.people].join(" "), name)) return false;
  if (MUSIC_COLLECTIONS.test(photo.collection || "")) return true;
  return MUSIC_CONTEXT.test([photo.title, photo.caption].join(" "));
}

// ---------------------------------------------------------------------------
// The artist tab (information type getty_photos, displayKind plugin_view)
// ---------------------------------------------------------------------------
function cardSubtitle(p) {
  var credit = [p.photographer, p.collection].filter(Boolean).join(" / ");
  return [p.year ? String(p.year) : null, credit || null].filter(Boolean).join(" · ") || undefined;
}

// The same photos in the image_gallery shape, for cue sheets: the manifest's
// `contextImages: true` makes get_cue_context read `images` off this value.
function galleryOf(photos) {
  return photos.filter(function (p) { return !!p.thumbUrl; }).map(function (p) {
    var img = {
      url: p.thumbUrl,
      source: "Getty Images" + (p.collection ? " / " + p.collection : ""),
      pageUrl: p.url,
      license: "Getty Images editorial — link to it, credit the photographer",
    };
    var caption = p.caption || p.title;
    if (caption) img.caption = caption;
    if (p.photographer) img.author = p.photographer;
    return img;
  });
}

function tabView(name, result, photos) {
  var count = result.total && result.total > photos.length
    ? result.total.toLocaleString("en-US") + " editorial photos on Getty Images. These are the best matches."
    : photos.length + " editorial photo" + (photos.length === 1 ? "" : "s") + " on Getty Images.";
  return {
    images: galleryOf(photos),
    view: {
      type: "layout",
      direction: "vertical",
      children: [
        { type: "text", content: count + " Click a photo to open it on Getty Images." },
        {
          type: "card-grid",
          items: photos.map(function (p) {
            return {
              id: p.id,
              title: p.title || p.caption || name,
              subtitle: cardSubtitle(p),
              imageUrl: p.thumbUrl,
              action: "open-photo",
            };
          }),
        },
        { type: "button", label: "See all on Getty Images", action: "open-search", variant: "secondary" },
      ],
    },
  };
}

async function fetchArtistPhotos(entity) {
  var name = entity && typeof entity.name === "string" ? entity.name.trim() : "";
  if (!normName(name)) return { status: "not_found" };
  try {
    var result = await cachedSearch(name);
    // Getty's search is broad: a band named like a word ("Bush", "Air") pulls
    // in every photo that has the word. Keep the ones Getty itself says are
    // about the artist.
    var photos = result.photos.filter(function (p) { return isAbout(p, name); }).slice(0, TAB_LIMIT);
    if (!photos.length) return { status: "not_found" };
    return { status: "ok", value: tabView(name, result, photos) };
  } catch (e) {
    return { status: "error", message: e && e.message ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Context images: the artist's photos, best fit to the track's year first
// ---------------------------------------------------------------------------
// The host asks for pictures for what is playing (api.contextImages). Getty
// dates its archive photos, so a photo from the record's own era fits best.
// When the artist's best matches hold few photos from near that year, one
// more search adds the year to the phrase ("Portishead 1994"): Getty matches
// it against captions, which for archive photos almost always name the date.
// Same links-only rule as the tab: the 612px preview, linked to its page.
var CONTEXT_PROVIDER_ID = "artist-era";
var SEARCH_CACHE_MS = 60 * 60 * 1000;
var ERA_WINDOW = 3;
var ERA_MIN = 4;
var searchCache = {};

// One search per phrase per hour, shared by the tab and every context
// request: a track change within the same artist opens no window. A failed
// search isn't kept, so the next request asks again.
function cachedSearch(phrase) {
  var key = normName(phrase);
  var hit = searchCache[key];
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.promise;
  var promise = search(phrase, { family: "editorial", sort: "best" });
  searchCache[key] = { at: Date.now(), promise: promise };
  promise.catch(function () { if (searchCache[key] && searchCache[key].promise === promise) delete searchCache[key]; });
  return promise;
}

// How well a photo taken in `year` fits a record from `target`.
function eraFit(year, target) {
  if (!target) return { relevance: 0.5 };
  if (!year) return { relevance: 0.35 };
  var d = Math.abs(year - target);
  var reason = d === 0 ? "Taken in " + year + ", the year of this record"
    : "Taken in " + year + ", " + d + (d === 1 ? " year " : " years ") + (year < target ? "before" : "after") + " this record";
  var relevance = d === 0 ? 1 : d === 1 ? 0.9 : d <= 3 ? 0.8 : d <= 6 ? 0.6 : d <= 10 ? 0.45 : 0.3;
  return { relevance: relevance, reason: reason };
}

function contextImage(p, target) {
  var fit = eraFit(p.year, target);
  var img = {
    url: p.thumbUrl,
    source: "Getty Images" + (p.collection ? " / " + p.collection : ""),
    pageUrl: p.url,
    license: "Getty Images editorial — link to it, credit the photographer",
    about: "artist",
    relevance: fit.relevance,
  };
  var caption = p.caption || p.title;
  if (caption) img.caption = caption;
  if (p.photographer) img.author = p.photographer;
  if (p.year) img.year = p.year;
  if (fit.reason) img.reason = fit.reason;
  return img;
}

async function contextImages(request) {
  var name = request && ((request.artist && request.artist.name) || (request.track && request.track.artistName));
  name = typeof name === "string" ? name.trim() : "";
  if (!normName(name)) return { status: "not_found" };
  var target = (request.track && request.track.year) || (request.album && request.album.year) || null;
  var limit = Math.max(1, Math.min(PAGE_SIZE, (request && request.limit) || TAB_LIMIT));
  var usable = function (p) { return !!p.thumbUrl && isAbout(p, name); };
  try {
    var photos = (await cachedSearch(name)).photos.filter(usable);
    var nearEra = function (p) { return p.year && Math.abs(p.year - target) <= ERA_WINDOW; };
    if (target && photos.filter(nearEra).length < ERA_MIN) {
      try {
        var era = (await cachedSearch(name + " " + target)).photos.filter(usable);
        var seen = {};
        photos.forEach(function (p) { seen[p.id] = true; });
        photos = photos.concat(era.filter(function (p) { return !seen[p.id]; }));
      } catch (e) {
        // The artist's own photos still answer; the era search was extra.
        api.log("warn", "Getty era search for " + name + " " + target + " failed: " + (e && e.message ? e.message : e));
      }
    }
    if (!photos.length) return { status: "not_found" };
    var ranked = photos.map(function (p, i) { return { img: contextImage(p, target), i: i }; });
    ranked.sort(function (a, b) { return b.img.relevance - a.img.relevance || a.i - b.i; });
    return { status: "ok", images: ranked.slice(0, limit).map(function (r) { return r.img; }) };
  } catch (e) {
    return { status: "error", message: e && e.message ? e.message : String(e) };
  }
}

function openPhoto(payload) {
  var id = payload && payload.itemId;
  if (!isPhotoId(id)) return;
  api.network.openUrl(photoUrl(id)).catch(function (e) { console.error("Failed to open the Getty Images photo:", e); });
}

function openSearch(payload) {
  var entity = payload && payload.entity;
  var name = entity && typeof entity.name === "string" ? entity.name.trim() : "";
  if (!name) return;
  api.network.openUrl(searchUrl(name, { family: "editorial", sort: "best" }))
    .catch(function (e) { console.error("Failed to open the Getty Images search:", e); });
}

// ---------------------------------------------------------------------------
// Assistant tool: search_photos
// ---------------------------------------------------------------------------
function strArg(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function intArg(v, def, min, max) {
  if (v === undefined || v === null || v === "") return def;
  var n = Number(v);
  if (!isFinite(n)) throw new Error("expected a number, got " + JSON.stringify(v));
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function enumArg(v, table, what, def) {
  var s = strArg(v);
  if (!s || s === "any") return def;
  var key = s.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error("Unknown " + what + " '" + s + "' — use one of: " + Object.keys(table).join(", "));
  }
  return table[key];
}

async function searchPhotos(args) {
  args = args || {};
  var q = strArg(args.query);
  if (!q) throw new Error("query is required");
  var family = enumArg(args.family, FAMILIES, "family", "editorial");
  var sort = enumArg(args.sort, SORTS, "sort", "best");
  var orientation = enumArg(args.orientation, ORIENTATIONS, "orientation", null);
  var page = intArg(args.page, 1, 1, 1000);
  var limit = intArg(args.limit, DEFAULT_LIMIT, 1, PAGE_SIZE);

  var result = await search(q, { family: family, sort: sort, page: page });
  var photos = result.photos;
  if (orientation) {
    var want = orientation.toLowerCase();
    photos = photos.filter(function (p) { return p.orientation === want; });
  }
  return {
    query: q,
    family: family,
    sort: sort,
    total: result.total,
    page: result.page,
    lastPage: result.lastPage,
    searchUrl: result.url,
    photos: photos.slice(0, limit),
    note: "Getty Images' licensed photos: link to `url` and credit the photographer and collection. thumbUrl is Getty's 612px preview (no watermark): fine as a linked picture in a cue sheet with that credit, never to save, download or use as artist or album art.",
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function activate(pluginApi) {
  api = pluginApi;
  api.informationTypes.onFetch(INFO_TYPE_ID, fetchArtistPhotos);
  api.ui.onAction("open-photo", openPhoto);
  api.ui.onAction("open-search", openSearch);
  if (api.assistant) api.assistant.onTool("search_photos", searchPhotos);
  // Older hosts have no context images; they keep reading the tab's `images`.
  if (api.contextImages && typeof api.contextImages.onRequest === "function") {
    api.contextImages.onRequest(CONTEXT_PROVIDER_ID, contextImages);
  }
}

function deactivate() {
  api = null;
  lastSearchAt = 0;
  blockedUntil = 0;
  searchChain = Promise.resolve();
  searchCache = {};
}

return {
  activate: activate,
  deactivate: deactivate,
  // Exposed for tests.
  _mentions: mentions,
  _searchUrl: searchUrl,
  _toPhoto: toPhoto,
  _photosOf: photosOf,
  _probeScript: PROBE_SCRIPT,
  _fetchArtistPhotos: fetchArtistPhotos,
  _searchPhotos: searchPhotos,
  _contextImages: contextImages,
  _eraFit: eraFit,
};
