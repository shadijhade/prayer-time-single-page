// The prayer times calendar feed phones subscribe to (webcal://), as a Cloudflare Pages Function:
// GET /prayers.ics?lat=30.044&lon=31.236&method=Egyptian&madhab=Shafi&tz=Africa/Cairo&place=القاهرة، مصر
// The app's calendar sheet makes these links. Every refresh calculates the next FEED_DAYS days with
// the app's own code (src/prayer-rules.js), so a subscription never runs out; nothing is stored.
// Only this path runs the function (Pages routes it); the app itself stays static files.
import * as adhanModule from "../src/adhan.umd.js";
import prayerRules from "../src/prayer-rules.js";

// prayer-rules.js reads the global, as in the page. The bundle flags itself as an ES module, so
// Cloudflare's bundler gives its exports as the namespace, while Node gives them as the default
globalThis.adhan = adhanModule.default ?? adhanModule;

const FEED_DAYS = 30;
const PLACE_MAX_LENGTH = 100;

export function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const [latitude, longitude] = ["lat", "lon"].map((name) => Number(params.get(name) || NaN));
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) {
    return new Response("lat and lon are required, in degrees", { status: 400 });
  }
  let dayOf;
  try {
    dayOf = prayerRules.dayIn(params.get("tz") || "UTC");
  } catch {
    return new Response("tz is not a known time zone", { status: 400 });
  }
  const ics = prayerRules.calendarIcs({
    latitude,
    longitude,
    method: params.get("method"), // Unknown methods get the default
    madhab: params.get("madhab"),
    place: (params.get("place") || `${latitude}, ${longitude}`).slice(0, PLACE_MAX_LENGTH),
    now: new Date(),
    days: FEED_DAYS,
    dayOf,
    feed: true,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
