# Getty Images for Vibo

Editorial photos of an artist (concerts, portraits, press and archive shots) from
[Getty Images](https://www.gettyimages.com), shown as **links**.

- **Artist pages:** a *Getty Images* tab with up to 24 photos of the artist, each credited
  to its photographer and collection. Click a photo to open it on Getty Images, or use
  *See all on Getty Images* for the full search.
- **AI assistants:** a read-only `search_photos` tool (over Vibo's MCP server it's
  `gettyimages__search_photos`). It returns each photo's Getty page, caption, photographer,
  collection, date and a preview.

**Cue sheets:** when an assistant writes a cue sheet, the artist's photos are offered to
it (through `get_cue_context`) with their credit and Getty page. A sheet only links to a
picture, so nothing is copied.

Nothing is downloaded or saved. The previews are Getty's own 612px images (no
watermark), loaded from Getty's servers. The photos belong to Getty Images and its contributors, so to use
one you license it from Getty.

## How it works

Getty has no free API, and its site turns away anything that isn't a browser. The plugin
opens Getty's search page in a hidden window inside Vibo and reads the results the page
already contains. Each search takes a few seconds and runs one at a time. The artist tab
loads only when you open it.

Experimental: the plugin breaks if Getty changes its site. When that happens, the tab
shows an error instead of an empty result.

## Development

```
npm test
npm run check
```
