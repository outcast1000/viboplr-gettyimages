// A fake plugin API plus a scripted browse window: enough of ViboplrPluginAPI
// for activate() and the handlers. Windows, evals and opened URLs are recorded
// so tests can assert on what was asked.
//
// opts.page(url: URL) → the message the probe would send for that page:
//   { type: "getty-result", data } | { type: "getty-blocked" } | … | null (still loading)

function makeHost(opts = {}) {
  const windows = [];
  const opened = [];
  const logs = [];
  const infoHandlers = {};
  const actions = {};
  const tools = {};

  const api = {
    appVersion: "1.0.116",
    log: (level, message) => logs.push({ level, message }),
    network: {
      async openBrowseWindow(url, wopts) {
        const u = new URL(url);
        let handler = null;
        const win = { url: u, opts: wopts, evals: 0, closed: false };
        windows.push(win);
        return {
          async eval() {
            win.evals++;
            const msg = opts.page ? opts.page(u, win.evals) : null;
            if (msg && handler) handler(msg);
          },
          async close() { win.closed = true; },
          async show() {},
          async hide() {},
          onMessage(h) { handler = h; return () => { handler = null; }; },
          onNavigation() { return () => {}; },
        };
      },
      async openUrl(url) { opened.push(url); },
    },
    informationTypes: {
      onFetch(typeId, handler) { infoHandlers[typeId] = handler; },
    },
    ui: {
      onAction(id, handler) { actions[id] = handler; },
    },
    assistant: {
      onTool(name, handler) { tools[name] = handler; },
    },
  };

  return { api, windows, opened, logs, infoHandlers, actions, tools };
}

module.exports = { makeHost };
