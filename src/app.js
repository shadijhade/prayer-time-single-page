(function () {
  "use strict";

  // ==============================================
  //          Constants & Configuration
  // ==============================================

  // --- Storage Keys ---
  const STORAGE_KEY_THEME = "theme-preference";
  // Older versions saved auto-picked methods here too; it's read only while the location's country is unknown
  const STORAGE_KEY_PRAYER_METHOD = "preferredPrayerMethod";
  const STORAGE_KEY_METHOD_CHOICE = "methodChoice"; // Saved only when the user picks a method
  const STORAGE_KEY_MADHAB_CHOICE = "madhabChoice"; // Saved only when the user picks the Asr madhab
  const STORAGE_KEY_LAST_LOCATION = "lastKnownLocation";
  // Older versions cached reverse-geocode lookups under this prefix; they're deleted on start
  const STORAGE_KEY_LOCATION_CACHE_PREFIX = "locationDataCache_";
  const STORAGE_KEY_INSTALL_DISMISSED = "installBannerDismissed";

  // --- Default Values ---
  // Country defaults and the Adhan.js setup live in prayer-rules.js (loaded first)
  const DEFAULT_PRAYER_METHOD = prayerRules.DEFAULT_METHOD;

  // --- Timing & Duration ---
  const TOAST_TRANSITION_DURATION_MS = 350; // Match CSS transition
  const PRAYER_STARTED_MESSAGE_MS = 60000; // "حان الآن وقت صلاة ..." shows for the first minute
  const CALENDAR_DAYS = 30; // Days of prayers in the calendar file
  const CALENDAR_EVENT_MS = 15 * 60000; // Length of each prayer's calendar event
  // A coarse (Wi-Fi/cell) position arrives quickly and is plenty to find the city
  const GEOLOCATION_OPTIONS = {
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 5 * 60 * 1000,
  };

  // --- Paths ---
  const SERVICE_WORKER_PATH = "sw.js";
  const CITIES_PATH = "cities/"; // Built from GeoNames by scripts/build-cities.py

  // --- Installed App ---
  // iPhone screens in device pixels, portrait (iPhone 6s to 17 and Air), with launch screens in
  // splash/<size>-light.jpg and -dark.jpg; iPads and new sizes get none until added here (then run
  // scripts/make-install-assets.mjs to draw them)
  const IOS_LAUNCH_SCREEN_SIZES = [
    "750x1334", "828x1792", "1125x2436", "1170x2532", "1179x2556", "1206x2622",
    "1242x2208", "1242x2688", "1260x2736", "1284x2778", "1290x2796", "1320x2868",
  ];
  const SHEET_CLOSE_DRAG_PX = 80; // A sheet dragged down farther than this closes

  // --- City Centres ---
  // Times are calculated for the user's city centre, like the timetables mosques publish
  const CITY_SNAP_RADIUS_KM = 15; // The most populous place this close is the user's city
  const CITY_MAX_DISTANCE_KM = 30; // Farther than this from every city: use the position itself

  // --- CSS Classes & Selectors ---
  const CSS_DARK_THEME = "dark-theme";
  const CSS_LIGHT_THEME = "light-theme";
  const CSS_THEME_TRANSITION = "theme-vt"; // On <html> while the theme View Transition runs
  const CSS_ACTIVE = "active";
  const CSS_PASSED = "passed";
  const CSS_SKELETON = "skeleton";
  const CSS_SKELETON_TEXT = "skeleton-text";
  const CSS_TOAST_SHOW = "show";
  // Selectors
  const SEL_PRAYER_CARD = ".prayer-card";
  const SEL_PRAYER_TIME = ".prayer-time";
  const SEL_TOAST_MESSAGE = ".toast-message";
  const SEL_TOAST_CLOSE = ".toast-close";
  const SEL_BTN_TEXT = ".btn-text";

  // --- Icon Strings ---
  // Icons are <symbol>s in index.html's sprite (#icon-<name>)
  const svgIcon = (name, className = "") =>
    `<svg class="icon ${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const ICON_SPINNER = svgIcon("progress_activity", "icon-spin");
  const ICON_ERROR = svgIcon("error", "icon-error");
  const ICON_WARNING = svgIcon("warning", "icon-warning");
  const ICON_SUCCESS = svgIcon("check_circle", "icon-success");
  const ICON_INFO = svgIcon("info", "icon-info");
  const ICON_LOCATION = svgIcon("my_location");

  // --- Prayer Data ---
  const PRAYER_NAMES_AR = {
    fajr: "الفجر",
    sunrise: "الشروق",
    dhuhr: "الظهر",
    asr: "العصر",
    sunset: "الغروب",
    maghrib: "المغرب",
    isha: "العشاء",
    none: "لا يوجد",
  };
  const PRAYER_DISPLAY_ORDER = [
    "fajr",
    "sunrise",
    "dhuhr",
    "asr",
    "maghrib",
    "isha",
  ];
  // One Hijri calendar for the header date and the Ramadan/Eid countdown
  const HIJRI_CALENDAR = "islamic-umalqura";
  // Occasions as Hijri (month, day); the greeting replaces the countdown on the day itself
  const HIJRI_OCCASIONS = [
    { month: 9, day: 1, name: "رمضان", greeting: "رمضان مبارك" },
    { month: 10, day: 1, name: "عيد الفطر", greeting: "عيد فطر مبارك" },
    { month: 12, day: 10, name: "عيد الأضحى", greeting: "عيد أضحى مبارك" },
  ];

  // ==============================================
  //          Application State
  // ==============================================
  const appState = {
    loadingToastElement: null,
    toastContainerElement: null,
    countdownIntervalId: null,
    countdownHost: window, // Window whose timer drives the countdown (the PiP window while open)
    currentLocation: null,
    currentPrayerTimes: null,
    prayerTimeline: null, // [{ key, time, tomorrow? }] from yesterday's Isha to tomorrow's Fajr
    timelineDay: null, // toDateString() of the day the timeline was calculated on
    nextPrayer: null, // Timeline entry the countdown currently targets
    pipWindow: null, // Open Document Picture-in-Picture window, if any
    isMouseEffectEnabled: false,
    mouseEffectRAFId: null,
    isUpdateAvailable: false,
    waitingServiceWorker: null,
    pickerCities: null, // { countryCode, tz, cities } of the country shown in the city picker
  };

  // ==============================================
  //          DOM Element References (Cached)
  // ==============================================
  const domRefs = {}; // Use 'domRefs' for clarity

  /**
   * Caches references to frequently used DOM elements.
   * Should be called once on initialization.
   */
  function cacheDOMElements() {
    domRefs.themeToggle = document.getElementById("themeToggle");
    domRefs.htmlElement = document.documentElement;
    domRefs.locationButton = document.getElementById("use-location-btn");
    domRefs.locationSpan = document.getElementById("location");
    domRefs.prayerTimesContainer = document.getElementById(
      "prayer-times-container"
    );
    domRefs.nextPrayerInfo = document.getElementById("next-prayer-info");
    domRefs.nextPrayerName = document.getElementById("next-prayer-name");
    domRefs.countdown = document.getElementById("countdown");
    domRefs.countdownProgress = document.getElementById("countdown-progress");
    domRefs.stickyCountdown = document.getElementById("sticky-countdown");
    domRefs.stickyNextPrayer = document.getElementById("sticky-next-prayer");
    domRefs.stickyCountdownTime = document.getElementById(
      "sticky-countdown-time"
    );
    domRefs.titlebarPrayer = document.getElementById("titlebar-prayer");
    domRefs.titlebarTime = document.getElementById("titlebar-time");
    domRefs.installButton = document.getElementById("install-btn");
    domRefs.installBanner = document.getElementById("install-banner");
    domRefs.installDismiss = document.getElementById("install-dismiss");
    domRefs.iosInstallSheet = document.getElementById("ios-install-sheet");
    domRefs.occasionCountdown = document.getElementById("occasion-countdown");
    domRefs.occasionText = document.getElementById("occasion-text");
    domRefs.pipButton = document.getElementById("pip-btn");
    domRefs.methodSelect = document.getElementById("method-select");
    domRefs.madhabSelect = document.getElementById("madhab-select");
    domRefs.countdownDescription = document.getElementById(
      "countdown-description"
    );
    domRefs.currentYear = document.getElementById("current-year");
    domRefs.cursorLight = document.getElementById("cursor-light");
    domRefs.mainElement = document.querySelector("main");
    domRefs.updateNotification = document.getElementById("update-notification");
    domRefs.updateButton = document.getElementById("update-button");
    domRefs.dayOfWeek = document.getElementById("day-of-week");
    domRefs.gregorianDate = document.getElementById("gregorian-date");
    domRefs.hijriDate = document.getElementById("hijri-date");
    domRefs.showForecastBtn = document.getElementById("show-forecast-btn");
    domRefs.calendarBtn = document.getElementById("calendar-btn");
    domRefs.forecastSheet = document.getElementById("forecast-sheet");
    domRefs.forecastContainer = document.getElementById(
      "forecast-table-container"
    );
    domRefs.citySheet = document.getElementById("city-sheet");
    domRefs.cityForm = document.getElementById("city-form");
    domRefs.countrySelect = document.getElementById("country-select");
    domRefs.cityInput = document.getElementById("city-input");
    domRefs.cityList = document.getElementById("city-list");
  }

  // ==============================================
  //          Utility Functions
  // ==============================================
  // Native Arabic plurals ("دقيقتان", "3 دقائق", "11 دقيقة"...); undefined in very old browsers
  const remainingTimeFormat =
    Intl.DurationFormat &&
    new Intl.DurationFormat("ar-u-nu-latn", { style: "long" });

  const countryNames = new Intl.DisplayNames(["ar"], { type: "region" });

  /**
   * The time zone to show times in: a city picked by hand shows its own clock; otherwise the user
   * is there, so the device's zone (undefined) is right and survives outdated time zone data.
   */
  const locationTimeZone = () =>
    appState.currentLocation?.manual ? appState.currentLocation.timeZone : undefined;

  const dayFormats = {}; // "YYYY-MM-DD" formatters by time zone
  /**
   * The calendar day it is in the location's time zone, as a local Date at noon: the form Adhan.js
   * expects, and noon keeps DST shifts from moving it to another day.
   * @param {Date} instant - Usually now.
   * @param {number} [offsetDays=0] - Days to add.
   * @returns {Date}
   */
  function locationDay(instant, offsetDays = 0) {
    const timeZone = locationTimeZone();
    dayFormats[timeZone] ??= new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const [year, month, day] = dayFormats[timeZone].format(instant).split("-");
    return new Date(year, month - 1, Number(day) + offsetDays, 12);
  }

  /**
   * Formats the remaining time as descriptive Arabic text, ignoring seconds.
   * @param {number} totalSeconds - Remaining time in seconds.
   * @returns {string} e.g. "متبقي ساعة و15 دقيقة", "متبقي أقل من دقيقة", or "" if unsupported.
   */
  function formatRemainingText(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const text =
      hours || minutes
        ? remainingTimeFormat?.format({ hours, minutes })
        : "أقل من دقيقة";
    return text ? "متبقي " + text : "";
  }

  /**
   * Sets textContent only when it changed, so live regions don't re-announce the same text.
   * @param {HTMLElement | null} element
   * @param {string} text
   */
  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  /**
   * Runs a DOM update inside a View Transition where supported (instantly elsewhere).
   * A skipped transition (hidden tab, a newer transition) only rejects `ready`; that's expected.
   * @param {Function} update - The DOM update.
   * @returns {ViewTransition | undefined}
   */
  function withViewTransition(update) {
    if (!document.startViewTransition) {
      update();
      return undefined;
    }
    const transition = document.startViewTransition(update);
    transition.ready.catch(() => {});
    return transition;
  }

  /**
   * Checks if a value is a valid Date object.
   * @param {*} d - Value to check.
   * @returns {boolean} True if d is a valid Date.
   */
  function isValidDate(d) {
    return d instanceof Date && !isNaN(d.getTime());
  }

  /**
   * Formats a Date object for display (e.g., "5:30 م").
   * Uses Intl for localization if available, otherwise fallback.
   * @param {Date} date - The date object to format.
   * @returns {string} Formatted time string or '--:--'.
   */
  function formatTimeForDisplay(date) {
    if (!isValidDate(date)) return "--:--";
    try {
      // 'ar' locale, Latin numerals (easier alignment), 12-hour format
      // nu-latn ensures Western digits 0-9
      return date.toLocaleTimeString("ar-u-nu-latn", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: locationTimeZone(), // A city picked in another zone shows its own clock
      });
      // Note: Manual AM/PM replacement (ص/م) might be needed if the browser/OS
      // doesn't provide it correctly with 'ar' locale, but try Intl first.
      // e.g., .replace(/AM/i, 'ص').replace(/PM/i, 'م');
    } catch (e) {
      console.error("Intl formatting failed for time:", e);
      // Fallback to simple 24-hour HH:MM
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    }
  }

  // ==============================================
  //          Theme Management
  // ==============================================

  /**
   * Gets the preferred theme ('light' or 'dark') from localStorage or system preference.
   * @returns {'light' | 'dark'} The preferred theme.
   */
  function getPreferredTheme() {
    const storedTheme = localStorage.getItem(STORAGE_KEY_THEME);
    if (storedTheme) {
      return storedTheme;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  /**
   * Applies the specified theme to the UI.
   * @param {'light' | 'dark'} theme - The theme to apply.
   */
  function applyTheme(theme) {
    if (!domRefs.htmlElement) return;
    // The class sets color-scheme, which flips every light-dark() color in style.css
    domRefs.htmlElement.classList.toggle(CSS_DARK_THEME, theme === "dark");
    domRefs.htmlElement.classList.toggle(CSS_LIGHT_THEME, theme === "light");
    // Keep an open PiP countdown window in the same theme
    if (appState.pipWindow) {
      appState.pipWindow.document.documentElement.className =
        domRefs.htmlElement.className;
    }
    // Update toggle state visually
    if (domRefs.themeToggle) {
      domRefs.themeToggle.checked = theme === "light";
    }
    // The status bar and browser toolbar take the header's color (--card-background), so they
    // read as one surface; both metas, since the toggle can differ from the OS theme they match
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.content = theme === "dark" ? "#1e293b" : "#ffffff";
    });
  }

  /**
   * Switches the theme inside a View Transition: the new theme is revealed in a circle
   * growing from the toggle (.theme-vt in style.css). Instant where unsupported.
   * @param {'light' | 'dark'} theme - The theme to switch to.
   */
  function switchThemeWithTransition(theme) {
    const root = domRefs.htmlElement;
    if (!document.startViewTransition) {
      applyTheme(theme);
      return;
    }
    const rect = domRefs.themeToggle.getBoundingClientRect();
    root.style.setProperty("--vt-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--vt-y", `${rect.top + rect.height / 2}px`);
    root.classList.add(CSS_THEME_TRANSITION);
    withViewTransition(() => applyTheme(theme)).finished.finally(() =>
      root.classList.remove(CSS_THEME_TRANSITION)
    );
  }

  /** Sets up the theme toggle functionality. */
  function setupThemeSwitcher() {
    if (!domRefs.themeToggle) return; // Only setup if toggle exists

    applyTheme(getPreferredTheme()); // Apply initial theme

    domRefs.themeToggle.addEventListener("change", () => {
      const newTheme = domRefs.themeToggle.checked ? "light" : "dark";
      switchThemeWithTransition(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY_THEME, newTheme);
      } catch (e) {
        console.error("Failed to save theme preference:", e);
      }
    });
  }

  // ==============================================
  //          Toast Notifications
  // ==============================================

  /**
   * Ensures the toast container element exists and returns it.
   * @returns {HTMLElement | null} The toast container element or null if creation fails.
   */
  function ensureToastContainer() {
    if (!appState.toastContainerElement) {
      appState.toastContainerElement =
        document.getElementById("toast-container");
      if (!appState.toastContainerElement) {
        try {
          const container = document.createElement("div");
          container.id = "toast-container";
          // Accessibility: Region for announcements
          container.setAttribute("aria-live", "polite");
          container.setAttribute("aria-atomic", "false"); // Announce toasts individually
          document.body.appendChild(container);
          appState.toastContainerElement = container;
        } catch (e) {
          console.error("Failed to create toast container:", e);
          return null;
        }
      }
    }
    return appState.toastContainerElement;
  }

  /**
   * Displays a toast notification.
   * @param {string} message - The message to display.
   * @param {'info' | 'success' | 'warning' | 'error' | 'loading'} type - Toast type.
   * @param {number} [duration=4000] - Duration in ms. 0 for persistent (until dismissed).
   * @returns {HTMLElement | null} The created toast element or null on failure.
   */
  function showToast(message, type = "info", duration = 4000) {
    const container = ensureToastContainer();
    if (!container) {
      console.error("Cannot show toast, container missing.");
      return null;
    }

    const toastElement = document.createElement("div");
    toastElement.className = `toast toast-${type}`;
    // Role: alert for errors/success, status for info/warnings/loading
    toastElement.setAttribute(
      "role",
      type === "error" || type === "success" ? "alert" : "status"
    );
    // Note: The container already has aria-live, individual roles help clarify importance.

    const icons = {
      loading: ICON_SPINNER,
      error: ICON_ERROR,
      success: ICON_SUCCESS,
      warning: ICON_WARNING,
      info: ICON_INFO,
    };

    // Use textContent for the message part for security and performance.
    // Use innerHTML for the parts definitely containing HTML (icons).
    toastElement.innerHTML = `
            <span class="toast-glyphy" aria-hidden="true">${
              icons[type] || icons.info
            }</span>
            <span class="${SEL_TOAST_MESSAGE.substring(1)}"></span>
            <button class="${SEL_TOAST_CLOSE.substring(
              1
            )}" aria-label="إغلاق الإشعار">×</button>
        `;
    toastElement.querySelector(SEL_TOAST_MESSAGE).textContent = message; // Set message safely
    toastElement
      .querySelector(SEL_TOAST_CLOSE)
      .addEventListener("click", () => dismissToast(toastElement));

    container.appendChild(toastElement);

    // Trigger CSS transition
    requestAnimationFrame(() => {
      toastElement.classList.add(CSS_TOAST_SHOW);
    });

    if (duration > 0) {
      // Store timeout ID on the element for potential cancellation
      toastElement.dismissTimeoutId = setTimeout(
        () => dismissToast(toastElement),
        duration
      );
    }

    // If it's a persistent loading toast, store its reference
    if (type === "loading" && duration === 0) {
      // Dismiss previous loading toast if any
      dismissLoadingToast();
      appState.loadingToastElement = toastElement;
    }

    return toastElement;
  }

  /**
   * Dismisses a specific toast element with animation.
   * @param {HTMLElement | null} toastElement - The toast element to dismiss.
   */
  function dismissToast(toastElement) {
    if (!toastElement || !toastElement.parentNode) return;

    // Clear any pending auto-dismiss timeout
    if (toastElement.dismissTimeoutId) {
      clearTimeout(toastElement.dismissTimeoutId);
      delete toastElement.dismissTimeoutId; // Clean up property
    }

    // If this was the persistent loading toast, clear the reference
    if (toastElement === appState.loadingToastElement) {
      appState.loadingToastElement = null;
    }

    toastElement.classList.remove(CSS_TOAST_SHOW);

    // Remove from DOM after transition
    setTimeout(() => {
      toastElement.remove();
      // Optional: Clean up container if empty (consider if container is reused)
      // if (appState.toastContainerElement?.childElementCount === 0) {
      //     appState.toastContainerElement.remove();
      //     appState.toastContainerElement = null;
      // }
    }, TOAST_TRANSITION_DURATION_MS + 50); // Add slight buffer
  }

  /**
   * Dismisses the persistent loading toast, optionally showing a success message briefly.
   * @param {string | null} [successMessage=null] - If provided, update toast text before dismissing.
   */
  function dismissLoadingToast(successMessage = null) {
    const loadingToast = appState.loadingToastElement; // Use stored reference
    if (loadingToast && loadingToast.parentNode) {
      if (successMessage) {
        const msgSpan = loadingToast.querySelector(SEL_TOAST_MESSAGE);
        if (msgSpan) msgSpan.textContent = successMessage;
        // Optionally change type/icon here (e.g., to success)
        // loadingToast.className = 'toast toast-success show'; // Keep 'show'
        // loadingToast.querySelector('.toast-glyphy').innerHTML = ICON_SUCCESS;
        // Give time to see the success message before dismissing
        clearTimeout(loadingToast.dismissTimeoutId); // Clear original persistent timeout
        loadingToast.dismissTimeoutId = setTimeout(
          () => dismissToast(loadingToast),
          1500
        ); // Dismiss after 1.5s
      } else {
        // Dismiss immediately if no success message
        dismissToast(loadingToast);
      }
    }
    appState.loadingToastElement = null; // Ensure reference is cleared
  }

  // ==============================================
  //          Location Handling & Geocoding
  // ==============================================

  /** Handles the click event for the location button. */
  function handleLocationButtonClick() {
    dismissLoadingToast(); // Clear previous loading toast if any
    setUILoadingState(true, "جاري تحديد الموقع..."); // Set loading state with specific message
    getLocation();
  }

  /**
   * Updates the UI to reflect loading/idle state for location fetching.
   * @param {boolean} isLoading - True if loading, false otherwise.
   * @param {string} [loadingMessage=''] - Message to display while loading.
   */
  function setUILoadingState(isLoading, loadingMessage = "") {
    if (isLoading) {
      if (domRefs.locationButton) {
        domRefs.locationButton.disabled = true;
        // Use textContent for the text part
        domRefs.locationButton.innerHTML = `${ICON_SPINNER} <span class="${SEL_BTN_TEXT.substring(
          1
        )}"></span>`;
        const textSpan = domRefs.locationButton.querySelector(SEL_BTN_TEXT);
        if (textSpan)
          textSpan.textContent = loadingMessage || "جاري المعالجة...";
      }
      // Update location display span
      // **Accessibility:** Add aria-live="polite" to the HTML #location span
      // <span id="location" aria-live="polite">---</span>
      if (domRefs.locationSpan) {
        domRefs.locationSpan.textContent = loadingMessage || "جاري المعالجة...";
      }
      // Show persistent loading toast if not already showing one for this process
      if (!appState.loadingToastElement) {
        showToast(loadingMessage || "جاري المعالجة...", "loading", 0);
      }
      setPrayerTimesSkeletonState(true); // Show skeleton UI for prayer times
      // Accessibility: Indicate the prayer times section is busy
      domRefs.prayerTimesContainer?.setAttribute("aria-busy", "true");
    } else {
      // Dismiss general loading toast *only if* it wasn't replaced by a success/error specific one
      dismissLoadingToast();
      enableLocationButton(); // Reset button state (enabled, default text)
      // Accessibility: Indicate the prayer times section is no longer busy
      domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false");
    }
  }

  /** Initiates the browser's geolocation request. */
  function getLocation() {
    if (!navigator.geolocation) {
      handleLocationError({
        code: -1,
        message: "Geolocation API not supported",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      handleLocationSuccess,
      handleLocationError,
      GEOLOCATION_OPTIONS
    );
  }

  /**
   * Success callback for geolocation: calculates for the user's city centre.
   * @param {GeolocationPosition} position - The position object from the browser.
   */
  async function handleLocationSuccess(position) {
    const { latitude, longitude } = position.coords;
    let location;
    try {
      location = await locateCity(latitude, longitude);
    } catch (error) {
      // Offline before the city files were ever cached: use the position, same country as before
      console.error("City data unavailable:", error);
      location = positionLocation(
        latitude,
        longitude,
        appState.currentLocation?.countryCode
      );
    }
    dismissLoadingToast(`تم تحديد الموقع: ${location.displayText}`);
    setLocation(location);
  }

  /**
   * Error callback for geolocation. Keeps the previous location's times, if any.
   * @param {GeolocationPositionError | {code: number, message: string}} error - The error object.
   */
  function handleLocationError(error) {
    dismissLoadingToast(); // Ensure loading toast is removed on error
    console.error("Geolocation error:", error.code, error.message);

    let userMessage = "تعذر تحديد الموقع.";
    switch (error.code) {
      case error.PERMISSION_DENIED:
        userMessage = "تم رفض إذن تحديد الموقع.";
        break;
      case error.POSITION_UNAVAILABLE:
        userMessage = "معلومات الموقع غير متوفرة حالياً.";
        break;
      case error.TIMEOUT:
        userMessage = "انتهت مهلة طلب تحديد الموقع.";
        break;
      case -1:
        userMessage = "خدمة تحديد الموقع غير مدعومة في هذا المتصفح.";
        break; // Custom code
      default:
        userMessage = `حدث خطأ غير معروف في تحديد الموقع (${error.code}).`;
    }
    showToast(`${userMessage} يمكنك اختيار مدينتك يدويًا.`, "error", 0);

    if (appState.currentLocation) {
      setLocation(appState.currentLocation);
    } else {
      if (domRefs.locationSpan) domRefs.locationSpan.textContent = "---";
      setPrayerTimesSkeletonState(true); // Also stops the countdown and clears the times
      domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // No longer busy (failed)
    }
    enableLocationButton(true, "فشل، حاول مرة أخرى"); // Show error state on button
  }

  // ==============================================
  //          City Centres (GeoNames data in cities/)
  // ==============================================

  /**
   * Fetches cities/index.json (each country's bounding box) or a country's file,
   * { tz: [time zones], cities: [[Arabic name or "", name, latitude, longitude, population, tz index]] }
   * with the largest cities first. The service worker keeps them for offline use.
   * @param {string} file - e.g. "index.json" or "EG.json".
   */
  async function fetchCityFile(file) {
    const response = await fetch(CITIES_PATH + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return response.json();
  }

  /** Approximate distance in km, accurate enough over the few kilometres that matter here. */
  function distanceKm(lat1, lon1, lat2, lon2) {
    const dLon = ((lon2 - lon1 + 540) % 360) - 180; // The short way, also across the antimeridian
    const x = dLon * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    return Math.hypot(x, lat2 - lat1) * 111.2;
  }

  /** Whether a position is in an index.json box; east exceeds 180 for boxes across the antimeridian. */
  function isInBox([south, west, north, east], latitude, longitude) {
    return (
      latitude >= south &&
      latitude <= north &&
      [longitude, longitude + 360].some((lon) => lon >= west && lon <= east)
    );
  }

  /**
   * Finds the user's city: the most populous place within CITY_SNAP_RADIUS_KM, else the nearest
   * one within CITY_MAX_DISTANCE_KM.
   * ponytail: country bounding boxes, so border areas load a few country files; tile the data if that gets slow
   * @returns {Promise<object>} A location (see setLocation) at the city's centre, or at the
   *   position itself when no city is close enough.
   */
  async function locateCity(latitude, longitude) {
    const index = await fetchCityFile("index.json");
    const countries = await Promise.all(
      Object.keys(index)
        .filter((code) => isInBox(index[code], latitude, longitude))
        .map(async (code) => ({ code, ...(await fetchCityFile(`${code}.json`)) }))
    );
    let largest = null;
    let closest = null;
    for (const { code, tz, cities } of countries) {
      for (const row of cities) {
        const city = {
          row,
          code,
          tz,
          distance: distanceKm(latitude, longitude, row[2], row[3]),
        };
        if (
          city.distance <= CITY_SNAP_RADIUS_KM &&
          (!largest || row[4] > largest.row[4])
        ) {
          largest = city;
        }
        if (!closest || city.distance < closest.distance) closest = city;
      }
    }
    const city =
      largest || (closest?.distance <= CITY_MAX_DISTANCE_KM ? closest : null);
    if (city) return cityLocation(city.row, city.code, city.tz);
    return {
      ...positionLocation(latitude, longitude, closest?.code),
      timeZone: closest?.tz[closest.row[5]],
    };
  }

  /**
   * A location at a city's centre.
   * @param {Array} row - A row of a country file.
   * @param {string} countryCode - The file's country (ISO 3166-1 alpha-2).
   * @param {string[]} timeZones - The file's tz list.
   */
  function cityLocation(
    [nameAr, name, latitude, longitude, , tzIndex],
    countryCode,
    timeZones
  ) {
    return {
      latitude,
      longitude,
      countryCode,
      timeZone: timeZones[tzIndex],
      displayText: `${nameAr || name}، ${countryNames.of(countryCode)}`,
    };
  }

  /** A location at the position itself, rounded to ~1 km, for when no city is close enough. */
  function positionLocation(latitude, longitude, countryCode) {
    return {
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
      countryCode,
      displayText: countryCode
        ? `موقعك الحالي، ${countryNames.of(countryCode)}`
        : "موقعك الحالي",
    };
  }

  /**
   * Shows, saves and calculates the times for a location.
   * @param {{latitude: number, longitude: number, displayText: string, countryCode?: string,
   *   timeZone?: string, manual?: boolean}} location - manual: picked by hand, so it's never moved automatically.
   */
  function setLocation(location) {
    appState.currentLocation = location;
    if (domRefs.locationSpan) domRefs.locationSpan.textContent = location.displayText;
    try {
      localStorage.setItem(STORAGE_KEY_LAST_LOCATION, JSON.stringify(location));
    } catch (error) {
      console.error("Failed to save the location:", error);
    }
    updateDates(); // The header dates follow the location's time zone
    calculateAndDisplayPrayerTimes(
      location.latitude,
      location.longitude,
      applyLocationDefaults(location.countryCode)
    );
  }

  /**
   * On start, quietly moves an automatic location to the user's current city when location
   * access was granted before, so travellers get the right times without pressing anything.
   */
  async function refreshCityInBackground() {
    if (appState.currentLocation?.manual || !navigator.geolocation) return;
    const permission = await navigator.permissions
      ?.query({ name: "geolocation" })
      .catch(() => null);
    if (permission?.state !== "granted") return;
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const location = await locateCity(coords.latitude, coords.longitude).catch(
          () => null
        );
        const current = appState.currentLocation;
        if (!location || current?.manual) return;
        if (
          location.latitude === current?.latitude &&
          location.longitude === current?.longitude
        ) {
          return;
        }
        setLocation(location);
        showToast(`تم تحديث الموقع: ${location.displayText}`, "info");
      },
      () => {}, // Keep the saved location
      GEOLOCATION_OPTIONS
    );
  }

  // ==============================================
  //          Manual City Picker
  // ==============================================

  /** Fills the country list the first time the picker opens, then the chosen country's cities. */
  async function handleCityPickerToggle(event) {
    if (event.newState !== "open" || domRefs.countrySelect.options.length) return;
    try {
      const index = await fetchCityFile("index.json");
      const options = Object.keys(index)
        .map((code) => new Option(countryNames.of(code), code))
        .sort((a, b) => a.text.localeCompare(b.text, "ar"));
      domRefs.countrySelect.append(...options);
      domRefs.countrySelect.value =
        appState.currentLocation?.countryCode ||
        new Intl.Locale(navigator.language).maximize().region;
      domRefs.countrySelect.value ||= options[0].value;
      await loadPickerCities();
    } catch (error) {
      console.error("City list unavailable:", error);
      showToast("تعذر تحميل قائمة المدن.", "error");
    }
  }

  /** Loads the selected country's cities as the city field's suggestions (largest first). */
  async function loadPickerCities() {
    const countryCode = domRefs.countrySelect.value;
    domRefs.cityInput.value = "";
    domRefs.cityList.replaceChildren();
    const data = await fetchCityFile(`${countryCode}.json`);
    if (domRefs.countrySelect.value !== countryCode) return; // Another country was picked meanwhile
    appState.pickerCities = { countryCode, ...data };
    domRefs.cityList.replaceChildren(
      ...data.cities.map(
        ([nameAr, name]) => new Option(nameAr ? name : "", nameAr || name)
      )
    );
  }

  /** Calculates for the city chosen in the picker; being manual, it's kept on later starts. */
  function handleCityPick(event) {
    event.preventDefault();
    const { countryCode, tz, cities = [] } = appState.pickerCities || {};
    const value = domRefs.cityInput.value.trim();
    // ponytail: places sharing a name resolve to the most populous one; add regions to the names if that bites
    const row = cities.find(
      ([nameAr, name]) => value === (nameAr || name) || value === name
    );
    if (!row) {
      domRefs.cityInput.setCustomValidity("اختر مدينة من القائمة.");
      domRefs.cityInput.reportValidity();
      return;
    }
    domRefs.citySheet.hidePopover();
    setLocation({ ...cityLocation(row, countryCode, tz), manual: true });
  }

  // ==============================================
  //          Prayer Times Calculation & Display
  // ==============================================

  /** Fills the method and madhab dropdowns and recalculates when the user picks another value. */
  function setupMethodSelect() {
    if (!domRefs.methodSelect) {
      console.warn("Calculation method select not found.");
      return;
    }
    applyLocationDefaults();
    domRefs.methodSelect.addEventListener("change", handleMethodChange);
    domRefs.madhabSelect?.addEventListener("change", handleMethodChange);
  }

  /**
   * Saves the user's pick (it then wins over the country default) and recalculates if the location is known.
   * @param {Event} event - The change event of the method or madhab dropdown.
   */
  function handleMethodChange(event) {
    const storageKey =
      event.target === domRefs.madhabSelect
        ? STORAGE_KEY_MADHAB_CHOICE
        : STORAGE_KEY_METHOD_CHOICE;
    try {
      localStorage.setItem(storageKey, event.target.value);
    } catch (e) {
      console.error("Failed to save the selected setting:", e);
    }

    if (appState.currentLocation) {
      calculateAndDisplayPrayerTimes(
        appState.currentLocation.latitude,
        appState.currentLocation.longitude,
        domRefs.methodSelect.value
      );
    } else {
      showToast("يرجى تحديد الموقع أولاً لحساب المواقيت.", "info", 4000);
    }
  }

  /**
   * Fills both dropdowns with the user's own picks, else the defaults for the location's country.
   * Country defaults are never saved, so they follow the user to another country.
   * @param {string} [countryCode] - ISO 3166-1 alpha-2 code of the location, if known.
   * @returns {string} The method that is actually selected.
   */
  function applyLocationDefaults(countryCode) {
    const defaults = prayerRules.countryDefaults(countryCode);
    if (domRefs.madhabSelect) {
      domRefs.madhabSelect.value =
        localStorage.getItem(STORAGE_KEY_MADHAB_CHOICE) || defaults.madhab;
    }
    const countryMethod = countryCode
      ? defaults.method
      : localStorage.getItem(STORAGE_KEY_PRAYER_METHOD);
    return selectMethod(
      localStorage.getItem(STORAGE_KEY_METHOD_CHOICE) ||
        countryMethod ||
        DEFAULT_PRAYER_METHOD
    );
  }

  /**
   * Selects a method in the dropdown, falling back to the default for unknown keys.
   * @param {string} methodKey - The key of the method to select (e.g., 'MuslimWorldLeague').
   * @returns {string} The method that is actually selected.
   */
  function selectMethod(methodKey) {
    const select = domRefs.methodSelect;
    if (!select) return methodKey || DEFAULT_PRAYER_METHOD;
    select.value = methodKey;
    if (select.value !== methodKey) {
      console.warn(
        `Method "${methodKey}" not found. Falling back to ${DEFAULT_PRAYER_METHOD}.`
      );
      select.value = DEFAULT_PRAYER_METHOD;
    }
    return select.value;
  }

  /**
   * Calculates prayer times using Adhan.js and starts the countdown, which renders the cards.
   * @param {number} latitude
   * @param {number} longitude
   * @param {string} methodKey - The calculation method key.
   */
  function calculateAndDisplayPrayerTimes(latitude, longitude, methodKey) {
    if (typeof adhan?.PrayerTimes !== "function") {
      handleCalculationError(new Error("Adhan.js library is not loaded."));
      return;
    }

    try {
      const now = new Date();
      const madhab = domRefs.madhabSelect?.value;
      const timesForDay = (dayOffset) =>
        prayerRules.prayerTimes(
          latitude,
          longitude,
          locationDay(now, dayOffset),
          methodKey,
          madhab,
          locationDay
        );

      appState.currentPrayerTimes = timesForDay(0);
      appState.timelineDay = locationDay(now).toDateString();
      // Yesterday's Isha and tomorrow's Fajr bracket today, so every moment has a previous and a next prayer
      appState.prayerTimeline = [
        { key: "isha", time: timesForDay(-1).isha },
        ...PRAYER_DISPLAY_ORDER.map((key) => ({
          key,
          time: appState.currentPrayerTimes[key],
        })),
        { key: "fajr", time: timesForDay(1).fajr, tomorrow: true },
      ];
      appState.nextPrayer = null; // Makes the first tick render the cards

      startCountdown();
      enableLocationButton(); // Re-enable location button after success
      if (domRefs.showForecastBtn) domRefs.showForecastBtn.disabled = false;
      if (domRefs.calendarBtn) domRefs.calendarBtn.disabled = false;
    } catch (error) {
      // Catch errors during Adhan.js calculation
      handleCalculationError(error);
    }
  }

  /**
   * Handles errors that occur during prayer time calculation.
   * @param {Error} error - The error object.
   */
  function handleCalculationError(error) {
    console.error("Error calculating prayer times:", error);
    // showToast uses textContent, so the message needs no escaping
    const userMessage = `حدث خطأ أثناء حساب المواقيت. (${
      error.message || "Unknown calculation error"
    })`;

    showToast(userMessage, "error", 6000);
    enableLocationButton(true, "خطأ في الحساب"); // Show error on button
    setPrayerTimesSkeletonState(true); // Also stops the countdown and clears the times
    domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // A11y: no longer busy (error state)
  }

  /**
   * Fills the prayer cards and highlights the next prayer inside a View Transition:
   * changed times cross-fade and the highlight glides to its new card (.active has a view-transition-name).
   * @param {string} activeKey - Key of the next prayer ('fajr', 'dhuhr', ...).
   */
  function renderPrayerCards(activeKey) {
    const container = domRefs.prayerTimesContainer;
    if (!container) return;

    const update = () => {
      const prayerTimes = appState.currentPrayerTimes;
      if (!prayerTimes) return;
      const now = new Date();
      PRAYER_DISPLAY_ORDER.forEach((prayerKey) => {
        const card = container.querySelector(
          `${SEL_PRAYER_CARD}[data-prayer="${prayerKey}"]`
        );
        if (!card) return;
        const prayerTime = prayerTimes[prayerKey];
        const isActive = prayerKey === activeKey;
        card.querySelector(SEL_PRAYER_TIME).textContent =
          formatTimeForDisplay(prayerTime);
        card.classList.toggle(CSS_ACTIVE, isActive);
        card.classList.toggle(CSS_PASSED, !isActive && prayerTime < now);
      });
      setPrayerTimesSkeletonState(false);
      container.setAttribute("aria-busy", "false");
    };

    withViewTransition(update);
  }

  /**
   * Formats a date for display in the forecast table (e.g., "السبت، ١٥ يونيو").
   * @param {Date} date - The date object to format.
   * @returns {string} Formatted date string.
   */
  function formatForecastDate(date) {
    if (!isValidDate(date)) return "---";
    try {
      // Example: الأحد، ١٦ يونيو ٢٠٢٤
      return new Intl.DateTimeFormat("ar-EG", {
        // Using ar-EG for common format
        weekday: "long",
        day: "numeric",
        month: "long",
        // year: 'numeric' // Optional: Add year if needed
      }).format(date);
    } catch (e) {
      console.error("Intl formatting failed for forecast date:", e);
      // Fallback to simple YYYY-MM-DD
      return date.toLocaleDateString("en-CA");
    }
  }
  /** Stops the countdown interval timer. */
  function stopCountdown() {
    if (appState.countdownIntervalId) {
      appState.countdownHost.clearInterval(appState.countdownIntervalId);
      appState.countdownIntervalId = null;
    }
  }

  /**
   * Starts the per-second countdown to the next prayer. While the PiP window is open its timer
   * drives the ticks, because the main tab may be hidden and hidden tabs get their timers throttled.
   */
  function startCountdown() {
    stopCountdown();
    if (!appState.prayerTimeline) return;
    appState.countdownHost = appState.pipWindow || window;
    updateCountdownTick();
    appState.countdownIntervalId = appState.countdownHost.setInterval(
      updateCountdownTick,
      1000
    );
  }

  /** Updates countdown, progress bar and texts; re-renders the cards when the next prayer changes. */
  function updateCountdownTick() {
    const now = new Date();
    const location = appState.currentLocation;

    // Page left open past midnight: refresh the dates and calculate the new day
    if (location && locationDay(now).toDateString() !== appState.timelineDay) {
      updateDates();
      calculateAndDisplayPrayerTimes(
        location.latitude,
        location.longitude,
        domRefs.methodSelect?.value || DEFAULT_PRAYER_METHOD
      );
      return;
    }

    const timeline = appState.prayerTimeline;
    if (!timeline) return;
    const nextIndex = timeline.findIndex((prayer) => prayer.time > now);
    const next = timeline[nextIndex];
    const previous = timeline[nextIndex - 1];
    if (!next) return;

    const remainingMs = next.time - now;
    updateCountdownDisplay(remainingMs / 1000);
    const progress = previous
      ? ((now - previous.time) / (next.time - previous.time)).toFixed(4)
      : 0;
    // The card's bar and the sticky pill's line both read --progress
    domRefs.countdownProgress?.style.setProperty("--progress", progress);
    domRefs.stickyCountdown?.style.setProperty("--progress", progress);

    const justStarted =
      previous &&
      previous.key !== "sunrise" &&
      now - previous.time < PRAYER_STARTED_MESSAGE_MS;
    setTextIfChanged(
      domRefs.countdownDescription,
      justStarted
        ? `حان الآن وقت صلاة ${PRAYER_NAMES_AR[previous.key]}`
        : formatRemainingText(remainingMs / 1000)
    );
    const nextName =
      PRAYER_NAMES_AR[next.key] + (next.tomorrow ? " (غداً)" : "");
    const countdownText = domRefs.countdown?.textContent ?? "";
    setTextIfChanged(domRefs.nextPrayerName, nextName);
    // The sticky pill and the desktop title bar repeat the next prayer and its countdown
    setTextIfChanged(domRefs.stickyNextPrayer, nextName);
    setTextIfChanged(domRefs.stickyCountdownTime, countdownText);
    setTextIfChanged(domRefs.titlebarPrayer, nextName);
    setTextIfChanged(domRefs.titlebarTime, countdownText);

    if (next !== appState.nextPrayer) {
      appState.nextPrayer = next;
      renderPrayerCards(next.key);
    }
  }

  /**
   * Updates the countdown display element (e.g., HH:MM:SS).
   * @param {number} totalSeconds - Remaining time in seconds. Negative or NaN shows placeholder.
   */
  function updateCountdownDisplay(totalSeconds) {
    const el = domRefs.countdown;
    // **Accessibility:** #countdown is role="timer", not a live region, so it isn't read out every second
    if (!el) return;

    if (isNaN(totalSeconds) || totalSeconds < 0) {
      // Display placeholder/error state consistently
      el.textContent = "--:--:--";
      el.classList.add(CSS_SKELETON_TEXT);
      // Clear description as well when countdown is placeholder/error
      if (domRefs.countdownDescription) {
        domRefs.countdownDescription.textContent = "";
        domRefs.countdownDescription.classList.add(CSS_SKELETON_TEXT); // Show skeleton
      }
      return;
    }

    // Calculate hours, minutes, seconds
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    // Format and update using textContent for performance/safety
    el.textContent = `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

    // Ensure skeleton class is removed when displaying a valid time
    el.classList.remove(CSS_SKELETON_TEXT);
  }

  /**
   * Applies or removes skeleton loading styles from prayer time elements.
   * @param {boolean} showSkeleton - True to show skeleton, false to remove.
   */
  function setPrayerTimesSkeletonState(showSkeleton) {
    const container = domRefs.prayerTimesContainer;
    if (!container) return;

    // Toggle skeleton class on individual time elements
    container.querySelectorAll(SEL_PRAYER_TIME).forEach((el) => {
      el.classList.toggle(CSS_SKELETON, showSkeleton);
      if (showSkeleton) el.textContent = "--:--"; // Set placeholder text
    });

    // Toggle skeleton on the cards themselves; skeleton cards are neither next nor passed
    container.querySelectorAll(SEL_PRAYER_CARD).forEach((card) => {
      card.classList.toggle(CSS_SKELETON, showSkeleton);
      if (showSkeleton) card.classList.remove(CSS_ACTIVE, CSS_PASSED);
    });

    // Toggle skeleton for next prayer name and countdown displays
    if (domRefs.nextPrayerName) {
      domRefs.nextPrayerName.classList.toggle(CSS_SKELETON_TEXT, showSkeleton);
      if (showSkeleton) domRefs.nextPrayerName.textContent = "---";
    }
    if (domRefs.countdown) {
      domRefs.countdown.classList.toggle(CSS_SKELETON_TEXT, showSkeleton);
      if (showSkeleton) updateCountdownDisplay(-1); // Set countdown to placeholder '--:--:--'
    }
    if (domRefs.countdownDescription) {
      domRefs.countdownDescription.classList.toggle(
        CSS_SKELETON_TEXT,
        showSkeleton
      );
      if (showSkeleton) domRefs.countdownDescription.textContent = ""; // Clear text
    }
    // Stop countdown when entering skeleton state.
    // Clear prayer times data as it's no longer represented by the UI.
    if (showSkeleton) {
      stopCountdown();
      appState.currentPrayerTimes = null;
      appState.prayerTimeline = null;
      domRefs.countdownProgress?.style.removeProperty("--progress");
      if (domRefs.showForecastBtn) domRefs.showForecastBtn.disabled = true; // Re-enabled after the next calculation
      if (domRefs.calendarBtn) domRefs.calendarBtn.disabled = true;
      // Note: aria-busy is set/unset in the calling functions (setUILoadingState, calculateAndDisplayPrayerTimes etc.)
      // to correctly reflect the *reason* for the skeleton state (loading vs error).
    }
    // Countdown should be restarted explicitly when data is loaded successfully.
  }

  /**
   * Resets the location button to its default enabled state.
   * @param {boolean} [showErrorText=false] - If true, display an error message instead of default.
   * @param {string} [errorMsg='فشل، حاول مرة أخرى'] - The error message text.
   */
  function enableLocationButton(
    showErrorText = false,
    errorMsg = "فشل، حاول مرة أخرى"
  ) {
    const btn = domRefs.locationButton;
    if (!btn) return;
    btn.disabled = false;
    // Use textContent for the dynamic part for safety/performance
    const textToShow = showErrorText ? errorMsg : "استخدام موقعي الحالي";
    // Set innerHTML for structure (icon + span), then set textContent of the span
    btn.innerHTML = `${ICON_LOCATION} <span class="${SEL_BTN_TEXT.substring(
      1
    )}"></span>`;
    const textSpan = btn.querySelector(SEL_BTN_TEXT);
    if (textSpan) textSpan.textContent = textToShow;

    // Optional: Remove any error-specific styling if needed
    // btn.classList.remove('error-state'); // Example
  }

  // ==============================================
  //          UI Effects (Cursor Light)
  // ==============================================
  /** Initializes UI effects based on input type (mouse or touch). */
  function initializeUiEffects() {
    // Renamed for clarity
    const lightElement = domRefs.cursorLight;
    const mainArea = domRefs.mainElement;

    if (!lightElement || !mainArea) {
      console.warn(
        "UI effect disabled: Required elements (#cursor-light, main) not found."
      );
      appState.isMouseEffectEnabled = false; // Keep track of desktop effect state
      return;
    }

    // Enhanced touch detection
    const hasTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer:coarse)").matches;

    if (hasTouch) {
      // Touch devices: a CSS scroll-driven animation moves the glow (style.css), no JS needed
      appState.isMouseEffectEnabled = false; // Desktop effect is off
    } else {
      console.log("Pointer device detected, initializing cursor light effect.");
      appState.isMouseEffectEnabled = true; // Desktop effect is on
      setupDesktopMouseEffect(lightElement, mainArea); // Call desktop setup
    }
  }
  /** Sets up the cursor-following light effect for desktop. */
  function setupDesktopMouseEffect(lightElement, mainArea) {
    // Style setup for desktop
    lightElement.style.opacity = "0"; // Start hidden
    lightElement.style.position = "absolute"; // Needed for positioning
    lightElement.style.pointerEvents = "none";
    lightElement.style.willChange = "transform"; // Already set in base CSS, but good to confirm

    let mouseX = 0,
      mouseY = 0;
    let potentiallyAffectedCards = [];
    function refreshAffectedCards() {
      potentiallyAffectedCards = Array.from(
        mainArea.querySelectorAll(`${SEL_PRAYER_CARD}:not(.${CSS_ACTIVE})`)
      );
    }

    function updateEffectFrame() {
      if (!appState.isMouseEffectEnabled || !domRefs.mainElement) return;
      const mainRect = mainArea.getBoundingClientRect();
      const lightX = mouseX - mainRect.left - lightElement.offsetWidth / 2;
      const lightY = mouseY - mainRect.top - lightElement.offsetHeight / 2;
      lightElement.style.transform = `translate3d(${lightX}px, ${lightY}px, 0)`;

      potentiallyAffectedCards.forEach((card) => {
        if (card.isConnected && !card.classList.contains(CSS_ACTIVE)) {
          updateCardGlow(card, mouseX, mouseY);
        } else {
          resetCardGlow(card);
        }
      });
      appState.mouseEffectRAFId = null;
    }

    function scheduleEffectUpdate(event) {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (!appState.mouseEffectRAFId && appState.isMouseEffectEnabled) {
        appState.mouseEffectRAFId = requestAnimationFrame(updateEffectFrame);
      }
    }

    function handleMouseEnter() {
      if (!appState.isMouseEffectEnabled) return;
      refreshAffectedCards();
      lightElement.style.opacity = "1"; // Fade in via CSS transition
      if (!appState.mouseEffectRAFId) {
        appState.mouseEffectRAFId = requestAnimationFrame(updateEffectFrame);
      }
    }

    function handleMouseLeave() {
      if (!appState.isMouseEffectEnabled) return;
      if (appState.mouseEffectRAFId) {
        cancelAnimationFrame(appState.mouseEffectRAFId);
        appState.mouseEffectRAFId = null;
      }
      lightElement.style.opacity = "0"; // Fade out via CSS transition
      mainArea.querySelectorAll(SEL_PRAYER_CARD).forEach(resetCardGlow);
    }

    // Add DESKTOP listeners
    mainArea.addEventListener("mousemove", scheduleEffectUpdate, {
      passive: true,
    });
    mainArea.addEventListener("mouseenter", handleMouseEnter, {
      passive: true,
    });
    mainArea.addEventListener("mouseleave", handleMouseLeave, {
      passive: true,
    });

    // Initial reset for cards
    mainArea.querySelectorAll(SEL_PRAYER_CARD).forEach(resetCardGlow);
  }

  /**
   * Calculates and applies CSS custom properties for the glow effect on a card.
   * @param {HTMLElement} card - The prayer card element.
   * @param {number} mouseX - Current mouse X coordinate (clientX).
   * @param {number} mouseY - Current mouse Y coordinate (clientY).
   */
  function updateCardGlow(card, mouseX, mouseY) {
    const cardRect = card.getBoundingClientRect();
    // Calculate mouse position relative to the card's top-left corner
    const relativeX = mouseX - cardRect.left;
    const relativeY = mouseY - cardRect.top;

    // Configuration for the glow effect (could be constants)
    const maxGlowDistance = 350; // Pixels: Max distance for any glow
    const minGlowDistance = 20; // Pixels: Distance for full glow (center)
    const maxGlowOpacity = 0.15; // Max opacity (adjust in CSS too)

    // Calculate distance from card center to mouse position
    const distance = Math.sqrt(
      Math.pow(relativeX - cardRect.width / 2, 2) +
        Math.pow(relativeY - cardRect.height / 2, 2)
    );

    // Calculate opacity based on distance (linear falloff)
    let glowOpacity = 0;
    if (distance < maxGlowDistance) {
      // Opacity decreases from maxGlowOpacity to 0 as distance goes from minGlowDistance to maxGlowDistance
      glowOpacity = Math.max(
        0,
        Math.min(
          maxGlowOpacity,
          maxGlowOpacity *
            (1 -
              Math.max(0, distance - minGlowDistance) /
                (maxGlowDistance - minGlowDistance))
        )
      );
    }

    // Calculate glow position as a percentage relative to the card size
    // Clamp values between 0% and 100%
    const posXPercent = Math.max(
      0,
      Math.min(100, (relativeX / cardRect.width) * 100)
    );
    const posYPercent = Math.max(
      0,
      Math.min(100, (relativeY / cardRect.height) * 100)
    );

    // Apply styles using CSS custom properties defined in your CSS
    // Example CSS:
    // .prayer-card::before {
    //   opacity: var(--glow-opacity, 0);
    //   background: radial-gradient(circle at var(--glow-posX, 50%) var(--glow-posY, 50%),
    //                          rgba(255, 255, 255, 0.3) 0%,
    //                          rgba(255, 255, 255, 0) 70%);
    //   transition: opacity 0.2s ease-out;
    // }
    card.style.setProperty("--glow-opacity", glowOpacity.toFixed(3));
    card.style.setProperty("--glow-posX", `${posXPercent.toFixed(1)}%`);
    card.style.setProperty("--glow-posY", `${posYPercent.toFixed(1)}%`);
  }

  /** Removes the glow effect CSS custom properties from a card. */
  function resetCardGlow(card) {
    // Important to remove the properties so they fall back to default CSS values
    card.style.removeProperty("--glow-opacity");
    card.style.removeProperty("--glow-posX");
    card.style.removeProperty("--glow-posY");
  }

  // ==============================================
  //          Date Display
  // ==============================================

  /** Updates the displayed Gregorian and Hijri dates and day of the week. */
  function updateDates() {
    const now = new Date();
    const timeZone = locationTimeZone(); // The date where the location is

    // --- Day of Week ---
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #day-of-week element
    if (domRefs.dayOfWeek) {
      try {
        domRefs.dayOfWeek.textContent = new Intl.DateTimeFormat("ar", {
          weekday: "long",
          timeZone,
        }).format(now);
      } catch (e) {
        console.error("Error formatting day of week:", e);
        domRefs.dayOfWeek.textContent = ""; // Clear on error
      }
    }

    // --- Gregorian Date ---
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #gregorian-date element
    if (domRefs.gregorianDate) {
      try {
        // Example format: ١٠ يونيو ٢٠٢٣
        domRefs.gregorianDate.textContent = new Intl.DateTimeFormat("ar", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone,
        }).format(now);
      } catch (e) {
        console.error("Error formatting Gregorian date:", e);
        // Fallback to a simple, less locale-dependent format
        domRefs.gregorianDate.textContent = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
      }
    }

    // --- Hijri Date ---
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #hijri-date element
    if (domRefs.hijriDate) {
      try {
        // Use 'ar-SA' (Saudi Arabia) as it often has good Islamic calendar support.
        // '-u-ca-islamic-umalqura' is the Umm al-Qura calendar, the same one the
        // Ramadan/Eid countdown uses, so both always agree.
        // Example format: ٢٢ ذو القعدة ١٤٤٤ هـ
        domRefs.hijriDate.textContent = new Intl.DateTimeFormat(
          `ar-SA-u-ca-${HIJRI_CALENDAR}`,
          { day: "numeric", month: "long", year: "numeric", timeZone }
        ).format(now);
      } catch (e) {
        console.warn(
          "Hijri formatting failed with ar-SA, trying generic 'ar':",
          e
        );
        try {
          // Fallback to generic 'ar' locale with Islamic calendar
          domRefs.hijriDate.textContent = new Intl.DateTimeFormat(
            `ar-u-ca-${HIJRI_CALENDAR}`,
            { day: "numeric", month: "long", year: "numeric", timeZone }
          ).format(now);
        } catch (e2) {
          console.error(
            "Hijri formatting failed with generic 'ar' as well:",
            e2
          );
          domRefs.hijriDate.textContent = "التاريخ الهجري غير متاح"; // User-friendly error
        }
      }
    }

    // --- Current Year (for footer, etc.) ---
    if (domRefs.currentYear && domRefs.currentYear.textContent === "") {
      // Only set once if empty
      domRefs.currentYear.textContent = now.getFullYear().toString();
    }

    updateOccasionCountdown();
  }

  /**
   * Shows the days left until the next Ramadan / Eid, using Temporal's Hijri calendar arithmetic.
   * Stays hidden where Temporal isn't available.
   */
  function updateOccasionCountdown() {
    const el = domRefs.occasionCountdown;
    if (!el || typeof Temporal === "undefined" || !remainingTimeFormat) return;

    // Optional extra: it must never break initialization (updateDates runs during init)
    try {
      const today = Temporal.Now.plainDateISO(locationTimeZone()).withCalendar(
        HIJRI_CALENDAR
      );
      for (const year of [today.year, today.year + 1]) {
        for (const occasion of HIJRI_OCCASIONS) {
          const date = Temporal.PlainDate.from({
            calendar: HIJRI_CALENDAR,
            year,
            month: occasion.month,
            day: occasion.day,
          });
          const days = today.until(date).days;
          if (days < 0) continue; // Already passed this year

          domRefs.occasionText.textContent =
            days === 0
              ? occasion.greeting
              : `متبقي ${remainingTimeFormat.format({ days })} على ${occasion.name}`;
          el.hidden = false;
          return;
        }
      }
    } catch (e) {
      // e.g. a Temporal build without Hijri calendars: the chip stays hidden
      console.warn("Ramadan/Eid countdown unavailable:", e);
    }
  }
  // ==============================================
  //          Service Worker Management
  // ==============================================

  /** Registers the service worker and sets up update handling. */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      console.log("Service Worker not supported by this browser.");
      return;
    }

    navigator.serviceWorker
      .register(SERVICE_WORKER_PATH)
      .then((registration) => {
        console.log(
          "Service Worker registered successfully. Scope:",
          registration.scope
        );

        // --- Check for SW updates ---
        // Optional: Check for updates periodically or on specific events
        // registration.update(); // Force check on load (use cautiously)

        // --- Handle Update Found ---
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          console.log("Service Worker update found. New worker installing.");
          // Track state changes of the *new* worker
          newWorker.addEventListener("statechange", () => {
            // Possible states: 'installing', 'installed', 'activating', 'activated', 'redundant'
            if (newWorker.state === "installed") {
              // A new version is installed and waiting to activate.
              // Check if there's already an active worker controlling the page.
              // If so, it means this is an update, not the initial installation.
              if (navigator.serviceWorker.controller) {
                console.log(
                  "New Service Worker installed and ready to activate."
                );
                // Store the waiting worker and flag availability
                appState.isUpdateAvailable = true;
                appState.waitingServiceWorker = newWorker;
                // Show a notification UI to the user
                showUpdateNotification();
              } else {
                // This is the initial SW install completing. No user action needed.
                console.log("Service Worker installed for the first time.");
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
        // showToast("فشل تسجيل خدمة التطبيق لتحديثات الخلفية.", "error", 5000);
      });

    // --- Handle Controller Change (New SW Takes Over) ---
    // This event fires when the new SW activates and takes control of the page.
    let isRefreshing = false; // Prevent potential reload loops
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (isRefreshing) return;
      console.log(
        "Service Worker controller changed. Reloading page for update..."
      );
      isRefreshing = true;
      window.location.reload(); // Reload the page to use the new SW assets/logic
    });
  }

  /** Displays the UI notification for an available update. */
  function showUpdateNotification() {
    const notificationElement = domRefs.updateNotification;
    const updateButton = domRefs.updateButton;

    if (!notificationElement || !updateButton) {
      console.warn(
        "Update notification UI elements not found in DOM. Cannot prompt user."
      );
      // Optional: Log or use a simple confirm() as a fallback?
      // if (appState.isUpdateAvailable && appState.waitingServiceWorker) {
      //     if (confirm("تحديث جديد متوفر. هل تريد التحديث الآن؟")) {
      //         triggerServiceWorkerUpdate();
      //     }
      // }
      return;
    }

    console.log("Displaying update available notification.");
    // Ensure the button listener is correctly wired up *now*
    // Remove previous listener to avoid duplicates if this is called again
    updateButton.removeEventListener("click", triggerServiceWorkerUpdate);
    updateButton.addEventListener("click", triggerServiceWorkerUpdate);

    // Make the notification visible (use appropriate display style)
    notificationElement.style.display = "block"; // Or 'flex', 'grid', etc.
    // Same spot at the bottom of the screen; the install banner can wait for another visit
    if (domRefs.installBanner) domRefs.installBanner.hidden = true;
  }

  /** Called when the user clicks the update button. Tells the waiting SW to activate. */
  function triggerServiceWorkerUpdate() {
    const worker = appState.waitingServiceWorker;
    if (worker && appState.isUpdateAvailable) {
      console.log(
        "User initiated update. Sending skipWaiting message to Service Worker."
      );
      // Tell the waiting worker to skip the waiting phase and activate
      worker.postMessage({ action: "skipWaiting" });
      // Hide the notification immediately after clicking
      if (domRefs.updateNotification)
        domRefs.updateNotification.style.display = "none";
      // The 'controllerchange' event will handle the reload
    } else {
      console.error(
        "Update button clicked, but no waiting Service Worker found or update not available."
      );
      // Hide notification anyway if button was somehow visible
      if (domRefs.updateNotification)
        domRefs.updateNotification.style.display = "none";
    }
  }
  // ==============================================
  //          Prayer Times Forecast
  // ==============================================

  /**
   * Builds the 14-day table each time the forecast popover opens,
   * so it always matches the current location, method and date.
   */
  function renderForecast() {
    if (!appState.currentLocation || !domRefs.forecastContainer) return;

    const { latitude, longitude } = appState.currentLocation;
    const methodKey = domRefs.methodSelect?.value;
    const madhab = domRefs.madhabSelect?.value;
    const headerCells = PRAYER_DISPLAY_ORDER.map(
      (key) => `<th scope="col">${PRAYER_NAMES_AR[key]}</th>`
    ).join("");

    const rows = [];
    for (let i = 0; i < 14; i++) {
      const date = locationDay(new Date(), i);
      const times = prayerRules.prayerTimes(latitude, longitude, date, methodKey, madhab, locationDay);
      // data-label / data-day feed the phone carousel (CSS labels and dot names)
      const cells = PRAYER_DISPLAY_ORDER.map(
        (key) =>
          `<td data-label="${PRAYER_NAMES_AR[key]}">${formatTimeForDisplay(times[key])}</td>`
      ).join("");
      const day = formatForecastDate(date);
      rows.push(
        `<tr data-day="${day}"><th scope="row">${day}</th>${cells}</tr>`
      );
    }

    // Only Intl-formatted dates/times and our own constants go into this markup
    domRefs.forecastContainer.innerHTML = `
      <table class="forecast-table">
        <thead><tr><th scope="col">التاريخ</th>${headerCells}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
  }

  // ==============================================
  //          Calendar Export (.ics)
  // ==============================================

  const utf8 = new TextEncoder();
  /** An instant as an RFC 5545 UTC date-time, e.g. "20261015T021300Z". */
  const icsTime = (date) => date.toISOString().replace(/[-:]|\.\d+/g, "");

  /**
   * Folds a content line into lines of at most 75 octets (RFC 5545 3.1), never inside a character.
   * @param {string} line
   * @returns {string}
   */
  function foldIcsLine(line) {
    let folded = "";
    let octets = 0;
    for (const char of line) {
      const size = utf8.encode(char).length;
      if (octets + size > 75) {
        folded += "\r\n "; // A continuation line starts with a space, which counts too
        octets = 1;
      }
      folded += char;
      octets += size;
    }
    return folded;
  }

  /**
   * Downloads the five prayers of the next CALENDAR_DAYS days as an .ics file, each with a reminder
   * at its time, so the phone's own calendar reminds the user: no server or push service needed.
   */
  function downloadCalendar() {
    const location = appState.currentLocation;
    if (!location) return;
    const now = new Date();
    const methodKey = domRefs.methodSelect?.value;
    const madhab = domRefs.madhabSelect?.value;
    // TEXT values escape \ ; and , (RFC 5545 3.3.11); place names have no line breaks
    const place = location.displayText.replace(/[\\;,]/g, "\\$&");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//prayer-times//ar"];
    for (let i = 0; i < CALENDAR_DAYS; i++) {
      const day = locationDay(now, i);
      const dayId = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
      const times = prayerRules.prayerTimes(
        location.latitude,
        location.longitude,
        day,
        methodKey,
        madhab,
        locationDay
      );
      for (const key of PRAYER_DISPLAY_ORDER) {
        const time = times[key];
        // Sunrise isn't a prayer; passed times would show overdue reminders in some calendars, and
        // polar-night times are invalid dates (never > now)
        if (key === "sunrise" || !(time > now)) continue;
        const name = `صلاة ${PRAYER_NAMES_AR[key]}`;
        lines.push(
          "BEGIN:VEVENT",
          `UID:${dayId}-${key}@prayer-times`, // Stable: importing again updates the events, not duplicates them
          `DTSTAMP:${icsTime(now)}`,
          `DTSTART:${icsTime(time)}`,
          `DTEND:${icsTime(new Date(time.getTime() + CALENDAR_EVENT_MS))}`,
          `SUMMARY:${name}`,
          `DESCRIPTION:مواقيت الصلاة في ${place}`,
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:PT0S",
          `DESCRIPTION:حان الآن وقت ${name}`,
          "END:VALARM",
          "END:VEVENT"
        );
      }
    }
    lines.push("END:VCALENDAR");

    const ics = lines.map(foldIcsLine).join("\r\n") + "\r\n";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    link.download = "prayer-times.ics";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000); // Late enough for slow downloads
    showToast("تم تنزيل ملف التقويم. افتحه لإضافة المواقيت إلى تقويمك.", "success");
  }

  // ==============================================
  //          Floating Countdown (Document Picture-in-Picture)
  // ==============================================

  /** Shows the PiP button where the Document Picture-in-Picture API exists (Chromium desktop). */
  function setupCountdownPip() {
    if (!domRefs.pipButton || !("documentPictureInPicture" in window)) return;
    domRefs.pipButton.hidden = false;
    domRefs.pipButton.addEventListener("click", openCountdownPip);
  }

  /** Moves the next-prayer card into an always-on-top window; it moves back when that window closes. */
  async function openCountdownPip() {
    if (appState.pipWindow || !domRefs.nextPrayerInfo) return;
    const card = domRefs.nextPrayerInfo;
    let pipWindow;
    try {
      pipWindow = await documentPictureInPicture.requestWindow({
        width: 360,
        height: 260,
      });
    } catch (error) {
      // e.g. embedded browsers that expose the API but can't open the window
      console.error("Could not open the Picture-in-Picture window:", error);
      showToast("تعذر فتح النافذة العائمة.", "error");
      return;
    }

    // Same stylesheets (absolute URLs: the PiP document is about:blank) and theme
    document.head
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach((node) => {
        const copy = node.cloneNode(true);
        if (node.href) copy.href = node.href;
        pipWindow.document.head.append(copy);
      });
    const pipRoot = pipWindow.document.documentElement;
    pipRoot.className = domRefs.htmlElement.className;
    pipRoot.lang = "ar";
    pipRoot.dir = "rtl";
    pipWindow.document.body.classList.add("pip");
    // <use href="#icon-..."> only finds symbols in its own document
    pipWindow.document.body.append(
      document.getElementById("icon-sprite").cloneNode(true)
    );

    const placeholder = document.createComment("next-prayer-info");
    card.before(placeholder);
    pipWindow.document.body.append(card);
    appState.pipWindow = pipWindow;
    startCountdown(); // Tick from the PiP window from now on

    pipWindow.addEventListener(
      "pagehide",
      () => {
        placeholder.replaceWith(card);
        appState.pipWindow = null;
        startCountdown();
      },
      { once: true }
    );
  }

  // ==============================================
  //          Installed App: Shortcuts & Install Button
  // ==============================================

  /**
   * Runs a home-screen shortcut from manifest.json ("/?action=locate|city|forecast"). A new window
   * gets it from its URL and from the launch queue, so running it twice must be harmless.
   * @param {string} url - The URL the app was opened with.
   */
  function runLaunchAction(url) {
    const action = new URL(url).searchParams.get("action");
    if (!action) return;
    const sheet = {
      city: domRefs.citySheet,
      // No location yet: pick a city first
      forecast: appState.currentLocation ? domRefs.forecastSheet : domRefs.citySheet,
    }[action];
    if (action === "locate") domRefs.locationButton.click(); // Ignored while already locating
    else if (sheet && !sheet.matches(":popover-open")) sheet.showPopover();
    // Leave a plain "/" behind so a reload doesn't repeat the action
    history.replaceState(null, "", location.pathname);
  }

  /**
   * Offers the app for installing while it can be installed: "تثبيت التطبيق" in the header, and a
   * banner at the bottom until it's dismissed. They open the browser's own install dialog where it
   * has one (Chromium: with the screenshots and description from manifest.json), or the Add to
   * Home Screen steps on iPhone and iPad, which have no install API.
   */
  function setupInstall() {
    const { installButton: button, installBanner: banner } = domRefs;
    if (!button || !banner) return;
    let installPrompt = null;

    const offerInstall = (show) => {
      button.hidden = !show;
      banner.hidden = !show || localStorage.getItem(STORAGE_KEY_INSTALL_DISMISSED) === "1";
    };

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault(); // Our banner instead of the browser's mini-infobar
      installPrompt = event;
      offerInstall(true);
    });
    window.addEventListener("appinstalled", () => offerInstall(false));

    // ponytail: platform sniffing for iOS (iPadOS reports a Mac with touch); drop it once Safari ships an install API
    const isIos =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) {
      addIosLaunchScreens();
      offerInstall(!matchMedia("(display-mode: standalone)").matches && !navigator.standalone);
    }

    const install = async () => {
      if (!installPrompt) {
        domRefs.iosInstallSheet?.showPopover();
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice;
      // A prompt can only be shown once; the browser offers a new one on a later visit
      installPrompt = null;
      offerInstall(false);
    };
    button.addEventListener("click", install);
    banner.querySelector("[data-install]").addEventListener("click", install);
    domRefs.installDismiss.addEventListener("click", () => {
      banner.hidden = true;
      try {
        localStorage.setItem(STORAGE_KEY_INSTALL_DISMISSED, "1");
      } catch (error) {
        console.error("Failed to save the dismissed install banner:", error);
      }
    });
  }

  /**
   * iPhone launch screen: iOS shows one only from an apple-touch-startup-image link of the screen's
   * exact size, else a white screen. Added here, for iOS only, instead of a link per model in the page.
   */
  function addIosLaunchScreens() {
    const size = `${screen.width * devicePixelRatio}x${screen.height * devicePixelRatio}`;
    if (!IOS_LAUNCH_SCREEN_SIZES.includes(size)) return;
    for (const theme of ["light", "dark"]) {
      const link = document.createElement("link");
      link.rel = "apple-touch-startup-image";
      link.media = `(prefers-color-scheme: ${theme})`;
      link.href = `splash/${size}-${theme}.jpg`;
      document.head.append(link);
    }
  }

  /**
   * Phones: a sheet follows a finger dragging its header down and closes when let go far enough,
   * like a native bottom sheet. The header has touch-action: none there, so the browser doesn't
   * scroll instead; elsewhere (mouse, wider screens) nothing changes.
   * @param {HTMLElement} sheet - A popover with a .sheet-header.
   */
  function setupSheetSwipe(sheet) {
    const header = sheet.querySelector(".sheet-header");
    let startY = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.target.closest("button")) return;
      if (!matchMedia("(max-width: 600px)").matches) return; // Bottom sheets only
      startY = event.clientY;
      header.setPointerCapture(event.pointerId);
      sheet.style.transition = "none"; // Follow the finger exactly
    });
    header.addEventListener("pointermove", (event) => {
      if (startY !== null)
        sheet.style.translate = `0 ${Math.max(0, event.clientY - startY)}px`;
    });
    const release = (event) => {
      if (startY === null) return;
      const dragged = event.type === "pointerup" ? event.clientY - startY : 0;
      startY = null;
      // Back to the stylesheet's transition, which animates from where the finger left it
      sheet.style.transition = sheet.style.translate = "";
      if (dragged > SHEET_CLOSE_DRAG_PX) sheet.hidePopover();
    };
    header.addEventListener("pointerup", release);
    header.addEventListener("pointercancel", release);
  }

  // ==============================================
  //          Initialization
  // ==============================================

  /** Main initialization function for the prayer times application. */
  async function initializePrayerApp() {
    console.log("Initializing Prayer Times App...");

    // 1. Cache essential DOM Elements early
    cacheDOMElements();
    if (
      !domRefs.prayerTimesContainer ||
      !domRefs.locationButton ||
      !domRefs.locationSpan
    ) {
      console.error(
        "Essential DOM elements missing. Cannot initialize properly."
      );
      document.body.innerHTML =
        '<p style="color: red; padding: 20px;">خطأ حرج: لم يتم العثور على العناصر الأساسية للتطبيق.</p>';
      return;
    }

    // 2. Set up static or non-dynamic content
    updateDates(); // Update dates display immediately
    if (domRefs.currentYear && !domRefs.currentYear.textContent) {
      domRefs.currentYear.textContent = new Date().getFullYear();
    }

    // 3. Setup User Controls & Load Preferences
    setupThemeSwitcher(); // Load theme pref and set up toggle
    setupMethodSelect(); // Load method pref and set up the dropdown

    // 4. Initialize Interactive Features
    initializeUiEffects(); // Setup cursor light effect (checks for touch)
    setupCountdownPip(); // Floating countdown where supported
    setupInstall();
    document.querySelectorAll(".forecast-sheet").forEach(setupSheetSwipe);
    // iOS Safari applies :active (the pressed state in style.css) only once a touch listener exists
    document.addEventListener("touchstart", () => {}, { passive: true });

    // 5. Register Service Worker (for PWA features/caching/updates)
    registerServiceWorker();

    // 6. Setup Core Event Listeners
    domRefs.locationButton.addEventListener("click", handleLocationButtonClick);
    // The forecast popover opens/closes declaratively (popovertarget); just fill it on open.
    // Its button stays disabled until times are calculated.
    domRefs.forecastSheet?.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open") renderForecast();
    });
    domRefs.calendarBtn?.addEventListener("click", downloadCalendar);
    // The city picker popover is filled on first open
    domRefs.citySheet?.addEventListener("beforetoggle", handleCityPickerToggle);
    domRefs.countrySelect?.addEventListener("change", () =>
      loadPickerCities().catch((error) =>
        console.error("City list unavailable:", error)
      )
    );
    domRefs.cityInput?.addEventListener("input", () =>
      domRefs.cityInput.setCustomValidity("")
    );
    domRefs.cityForm?.addEventListener("submit", handleCityPick);
    // 7. Set Initial Loading/UI State (Always start skeleton)
    setPrayerTimesSkeletonState(true);
    domRefs.prayerTimesContainer.setAttribute("aria-busy", "true");

    // ---> 8. Attempt to Load Prayer Times from Stored Location <---
    let loadedFromStorage = false; // Flag to track if we loaded times automatically
    try {
      // Older versions cached reverse-geocode results; free that storage
      Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_KEY_LOCATION_CACHE_PREFIX))
        .forEach((key) => localStorage.removeItem(key));

      const storedLocationData = JSON.parse(
        localStorage.getItem(STORAGE_KEY_LAST_LOCATION)
      );
      if (
        typeof storedLocationData?.latitude === "number" &&
        typeof storedLocationData?.longitude === "number"
      ) {
        // Older saves have no countryCode or timeZone: default method, device time zone
        const { latitude, longitude } = storedLocationData;
        setLocation({
          ...storedLocationData,
          displayText:
            storedLocationData.displayText ||
            `موقع سابق: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
        });
        loadedFromStorage = true;
      } else if (storedLocationData) {
        console.log("Stored location data was invalid. Clearing.");
        localStorage.removeItem(STORAGE_KEY_LAST_LOCATION);
      }
    } catch (error) {
      console.error("Error reading or parsing stored location data:", error);
      // Clear potentially corrupted data
      try {
        localStorage.removeItem(STORAGE_KEY_LAST_LOCATION);
      } catch (e) {}
    }
    refreshCityInBackground(); // Travellers: follow the user to a new city if allowed before

    // Home-screen shortcuts: from this window's URL, and from later launches into this already
    // open window (manifest launch_handler "focus-existing" focuses it instead of reloading)
    runLaunchAction(location.href);
    window.launchQueue?.setConsumer(
      (params) => params.targetURL && runLaunchAction(params.targetURL)
    );

    // 9. Final Log Message
    if (loadedFromStorage) {
      console.log("Prayer Times App Initialized using stored location.");
    } else {
      // If not loaded from storage, ensure skeleton state remains and is marked busy.
      // (It was set earlier, this is just confirming the state)
      setPrayerTimesSkeletonState(true);
      domRefs.prayerTimesContainer.setAttribute("aria-busy", "true");
      console.log(
        "Prayer Times App Initialized. Waiting for user location input."
      );
    }
  }

  // --- Execute Initialization ---
  // Ensure the DOM is ready before running initialization logic
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePrayerApp);
  } else {
    // DOMContentLoaded has already fired
    initializePrayerApp();
  }
})(); // End of IIFE
