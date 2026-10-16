# <img src="src/favicon-96x96.png" width="32" height="32" style="vertical-align: middle;"> Prayer Times PWA (مواقيت الصلاة)

A lightweight, accurate, and offline-capable Progressive Web Application (PWA) for displaying prayer times, Hijri/Gregorian dates, and countdowns to the next prayer. Built with performance and user experience in mind.

## 🚀 Features

- **City-centre prayer times**: Your position is matched to your city's centre, like the timetables mosques publish, or you pick the city by hand. Times are calculated with `adhan.js`; a city picked by hand shows its own clock.
- **Checked against official timetables**: `node scripts/check-times.js` compares the app with the times 20 authorities publish for 23 cities: Umm al-Qura, Diyanet, JAKIM, MUIS, Kemenag, Egypt's Survey Authority, the Jordanian, Moroccan, Omani, Bahraini and Algerian ministries, Qatar, Banuri Town (Karachi), the Moonsighting Committee (London, New York), the UAE's Awqaf (Abu Dhabi, Dubai), Iraq's Sunni Endowment, Sudan's Fiqh Academy, Libya's Dar al-Ifta, Tunisia's meteorology institute and the Islamic Foundation Bangladesh. Every checked day is within a minute, or two for one day of Makkah and for Tunis's winter Asr. Kuwait and India aren't checked: neither publishes a timetable online that the check can use. The same check confirms that the compass reads the declination grid as the magnetic model gives it.
- **Qibla compass**: Points to the Kaaba from your city with the phone's compass, corrected from magnetic to true north with NOAA's World Magnetic Model, and gives the bearing and the distance. It says which way to turn and vibrates (Android) when you face the Qibla; on a device without a compass the dial shows north up.
- **Prayer reminders that never run out**: The phone's own calendar subscribes to a feed of the prayer times (iPhone, Mac, Google Calendar, Outlook...) and fetches the next 30 days again by itself every few hours, with an alarm at each prayer. No account, no push service, nothing stored: the feed is calculated on each request. A one-off file with 30 days is still there as a fallback.
- **Private and free to run**: No third-party requests at all. City data, fonts and icons are served with the app, and your location never leaves the device, except the city centre in a calendar subscription's link, which only this app's feed reads.
- **Offline Support**: The app opens from the Service Worker cache, so it starts instantly and works offline.
- **Installs like a native app**: Opens standalone on iPhone and Android, with a maskable icon, iPhone launch screens, a status bar in the header's colour and bottom sheets that close with a swipe. An install banner opens the browser's install dialog (with screenshots and a description on Android and desktop) or shows the Add to Home Screen steps on iPhone.
- **Customizable**: Multiple calculation methods (Muslim World League, Umm Al-Qura, Diyanet, JAKIM, Kemenag, Jordan, Morocco, Moonsighting Committee, etc.), chosen per country by default, plus a Shafi/Hanafi Asr setting. Country defaults and method details live in `src/prayer-rules.js`.
- **Themes**: Dark and Light mode support.
- **Arabic UI**: Designed with a clean Arabic interface (Right-to-Left).


## 📸 Screenshots

<p align="center">
  <img src="resources/screenshot-light.png" width="45%" alt="Light Mode">
  &nbsp; &nbsp;
  <img src="resources/screenshot-dark.png" width="45%" alt="Dark Mode">
</p>

## 🛠 Technologies Used

This project leverages modern web technologies to ensure speed, reliability, and ease of deployment.

### Core Stack
- **Vanilla JavaScript, HTML5, & CSS3**: No heavy frameworks, ensuring maximum performance and minimal bundle size.
- **[Adhan.js](https://github.com/batoulapps/adhan-js)**: A well-tested library for calculating prayer times.

### Progressive Web App (PWA)
- **Service Worker (`sw.js`)**:
  - **App Shell, cache-first**: The page, scripts, styles and fonts are cached on install, so launches never wait on the network. Bump `APP_SHELL_CACHE_NAME` whenever one of them changes.
  - **Stale-While-Revalidate**: City files are cached on first use and refreshed in the background.
- **Web App Manifest**: Ensures the app feels native with proper icons, theme colors, and display modes, plus screenshots for the install dialog (see Install Images below).

### Calendar Feed
`functions/prayers.ics.js` is a [Cloudflare Pages Function](https://developers.cloudflare.com/pages/functions/) at `/prayers.ics?lat=&lon=&method=&madhab=&tz=&place=`, the only path that isn't a static file. It builds the calendar with the app's own code (`calendarIcs()` in `src/prayer-rules.js`, which the app's download uses too), so it stays within Cloudflare's free tier. The deploy job bundles it from the repository. To run the site with it locally:
```bash
npx wrangler pages dev src
```

### City Data
`src/cities/` holds one JSON file per country with every place of 5,000+ people (Arabic name, coordinates, population, time zone), plus `index.json` with each country's bounding box. It is generated from [GeoNames](https://www.geonames.org/). To refresh it (downloads ~210 MB once, into the folder you pass):
```bash
python scripts/build-cities.py path/to/download-folder
```

### Magnetic Declination
`src/declination.json` is the declination (degrees east of true north) on a 5° grid, for the middle of the [World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model)'s validity (WMM2025: 2025 to 2030). It's within 1.5° of the model between 55°S and 60°N. Rebuild it from the coefficients zip; with the test values file the model is first checked against NOAA's results:
```bash
python scripts/build-declination.py path/to/WMM2025.COF path/to/WMM2025_TestValues.txt
```

### Install Images
The install dialog's screenshots (`src/screenshots/`), the iPhone launch screens (`src/splash/`, one per size in `IOS_LAUNCH_SCREEN_SIZES` in `app.js`) and the maskable, iPhone and shortcut icons are drawn from the app itself. Retake them when its look changes; the script drives the installed Chrome or Edge (set `CHROME` to its path if it isn't found) and checks that Chrome still finds the app installable:
```bash
node scripts/make-install-assets.mjs
```

### DevOps & CI/CD
- **GitHub Actions**: A fully automated pipeline that **commits directly to production** (deploys to Cloudflare Pages).
  - **Accuracy Check**: The workflow first runs `node scripts/check-times.js`. If the times drift from the official timetables, the build fails and nothing is deployed.
  - **Automated Minification**: The workflow automatically minifies HTML, CSS, and JavaScript files to optimize load times.
  - **Artifact Management**: Builds and uploads production-ready artifacts.
  - **Cloudflare Pages Deployment**: Deploys the optimized build directly to the global edge network, with the calendar feed's function.

## 📦 Installation & Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/shadijhade/prayer-time-single-page.git
   cd prayer-time-single-page
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run local server**:
   You can use any static file server, for example:
   ```bash
   npx http-server src
   ```

## 🚀 Deployment

The deployment process is completely automated via **GitHub Actions**.

1. **Push changes** to the `main` branch.
2. The **Build and Deploy** workflow triggers automatically.
3. It performs the following steps:
   - **Checkout**: Pulls the latest code.
   - **Minify**: Runs `html-minifier-terser`, `csso-cli`, and `terser` to compress assets.
   - **Deploy**: Publishes the optimized `dist` folder to **Cloudflare Pages**.

No manual build or upload steps are required.

## 📄 License

This project is licensed under the ISC License. Bundled third-party material:
- City data © [GeoNames](https://www.geonames.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Tajawal](https://fonts.google.com/specimen/Tajawal) font, SIL Open Font License (`src/fonts/OFL.txt`).
- [Material Symbols](https://fonts.google.com/icons) icons, Apache License 2.0.
- Magnetic declination from the [World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model) (NOAA NCEI and the British Geological Survey), public domain.
