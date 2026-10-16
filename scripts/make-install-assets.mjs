// Retakes the images the app is installed with, from the app itself, in headless Chrome or Edge:
// - src/screenshots/: the install dialog's screenshots (manifest.json "screenshots"), of Makkah at set times
// - src/splash/: iPhone launch screens, light and dark, one per size in IOS_LAUNCH_SCREEN_SIZES (src/app.js)
// - src/icon-maskable-512.png, apple-touch-icon.png and shortcut-*.png, drawn from web-app-manifest-512x512.png
// Usage: node scripts/make-install-assets.mjs   (CHROME=<path to chrome or msedge> if it isn't found)
//
// Run it when the app's look changes. It serves src/ itself and needs no npm packages: the browser is
// driven over the DevTools Protocol with Node's built-in WebSocket. Exits with 1 if Chrome then finds
// the manifest invalid or the app not installable.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
// The phone shots are 390x844 at 2x (780x1688), the sizes manifest.json declares
const PHONE = { width: 390, height: 844, scale: 2 };
// Each at a time of today in Makkah (UTC+3), so the sky card shows a different sky
const SCREENSHOTS = [
  { file: "screenshots/today.jpg", ...PHONE, theme: "light", time: "17:20" },
  { file: "screenshots/forecast.jpg", ...PHONE, theme: "light", time: "10:30", open: "forecast-sheet" },
  { file: "screenshots/dark.jpg", ...PHONE, theme: "dark", time: "20:45" },
  { file: "screenshots/desktop.jpg", width: 1280, height: 800, scale: 1, theme: "light", time: "06:50" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serves src/ on a free local port; returns the server. */
async function serveSrc() {
  const server = createServer(async (request, response) => {
    // URL parsing drops "..", so requests stay inside src/
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = join(SRC, path.endsWith("/") ? `${path}index.html` : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** Starts the browser headless, on a DevTools port it picks; returns { port, stop }. */
async function startBrowser() {
  const executable = process.env.CHROME ?? BROWSERS.find((path) => existsSync(path));
  if (!executable) throw new Error("Chrome or Edge not found: set CHROME to its path");
  const profile = await mkdtemp(join(tmpdir(), "install-assets-"));
  const browser = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  const stop = async () => {
    browser.kill();
    await exited;
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  // The browser writes the port it picked to DevToolsActivePort in the profile
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then(
      (text) => text.split("\n")[0],
      () => null
    );
    if (port) return { port, stop };
    await sleep(100);
  }
  await stop();
  throw new Error(`${executable} didn't start`);
}

/**
 * Opens a tab; returns send(method, params) for its DevTools Protocol commands, with
 * send.evaluate(expression) and send.goto(url) (resolves once the page has loaded).
 */
async function openTab(port) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const socket = new WebSocket((await target.json()).webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let lastId = 0;
  const calls = new Map();
  let onLoad = null;
  socket.onmessage = ({ data }) => {
    const { id, result, error, method } = JSON.parse(data);
    if (calls.has(id)) {
      const { resolve, reject } = calls.get(id);
      calls.delete(id);
      error ? reject(new Error(`${error.message} (${error.code})`)) : resolve(result);
    } else if (method === "Page.loadEventFired") {
      onLoad?.();
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      calls.set(++lastId, { resolve, reject });
      socket.send(JSON.stringify({ id: lastId, method, params }));
    });
  send.evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  send.goto = async (url) => {
    const loaded = new Promise((resolve) => (onLoad = resolve));
    await send("Page.navigate", { url });
    await loaded;
  };
  send.close = () => socket.close();
  await send("Page.enable");
  await send("Network.enable");
  return send;
}

/**
 * Runs in the page (it needs a canvas): draws the icons and launch screens, returns { file: data URL }.
 * @param {number[][]} launchSizes - [width, height] in device pixels, portrait.
 */
async function drawIconsAndLaunchScreens(launchSizes) {
  const N = 512;
  const canvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });
  const image = new Image();
  image.src = "/web-app-manifest-512x512.png";
  await image.decode();
  const source = canvas(N, N).getContext("2d", { willReadFrequently: true });
  source.drawImage(image, 0, 0);
  const { data } = source.getImageData(0, 0, N, N);
  const at = (x, y) => (y * N + x) * 4;

  // The figure is white on teal: its alpha follows the red channel, which the teal barely has
  const figure = source.createImageData(N, N);
  let x0 = N, y0 = N, x1 = 0, y1 = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const alpha = Math.min(1, Math.max(0, (data[at(x, y)] - 12) / 243));
      figure.data.set([255, 255, 255, Math.round(alpha * 255)], at(x, y));
      if (alpha > 0.5) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  const figureCanvas = canvas(N, N);
  figureCanvas.getContext("2d").putImageData(figure, 0, 0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let reach = 0; // How far the figure reaches from its centre
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (figure.data[at(x, y) + 3] > 12) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    }
  }

  // Full-bleed icon: the inner tile's gradient edge to edge, the figure scaled around the centre
  const color = (x, y) => `rgb(${data.slice(at(x, y), at(x, y) + 3)})`;
  const top = color(451, 60);
  const bottom = color(256, 470);
  const icon = (size, scale) => {
    const result = canvas(size, size);
    const ctx = result.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = "high";
    const k = (size / N) * scale;
    ctx.drawImage(figureCanvas, size / 2 - cx * k, size / 2 - cy * k, N * k, N * k);
    return result;
  };

  const files = {};
  // Android masks icons to a shape that can be as small as a circle of 40% of the size
  files["icon-maskable-512.png"] = icon(512, (0.4 * 0.95 * N) / reach).toDataURL();
  // iOS only rounds the corners: the figure as large as in the tile design
  files["apple-touch-icon.png"] = icon(180, 1.08).toDataURL();

  // Shortcuts: the page's sprite glyphs in teal; Android puts them on a white circle
  const shortcuts = { locate: "my_location", qibla: "explore", city: "location_on", forecast: "calendar_month" };
  for (const [name, symbol] of Object.entries(shortcuts)) {
    const result = canvas(192, 192);
    const ctx = result.getContext("2d");
    ctx.fillStyle = "#0d9488";
    ctx.translate(36, 36);
    ctx.scale(120 / 960, 120 / 960);
    ctx.translate(0, 960); // The symbols' viewBox starts at y = -960
    ctx.fill(new Path2D(document.querySelector(`#icon-${symbol} path`).getAttribute("d")));
    files[`shortcut-${name}.png`] = result.toDataURL();
  }

  // Launch screens: the home screen icon, 128pt, centred on the page background
  const homeIcon = icon(512, 1.08);
  for (const [width, height] of launchSizes) {
    const ratio = width > 1000 ? 3 : 2; // ponytail: iPhones are 2x up to 828px wide, 3x above
    const side = 128 * ratio;
    const x = (width - side) / 2;
    const y = (height - side) / 2;
    for (const [theme, background] of [["light", "#f8fafc"], ["dark", "#0f172a"]]) {
      const result = canvas(width, height);
      const ctx = result.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.beginPath();
      ctx.roundRect(x, y, side, side, side * 0.2237); // iOS icon corners
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(homeIcon, x, y, side, side);
      files[`splash/${width}x${height}-${theme}.jpg`] = result.toDataURL("image/jpeg", 0.9);
    }
  }
  return files;
}

let clockScript = null; // The tab's script that sets the page's clock

/** Captures the app in Makkah at the given viewport, theme and time, optionally with a sheet open. */
async function screenshot(tab, origin, { width, height, scale, theme, time, open }) {
  const mobile = width < 600;
  // The page's clock runs from that time (Date only; the Ramadan countdown's Temporal keeps the day)
  const [hours, minutes] = time.split(":").map(Number);
  const today = new Date(Date.now() + 3 * 36e5); // The date in Makkah
  const at = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hours - 3, minutes);
  if (clockScript) await tab("Page.removeScriptToEvaluateOnNewDocument", { identifier: clockScript });
  ({ identifier: clockScript } = await tab("Page.addScriptToEvaluateOnNewDocument", {
    source: `{
      const shift = ${at} - Date.now();
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [RealDate.now() + shift])); }
        static now() { return RealDate.now() + shift; }
        static [Symbol.hasInstance](value) { return value instanceof RealDate; }
      };
    }`,
  }));
  await tab("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  await tab("Emulation.setTouchEmulationEnabled", mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await tab("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: "reduce" }, // No entrance animations mid-capture
    ],
  });
  await tab.goto(origin);
  await tab.evaluate(`
    localStorage.clear();
    localStorage.setItem("theme-preference", ${JSON.stringify(theme)});
    localStorage.setItem("installBannerDismissed", "1");
    localStorage.setItem("lastKnownLocation", JSON.stringify({
      latitude: 21.427, longitude: 39.826, countryCode: "SA", timeZone: "Asia/Riyadh", manual: true,
      displayText: "مكة المكرمة، " + new Intl.DisplayNames(["ar"], { type: "region" }).of("SA"),
    }));`);
  await tab.goto(origin);
  await tab.evaluate("document.fonts.ready.then(() => true)");
  await sleep(1500); // The times, their View Transition and a countdown tick
  await tab.evaluate(`document.getElementById("install-btn").hidden = true`);
  if (open) {
    await tab.evaluate(`document.getElementById(${JSON.stringify(open)}).showPopover()`);
    await sleep(800);
  }
  const { data } = await tab("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  return Buffer.from(data, "base64");
}

