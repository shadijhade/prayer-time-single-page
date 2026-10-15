# <img src="src/favicon-96x96.png" width="32" height="32" style="vertical-align: middle;"> Prayer Times PWA (مواقيت الصلاة)

A lightweight, accurate, and offline-capable Progressive Web Application (PWA) for displaying prayer times, Hijri/Gregorian dates, and countdowns to the next prayer. Built with performance and user experience in mind.

## 🚀 Features

- **City-centre prayer times**: Your position is matched to your city's centre, like the timetables mosques publish, or you pick the city by hand. Times are calculated with `adhan.js`; a city picked by hand shows its own clock.
- **Checked against official timetables**: `node scripts/check-times.js` compares the app with the times 20 authorities publish for 23 cities: Umm al-Qura, Diyanet, JAKIM, MUIS, Kemenag, Egypt's Survey Authority, the Jordanian, Moroccan, Omani, Bahraini and Algerian ministries, Qatar, Banuri Town (Karachi), the Moonsighting Committee (London, New York), the UAE's Awqaf (Abu Dhabi, Dubai), Iraq's Sunni Endowment, Sudan's Fiqh Academy, Libya's Dar al-Ifta, Tunisia's meteorology institute and the Islamic Foundation Bangladesh. Every checked day is within a minute, or two for one day of Makkah and for Tunis's winter Asr. Kuwait and India aren't checked: neither publishes a timetable online that the check can use.
- **Private and free to run**: No third-party requests at all. City data, fonts and icons are served with the app, and your location never leaves the device.
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
- **Web App Manifest**: Ensures the app feels native with proper icons, theme colors, and display modes. The install dialog's screenshots (`src/screenshots/`) and the iPhone launch screens (`src/splash/`, one per screen size, listed in `IOS_LAUNCH_SCREEN_SIZES` in `app.js`) are images of the app: retake them when its look changes.

### City Data
`src/cities/` holds one JSON file per country with every place of 5,000+ people (Arabic name, coordinates, population, time zone), plus `index.json` with each country's bounding box. It is generated from [GeoNames](https://www.geonames.org/). To refresh it (downloads ~210 MB once, into the folder you pass):
```bash
python scripts/build-cities.py path/to/download-folder
```

### DevOps & CI/CD
- **GitHub Actions**: A fully automated pipeline that **commits directly to production** (deploys to Cloudflare Pages).
  - **Accuracy Check**: The workflow first runs `node scripts/check-times.js`. If the times drift from the official timetables, the build fails and nothing is deployed.
  - **Automated Minification**: The workflow automatically minifies HTML, CSS, and JavaScript files to optimize load times.
  - **Artifact Management**: Builds and uploads production-ready artifacts.
  - **Cloudflare Pages Deployment**: Deploys the optimized build directly to the global edge network.

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
