# Prayer Times PWA (مواقيت الصلاة)

A lightweight, accurate, and offline-capable Progressive Web Application (PWA) for displaying prayer times, Hijri/Gregorian dates, and countdowns to the next prayer. Built with performance and user experience in mind.

## 🚀 Features

- **Accurate Prayer Times**: Calculations based on your location using the `adhan.js` library.
- **Offline Support**: Fully functional offline usage thanks to a robust Service Worker.
- **PWA support**: Installable on mobile and desktop devices.
- **Customizable**: Supports multiple calculation methods (Muslim World League, Umm Al-Qura, ISNA, etc.).
- **Themes**: Dark and Light mode support.
- **Arabic UI**: Designed with a clean Arabic interface (Right-to-Left).

## 🛠 Technologies Used

This project leverages modern web technologies to ensure speed, reliability, and ease of deployment.

### Core Stack
- **Vanilla JavaScript, HTML5, & CSS3**: No heavy frameworks, ensuring maximum performance and minimal bundle size.
- **[Adhan.js](https://github.com/batoulapps/adhan-js)**: A well-tested library for calculating prayer times.

### Progressive Web App (PWA)
- **Service Worker (`sw.js`)**: Implements advanced caching strategies:
  - **App Shell Strategy**: Caches critical assets (HTML, CSS, JS) on install for instant loading.
  - **Stale-While-Revalidate**: Updates non-critical assets in the background.
  - **Offline Fallback**: Serves a custom offline page if the network is unavailable.
- **Web App Manifest**: Ensures the app feels native with proper icons, theme colors, and display modes.

### DevOps & CI/CD
- **GitHub Actions**: A fully automated pipeline that **commits directly to production** (deploys to Cloudflare Pages).
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

This project is licensed under the ISC License.