const appJs = await readFile(join(SRC, "app.js"), "utf8");
const launchSizes = [...appJs.match(/IOS_LAUNCH_SCREEN_SIZES = \[([^\]]*)\]/)[1].matchAll(/"(\d+)x(\d+)"/g)].map(
  ([, width, height]) => [Number(width), Number(height)]
);

const server = await serveSrc();
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await startBrowser();
try {
  const tab = await openTab(browser.port);
  await tab("Network.setBypassServiceWorker", { bypass: true }); // The files on disk, never a cached copy
  await tab("Emulation.setTimezoneOverride", { timezoneId: "Asia/Riyadh" });

  await tab.goto(origin);
  const files = Object.entries(await tab.evaluate(`(${drawIconsAndLaunchScreens})(${JSON.stringify(launchSizes)})`)).map(
    ([file, url]) => [file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64")]
  );
  for (const shot of SCREENSHOTS) files.push([shot.file, await screenshot(tab, origin, shot)]);

  await mkdir(join(SRC, "splash"), { recursive: true });
  await mkdir(join(SRC, "screenshots"), { recursive: true });
  for (const [file, bytes] of files) {
    await writeFile(join(SRC, file), bytes);
    console.log(`${file} ${bytes.length} bytes`);
  }

  // The manifest as Chrome reads it, and whether it would offer to install the app
  await tab("Emulation.clearDeviceMetricsOverride");
  await tab("Network.setBypassServiceWorker", { bypass: false });
  await tab.goto(origin);
  await sleep(1500);
  const { errors } = await tab("Page.getAppManifest");
  const { installabilityErrors } = await tab("Page.getInstallabilityErrors");
  for (const problem of [...errors, ...installabilityErrors]) console.error("Manifest:", JSON.stringify(problem));
  if (errors.length || installabilityErrors.length) process.exitCode = 1;
  else console.log("Manifest: valid, and the app is installable");
  tab.close();
} finally {
  await browser.stop();
  server.closeAllConnections();
  server.close();
}
