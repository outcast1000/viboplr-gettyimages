# CLAUDE.md

Viboplr plugin `gettyimages` ("Getty Images"). Plugin = `index.js` (a function body
returning `{ activate, deactivate, _testHooks… }`) + `manifest.json`. Worker runtime
(`"runtime": "worker"`): no `fetch`, no DOM — only `api.network.openBrowseWindow` and
`api.network.openUrl`.

## Rules

- **Links, never files.** Getty's photos are licensed. Return each photo's page
  (`https://www.gettyimages.com/detail/<id>`) and Getty's 612px preview (no watermark,
  `w=0`; the URL is signed, so keep its query string), nothing else. Do not add an image
  provider, download a preview, or cache one as artwork. A cue sheet may *link* a
  preview with credit, which is the host's rule for press photos.
- **Cue sheets read the tab's `images`.** The info type sets `contextImages: true`, so
  `get_cue_context` takes the `images` array beside `view` in the tab's value (the
  `image_gallery` shape: `url`, `caption`, `author`, `source`, `license`, `pageUrl`).
  Older hosts ignore the flag. Keep both in the one value.
- **The browse window is the only way in.** Cloudflare answers 403 to every non-browser
  client, so `network:` permissions are useless here; the manifest has none and a test
  keeps it that way. Getty's API is for paying customers.
- **Read the page's data, not its grid.** The probe (`PROBE_SCRIPT`) parses
  `<script type="application/json" data-component="Search">` → `search.gallery`. If
  Getty moves it, the probe reports `getty-unreadable` and the fetch is an **error**,
  never an empty tab or `not_found`.
- **Links are locale-neutral.** Getty redirects to the visitor's country site and
  localizes dates and slugs; build links from the id only. `date` is shown as the page
  wrote it, `year` is parsed from it (`dateSubmitted` is the upload date, wrong for
  archive photos).
- **One window at a time** (`paced`): MIN_GAP_MS between searches; a Cloudflare block
  pauses every search for BLOCK_COOLDOWN_MS. A Cloudflare *check* ("Just a moment") is
  waited out until the page deadline.
- **The tab is `plugin_view`**, so the host fetches it only when the tab is shown. Card
  clicks arrive as `{ itemId, entity }`; `open-photo` accepts only a numeric Getty id.
- The tab keeps only photos whose title, caption or people name the artist (whole
  words); `search_photos` does no name filtering. `search_photos` must stay
  `readOnly: true`.

## Commands

```
npm test        # node --test (test/*.test.js), no dependencies
npm run check   # node --check index.js
```

`test/harness/sandbox.js` loads `index.js` the way the worker does and shadows the
globals the worker deletes; `test/harness/host.js` is a fake plugin API whose browse
window answers each probe with what `opts.page(url)` returns. The probe script itself
is tested against a fake page in `plugin.test.js`.

Release: `scripts/bump.sh patch`, fill in CHANGELOG.md, commit, tag `vX.Y.Z`, push —
the Release workflow builds and signs `gettyimages.zip` + `update.json`.
