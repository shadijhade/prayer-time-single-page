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
  const STORAGE_KEY_LOCATION_CACHE_PREFIX = "locationDataCache_";

  // --- Default Values ---
  const DEFAULT_PRAYER_METHOD = "MuslimWorldLeague";

  // --- Timing & Duration ---
  const TOAST_TRANSITION_DURATION_MS = 350; // Match CSS transition
  const GEOLOCATION_TIMEOUT_MS = 15000; // Increased timeout
  const GEOLOCATION_MAX_AGE_MS = 300000; // 5 minutes
  const LOCATION_CACHE_EXPIRY_MS = 360 * 24 * 60 * 60 * 1000; // 360 days
  const REVERSE_GEOCODE_TIMEOUT_MS = 10000; // 10 seconds
  const PRAYER_STARTED_MESSAGE_MS = 60000; // "حان الآن وقت صلاة ..." shows for the first minute

  // --- API & Paths ---
  const REVERSE_GEOCODE_URL =
    "https://api.bigdatacloud.net/data/reverse-geocode-client";
  const SERVICE_WORKER_PATH = "sw.js"; // Ensure this path is correct

  // --- Caching ---
  const LOCATION_CACHE_PRECISION = 3; // Decimal places for lat/lon rounding (approx 111m)

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
  const ICON_SPINNER = `<span class="material-symbols-rounded icon-spin" aria-hidden="true">progress_activity</span>`;
  const ICON_ERROR = `<span class="material-symbols-rounded icon-error" aria-hidden="true">error</span>`;
  const ICON_WARNING = `<span class="material-symbols-rounded icon-warning" aria-hidden="true">warning</span>`;
  const ICON_SUCCESS = `<span class="material-symbols-rounded icon-success" aria-hidden="true">check_circle</span>`;
  const ICON_INFO = `<span class="material-symbols-rounded icon-info" aria-hidden="true">info</span>`;
  const ICON_LOCATION = `<span class="material-symbols-rounded" aria-hidden="true">my_location</span>`;

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
  // Maps country codes (ISO 3166-1 alpha-2) to Adhan.js method names
  const COUNTRY_TO_METHOD_MAP = {
    SA: "UmmAlQura",
    EG: "Egyptian",
    US: "ISNA",
    CA: "ISNA",
    GB: "MuslimWorldLeague",
    FR: "MuslimWorldLeague",
    DE: "MuslimWorldLeague",
    PK: "Karachi",
    IR: "Tehran",
    KW: "Kuwait",
    QA: "Qatar",
    AE: "Dubai",
    SG: "Singapore",
    MY: "Singapore",
    ID: "Singapore",
    TR: "Turkey",
    BD: "Karachi",
    IN: "Karachi",
    AF: "Karachi",
    SY: "Egyptian",
    LB: "Egyptian",
    TN: "Karachi",
    DZ: "MuslimWorldLeague",
    MA: "Egyptian",
    JO: "Karachi",
    IQ: "MuslimWorldLeague",
    YE: "UmmAlQura",
    OM: "UmmAlQura",
    BH: "UmmAlQura",
    RU: "MuslimWorldLeague",
    KZ: "MuslimWorldLeague",
    UZ: "MuslimWorldLeague",
    TH: "MuslimWorldLeague",
    VN: "MuslimWorldLeague",
    BR: "MuslimWorldLeague",
    AR: "MuslimWorldLeague",
    AU: "MuslimWorldLeague",
    NZ: "MuslimWorldLeague",
    ZA: "Egyptian",
    NG: "Egyptian",
    KE: "Egyptian",
    DEFAULT: "MuslimWorldLeague",
  };
  // Countries whose mosques use the Hanafi (later) Asr by default
  const HANAFI_COUNTRIES = ["PK", "IN", "BD", "AF"];

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
    domRefs.forecastSheet = document.getElementById("forecast-sheet");
    domRefs.forecastContainer = document.getElementById(
      "forecast-table-container"
    );
  }

  // ==============================================
  //          Utility Functions
  // ==============================================
  // Native Arabic plurals ("دقيقتان", "3 دقائق", "11 دقيقة"...); undefined in very old browsers
  const remainingTimeFormat =
    Intl.DurationFormat &&
    new Intl.DurationFormat("ar-u-nu-latn", { style: "long" });

  // Umm al-Qura month number of a date ("9" in Ramadan)
  const hijriMonthFormat = new Intl.DateTimeFormat(
    `en-u-ca-${HIJRI_CALENDAR}`,
    { month: "numeric" }
  );

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
    // Update browser theme color for mobile address bars etc.
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        "content",
        theme === "dark" ? "#0f172a" : "#14b8a6"
      ); // Example colors
    }
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
      {
        timeout: GEOLOCATION_TIMEOUT_MS,
        enableHighAccuracy: true, // Usually sufficient and faster/less power
        maximumAge: GEOLOCATION_MAX_AGE_MS,
      }
    );
  }

  /**
   * Success callback for geolocation.
   * @param {GeolocationPosition} position - The position object from the browser.
   */
  function handleLocationSuccess(position) {
    // Update loading toast message
    if (appState.loadingToastElement) {
      const msgSpan =
        appState.loadingToastElement.querySelector(SEL_TOAST_MESSAGE);
      if (msgSpan)
        msgSpan.textContent = "تم تحديد الموقع، جارِ جلب البيانات...";
    } else {
      // If toast was dismissed somehow, show a temporary success one
      showToast("تم تحديد الموقع بنجاح.", "success", 2000);
    }

    const { latitude, longitude } = position.coords;
    // Same country as before until the reverse geocode says otherwise, so a failed lookup keeps the method
    const countryCode = appState.currentLocation?.countryCode;
    appState.currentLocation = { latitude, longitude, source: "user", countryCode };
    console.log(
      `Geolocation success: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
    );
    saveLastLocation(
      latitude,
      longitude,
      `موقع حالي: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      countryCode
    );
    fetchCountryAndDisplayPrayerTimes(latitude, longitude);
  }

  /**
   * Error callback for geolocation.
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
    showToast(userMessage, "error", 0);

    // Reset UI state
    if (domRefs.locationSpan) domRefs.locationSpan.textContent = "---";
    enableLocationButton(true, "فشل، حاول مرة أخرى"); // Show error state on button
    setPrayerTimesSkeletonState(true); // Reset times display to skeleton
    domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // No longer busy (failed)
    appState.currentLocation = null;
    appState.currentPrayerTimes = null;
    stopCountdown();
  }

  /**
   * Fetches country/locality, determines method, calculates and displays times.
   * Handles caching of geocode data.
   * @param {number} latitude
   * @param {number} longitude
   */
  async function fetchCountryAndDisplayPrayerTimes(latitude, longitude) {
    const apiUrl = `${REVERSE_GEOCODE_URL}?latitude=${latitude}&longitude=${longitude}&localityLanguage=ar`;
    let locationDisplayText = `موقع: ${latitude.toFixed(
      3
    )}, ${longitude.toFixed(3)}`; // Default/fallback text
    let geocodeData = null; // Holds fetched or cached reverse geocode data

    // --- Caching Logic ---
    const cacheKey = getLocationCacheKey(latitude, longitude);
    const cachedGeoItem = getCachedLocationData(cacheKey);
    // --- End Caching Logic ---

    if (cachedGeoItem) {
      geocodeData = cachedGeoItem.data; // Use the data part of the cached item
      console.log("Using cached location data.");
      dismissLoadingToast(); // Dismiss spinner immediately
      showToast("استخدام بيانات الموقع المخزنة.", "info", 2500);
      // Update button state slightly delayed to feel natural after toast
      setTimeout(() => {
        if (domRefs.locationButton && domRefs.locationButton.disabled) {
          domRefs.locationButton.innerHTML = `${ICON_LOCATION} <span class="${SEL_BTN_TEXT.substring(
            1
          )}"></span>`;
          const textSpan = domRefs.locationButton.querySelector(SEL_BTN_TEXT);
          if (textSpan) textSpan.textContent = "تم تحديد الموقع";
          // Button will be fully re-enabled in calculateAndDisplayPrayerTimes
        }
      }, 300);
      appState.currentLocation.source = "cache"; // Update source
    } else {
      // --- Fetch Logic ---
      if (appState.loadingToastElement) {
        const msgSpan =
          appState.loadingToastElement.querySelector(SEL_TOAST_MESSAGE);
        if (msgSpan) msgSpan.textContent = "جارِ تحديد الدولة والمنطقة...";
      } else {
        showToast("جارِ تحديد الدولة والمنطقة...", "loading", 0); // Ensure loading toast is shown
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          REVERSE_GEOCODE_TIMEOUT_MS
        );

        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        geocodeData = await response.json(); // Store fetched data
        setCachedLocationData(cacheKey, geocodeData); // Cache successful fetch
        dismissLoadingToast("تم تحديد الدولة والمنطقة."); // Dismiss with success
        showToast("جارِ حساب المواقيت...", "info", 1500); // Brief calculation message
        appState.currentLocation.source = "network"; // Update source
      } catch (error) {
        dismissLoadingToast(); // Dismiss loading toast on fetch error
        if (error.name === "AbortError") {
          console.error("Reverse geocoding timed out:", error);
          showToast("فشل تحديد الدولة (مهلة زائدة).", "warning", 5000);
        } else {
          console.error("Error fetching location name/country:", error);
          showToast(
            "فشل تحديد الدولة، سيتم استخدام الطريقة الافتراضية/المفضلة.",
            "warning",
            5000
          );
        }
        locationDisplayText += " (فشل تحديد الدولة)";
        // geocodeData remains null
        appState.currentLocation.source = "error"; // Indicate failure
      }
      // --- End Fetch Logic ---
    } // End if/else (cache hit/miss)

    // --- Process Data (if available) ---
    if (geocodeData) {
      // Construct display text (use Set for unique parts)
      const locationParts = [
        geocodeData.locality,
        geocodeData.city,
        geocodeData.principalSubdivision, // e.g., state/province
        geocodeData.countryName,
      ].filter(Boolean); // Remove null/empty strings
      const uniqueParts = [...new Set(locationParts)]; // Get unique values
      locationDisplayText = uniqueParts.join("، ") || locationDisplayText; // Use fetched/cached or fallback

      appState.currentLocation.countryCode =
        geocodeData.countryCode?.toUpperCase() ||
        appState.currentLocation.countryCode;
      saveLastLocation(
        latitude,
        longitude,
        locationDisplayText,
        appState.currentLocation.countryCode
      );
    }
    // --- End Processing ---

    // --- Final UI Updates & Calculation ---
    if (domRefs.locationSpan)
      domRefs.locationSpan.textContent = locationDisplayText;
    // Fill the dropdowns for this country (unless the user picked), then calculate with them
    calculateAndDisplayPrayerTimes(
      latitude,
      longitude,
      applyLocationDefaults(appState.currentLocation.countryCode)
    );
  }

  /**
   * Saves fetched geocode data to localStorage with a timestamp.
   * @param {string} cacheKey - The key derived from lat/lon.
   * @param {object} dataToCache - The geocode JSON data.
   */
  function setCachedLocationData(cacheKey, dataToCache) {
    try {
      const itemToStore = {
        data: dataToCache,
        timestamp: Date.now(),
      };
      localStorage.setItem(cacheKey, JSON.stringify(itemToStore));
      console.log("Location data cached:", cacheKey);
    } catch (error) {
      console.error("Error saving location data to localStorage:", error);
      if (error.name === "QuotaExceededError") {
        showToast(
          "لا يمكن حفظ بيانات الموقع مؤقتًا (المساحة ممتلئة).",
          "warning",
          5000
        );
        // Consider implementing a basic cache eviction strategy here
        // (e.g., remove the oldest 'locationDataCache_' item)
      }
    }
  }
  /**
   * Saves the last known location coordinates and display text to localStorage.
   * Includes basic error handling.
   * @param {number} latitude
   * @param {number} longitude
   * @param {string} displayText - The text used to display the location.
   * @param {string} [countryCode] - ISO country code; picks the default method and madhab on the next launch.
   */
  function saveLastLocation(latitude, longitude, displayText, countryCode) {
    try {
      const locationData = {
        latitude: latitude,
        longitude: longitude,
        displayText: displayText,
        countryCode: countryCode,
        timestamp: Date.now(), // Store timestamp for potential future expiry logic
      };
      localStorage.setItem(
        STORAGE_KEY_LAST_LOCATION,
        JSON.stringify(locationData)
      );
      console.log("Saved last known location to storage:", locationData);
    } catch (error) {
      console.error(
        "Failed to save last known location to localStorage:",
        error
      );
      // Handle potential errors like QuotaExceededError
      if (error.name === "QuotaExceededError") {
        // Maybe show a non-critical toast, but avoid spamming
        // showToast('Could not save location for next time.', 'warning', 3000);
      }
    }
  }
  /**
   * Creates a cache key based on rounded latitude and longitude.
   * @param {number} latitude
   * @param {number} longitude
   * @returns {string} The generated cache key.
   */
  function getLocationCacheKey(latitude, longitude) {
    // Rounding helps cache hits for slightly different coords nearby
    const latRounded = latitude.toFixed(LOCATION_CACHE_PRECISION);
    const lonRounded = longitude.toFixed(LOCATION_CACHE_PRECISION);
    return `${STORAGE_KEY_LOCATION_CACHE_PREFIX}${latRounded}_${lonRounded}`;
  }

  /**
   * Retrieves and validates cached location data from localStorage.
   * @param {string} cacheKey - The key to look up.
   * @returns {object | null} The cached data item { data, timestamp } or null if not found/invalid/expired.
   */
  function getCachedLocationData(cacheKey) {
    try {
      const cachedString = localStorage.getItem(cacheKey);
      if (!cachedString) return null;

      const cachedItem = JSON.parse(cachedString);

      // Basic validation
      if (
        !cachedItem ||
        typeof cachedItem !== "object" ||
        !cachedItem.timestamp ||
        !cachedItem.data
      ) {
        console.warn("Invalid cached location data structure found:", cacheKey);
        localStorage.removeItem(cacheKey); // Clean up invalid data
        return null;
      }

      // Check expiry
      const isExpired =
        Date.now() - cachedItem.timestamp > LOCATION_CACHE_EXPIRY_MS;
      if (isExpired) {
        console.log("Location cache expired:", cacheKey);
        localStorage.removeItem(cacheKey); // Remove expired data
        return null;
      }

      // Return the valid, non-expired item (including timestamp for potential future use)
      return cachedItem;
    } catch (error) {
      console.error("Error retrieving/parsing cached location data:", error);
      // Attempt to remove potentially corrupted data
      try {
        localStorage.removeItem(cacheKey);
      } catch (e) {
        /* ignore cleanup error */
      }
      return null;
    }
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
    if (domRefs.madhabSelect) {
      domRefs.madhabSelect.value =
        localStorage.getItem(STORAGE_KEY_MADHAB_CHOICE) ||
        (HANAFI_COUNTRIES.includes(countryCode) ? "Hanafi" : "Shafi");
    }
    const countryMethod = countryCode
      ? COUNTRY_TO_METHOD_MAP[countryCode]
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
      const coordinates = new adhan.Coordinates(latitude, longitude);
      const today = new Date();
      const timesForDay = (dayOffset) => {
        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);
        const params = getAdhanCalculationParameters(methodKey, coordinates, date);
        return new adhan.PrayerTimes(coordinates, date, params);
      };

      appState.currentPrayerTimes = timesForDay(0);
      appState.timelineDay = today.toDateString();
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
   * Gets the Adhan.js parameters for a method key (falling back to the default method) on one day,
   * with the madhab from its dropdown and the high-latitude rule Adhan recommends for the location.
   * Our keys are adhan.CalculationMethod names, except ISNA (Adhan's NorthAmerica).
   * @param {string} methodKey - The method key (e.g., 'Egyptian').
   * @param {adhan.Coordinates} coordinates - The location.
   * @param {Date} date - The day being calculated (Umm al-Qura's Isha changes in Ramadan).
   * @returns {object} The Adhan.js parameters object.
   */
  function getAdhanCalculationParameters(methodKey, coordinates, date) {
    const methods = adhan.CalculationMethod;
    const name = methodKey === "ISNA" ? "NorthAmerica" : methodKey;
    const params = (
      Object.hasOwn(methods, name) ? methods[name] : methods[DEFAULT_PRAYER_METHOD]
    )();
    params.madhab =
      domRefs.madhabSelect?.value === "Hanafi"
        ? adhan.Madhab.Hanafi
        : adhan.Madhab.Shafi;
    // The default rule puts both Fajr and Isha at midnight in high-latitude summers (e.g. London)
    params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coordinates);
    // Umm al-Qura's Isha is 2 hours after Maghrib in Ramadan, not 90 minutes (Adhan's docs: add 30)
    if (name === "UmmAlQura" && Number(hijriMonthFormat.format(date)) === 9) {
      params.adjustments.isha = 30;
    }
    return params;
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
    if (location && now.toDateString() !== appState.timelineDay) {
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
    setTextIfChanged(domRefs.nextPrayerName, nextName);
    setTextIfChanged(domRefs.stickyNextPrayer, nextName);
    setTextIfChanged(
      domRefs.stickyCountdownTime,
      domRefs.countdown?.textContent ?? ""
    );

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

    // --- Day of Week ---
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #day-of-week element
    if (domRefs.dayOfWeek) {
      try {
        domRefs.dayOfWeek.textContent = new Intl.DateTimeFormat("ar", {
          weekday: "long",
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
          { day: "numeric", month: "long", year: "numeric" }
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
            { day: "numeric", month: "long", year: "numeric" }
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
      const today = Temporal.Now.plainDateISO().withCalendar(HIJRI_CALENDAR);
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
    const coordinates = new adhan.Coordinates(latitude, longitude);
    const methodKey = domRefs.methodSelect?.value;
    const headerCells = PRAYER_DISPLAY_ORDER.map(
      (key) => `<th scope="col">${PRAYER_NAMES_AR[key]}</th>`
    ).join("");

    const rows = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      date.setHours(12, 0, 0, 0); // Midday avoids DST issues around midnight
      const params = getAdhanCalculationParameters(methodKey, coordinates, date);
      const times = new adhan.PrayerTimes(coordinates, date, params);
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

    // 5. Register Service Worker (for PWA features/caching/updates)
    registerServiceWorker();

    // 6. Setup Core Event Listeners
    domRefs.locationButton.addEventListener("click", handleLocationButtonClick);
    // The forecast popover opens/closes declaratively (popovertarget); just fill it on open.
    // Its button stays disabled until times are calculated.
    domRefs.forecastSheet?.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open") renderForecast();
    });
    // 7. Set Initial Loading/UI State (Always start skeleton)
    setPrayerTimesSkeletonState(true);
    domRefs.prayerTimesContainer.setAttribute("aria-busy", "true");

    // ---> 8. Attempt to Load Prayer Times from Stored Location <---
    let loadedFromStorage = false; // Flag to track if we loaded times automatically
    try {
      const storedLocationString = localStorage.getItem(
        STORAGE_KEY_LAST_LOCATION
      );
      if (storedLocationString) {
        const storedLocationData = JSON.parse(storedLocationString);

        // Validate the stored data
        if (
          storedLocationData &&
          typeof storedLocationData.latitude === "number" &&
          typeof storedLocationData.longitude === "number"
        ) {
          console.log(
            "Found last known location in storage:",
            storedLocationData
          );
          // Optional: Check timestamp if you want expiry logic
          // const locationAge = Date.now() - (storedLocationData.timestamp || 0);
          // if (locationAge > SOME_EXPIRY_LIMIT_MS) { ... }

          const latitude = storedLocationData.latitude;
          const longitude = storedLocationData.longitude;
          const displayText =
            storedLocationData.displayText ||
            `موقع سابق: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`; // Fallback text
          // Fill the dropdowns for the stored location's country (older saves have none)
          const countryCode = storedLocationData.countryCode;
          const methodKey = applyLocationDefaults(countryCode);

          // Update app state
          appState.currentLocation = {
            latitude,
            longitude,
            source: "storage",
            countryCode,
          };

          // Update UI immediately
          if (domRefs.locationSpan) {
            domRefs.locationSpan.textContent = displayText;
          }

          // Calculate and display times (synchronous and instant, no loading toast needed)
          calculateAndDisplayPrayerTimes(latitude, longitude, methodKey);

          loadedFromStorage = true; // Mark as loaded
        } else {
          console.log("Stored location data was invalid. Clearing.");
          localStorage.removeItem(STORAGE_KEY_LAST_LOCATION);
        }
      } else {
        console.log("No last known location found in storage.");
      }
    } catch (error) {
      console.error("Error reading or parsing stored location data:", error);
      // Clear potentially corrupted data
      try {
        localStorage.removeItem(STORAGE_KEY_LAST_LOCATION);
      } catch (e) {}
    }

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
