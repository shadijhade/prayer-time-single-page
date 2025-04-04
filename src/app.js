(function () {
  "use strict";

  // ==============================================
  //          Constants & Configuration
  // ==============================================

  // --- Storage Keys ---
  const STORAGE_KEY_THEME = "theme-preference";
  const STORAGE_KEY_PRAYER_METHOD = "preferredPrayerMethod";
  const STORAGE_KEY_LAST_LOCATION = "lastKnownLocation";
  const STORAGE_KEY_LOCATION_CACHE_PREFIX = "locationDataCache_";
  const STORAGE_KEY_NOTIFY_ENABLED = "notificationsEnabled";

  // --- Default Values ---
  const DEFAULT_PRAYER_METHOD = "MuslimWorldLeague";

  // --- Timing & Duration ---
  const TOAST_TRANSITION_DURATION_MS = 350; // Match CSS transition
  const GEOLOCATION_TIMEOUT_MS = 15000; // Increased timeout
  const GEOLOCATION_MAX_AGE_MS = 300000; // 5 minutes
  const LOCATION_CACHE_EXPIRY_MS = 360 * 24 * 60 * 60 * 1000; // 360 days
  const REVERSE_GEOCODE_TIMEOUT_MS = 10000; // 10 seconds
  const PRAYER_TIME_RECALC_DELAY_MS = 1500; // Delay before refreshing after prayer time passes
  const CALCULATION_RENDER_DELAY_MS = 50; // Small delay to allow skeleton UI render

  // --- API & Paths ---
  const REVERSE_GEOCODE_URL =
    "https://api.bigdatacloud.net/data/reverse-geocode-client";
  const SERVICE_WORKER_PATH = "sw.js"; // Ensure this path is correct

  // --- Caching ---
  const LOCATION_CACHE_PRECISION = 3; // Decimal places for lat/lon rounding (approx 111m)

  // --- CSS Classes & Selectors ---
  const CSS_DARK_THEME = "dark-theme";
  const CSS_ACTIVE = "active";
  const CSS_SKELETON = "skeleton";
  const CSS_SKELETON_TEXT = "skeleton-text";
  const CSS_TOAST_SHOW = "show";
  // Selectors (using const for clarity, though might be slightly overkill vs. direct strings)
  const SEL_METHOD_BTN = ".method-btn";
  const SEL_PRAYER_CARD = ".prayer-card";
  const SEL_PRAYER_TIME = ".prayer-time";
  const SEL_PRAYER_REMAINING = ".prayer-remaining";
  const SEL_TOAST_MESSAGE = ".toast-message";
  const SEL_TOAST_CLOSE = ".toast-close";
  const SEL_BTN_TEXT = ".btn-text";

  // --- Icon Strings (Keep as strings for easy embedding) ---
  const ICON_SPINNER = `<span class="material-symbols-rounded icon-spin" aria-hidden="true">progress_activity</span>`; // Or autorenew, sync
  const ICON_ERROR = `<span class="material-symbols-rounded icon-error" aria-hidden="true">error</span>`; // Or cancel
  const ICON_WARNING = `<span class="material-symbols-rounded icon-warning" aria-hidden="true">warning</span>`;
  const ICON_SUCCESS = `<span class="material-symbols-rounded icon-success" aria-hidden="true">check_circle</span>`;
  const ICON_INFO = `<span class="material-symbols-rounded icon-info" aria-hidden="true">info</span>`;
  const ICON_LOCATION = `<span class="material-symbols-rounded" aria-hidden="true">my_location</span>`; // Match button icon

  // --- Notification Constants ---
  const NOTIFICATION_ICON_PATH = "/web-app-manifest-192x192.png"; // Match SW
  const PRE_NOTIFICATION_MINUTES = 10;
  const PRAYER_NOTIFICATION_TAG_PREFIX = "prayer-";

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
    TR: "MuslimWorldLeague",
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

  // ==============================================
  //          Application State
  // ==============================================
  const appState = {
    loadingToastElement: null, // Reference to the persistent loading toast
    toastContainerElement: null, // Reference to the toast container div
    countdownIntervalId: null,
    currentLocation: null, // { latitude: number, longitude: number, source: 'user' | 'cache' | ... }
    currentPrayerTimes: null, // Instance of adhan.PrayerTimes
    isMouseEffectEnabled: false, // Track mouse effect state
    mouseEffectRAFId: null, // requestAnimationFrame ID for mouse effect
    lastKnownCurrentPrayer: null, // Last known adhan.Prayer enum (for optimizing highlight updates)
    isUpdateAvailable: false, // Flag if SW update is pending user action
    waitingServiceWorker: null, // Reference to the waiting SW instance
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
    domRefs.nextPrayerName = document.getElementById("next-prayer-name");
    domRefs.countdown = document.getElementById("countdown");
    domRefs.currentYear = document.getElementById("current-year");
    domRefs.cursorLight = document.getElementById("cursor-light");
    domRefs.mainElement = document.querySelector("main");
    domRefs.updateNotification = document.getElementById("update-notification");
    domRefs.updateButton = document.getElementById("update-button");
    domRefs.dayOfWeek = document.getElementById("day-of-week");
    domRefs.gregorianDate = document.getElementById("gregorian-date");
    domRefs.hijriDate = document.getElementById("hijri-date");
    domRefs.showForecastBtn = document.getElementById("show-forecast-btn");
    domRefs.forecastSection = document.getElementById("forecast-section");
    domRefs.forecastContainer = document.getElementById(
      "forecast-table-container"
    );
    domRefs.notifyBtn = document.getElementById("notify-btn");
    domRefs.notifyStatus = document.getElementById("notify-status");
    domRefs.iconBellOn = domRefs.notifyBtn?.querySelector(".icon-bell-on");
    domRefs.iconBellOff = domRefs.notifyBtn?.querySelector(".icon-bell-off");
  }

  // ==============================================
  //          Utility Functions
  // ==============================================

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

  /**
   * Basic HTML escaping. Important for displaying external data (like error messages) safely.
   * @param {string} unsafe - The potentially unsafe string.
   * @returns {string} Escaped string.
   */
  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return "";
    return unsafe
      .replace(/&/g, "&amp;") // Must be first
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    domRefs.htmlElement.classList.toggle(CSS_DARK_THEME, theme === "dark");
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

  /** Sets up the theme toggle functionality. */
  function setupThemeSwitcher() {
    if (!domRefs.themeToggle) return; // Only setup if toggle exists

    applyTheme(getPreferredTheme()); // Apply initial theme

    domRefs.themeToggle.addEventListener("change", () => {
      const newTheme = domRefs.themeToggle.checked ? "light" : "dark";
      applyTheme(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY_THEME, newTheme);
      } catch (e) {
        console.error("Failed to save theme preference:", e);
        // Optionally show a non-critical toast
        // showToast("لم نتمكن من حفظ تفضيل المظهر.", 'warning');
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
        enableHighAccuracy: false, // Usually sufficient and faster/less power
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
    appState.currentLocation = { latitude, longitude, source: "user" };
    console.log(
      `Geolocation success: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
    );
    saveLastLocation(
      latitude,
      longitude,
      `موقع حالي: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
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
    showToast(userMessage, "error", 5000);

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
    const storedPreferredMethod = localStorage.getItem(
      STORAGE_KEY_PRAYER_METHOD
    );
    let methodToUse = storedPreferredMethod || DEFAULT_PRAYER_METHOD;
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

    // --- Process Data (if available) & Determine Method ---
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

      const countryCode = geocodeData.countryCode?.toUpperCase(); // Ensure uppercase for map lookup
      saveLastLocation(latitude, longitude, locationDisplayText);
      // Determine method ONLY if NO preference is stored and country mapping exists
      if (
        !storedPreferredMethod &&
        countryCode &&
        COUNTRY_TO_METHOD_MAP[countryCode]
      ) {
        methodToUse = COUNTRY_TO_METHOD_MAP[countryCode];
        try {
          localStorage.setItem(STORAGE_KEY_PRAYER_METHOD, methodToUse);
          console.log(
            `Auto-set and saved method for ${countryCode}: ${methodToUse}`
          );
        } catch (e) {
          console.error("Failed to save auto-set preferred method:", e);
          // Non-critical, proceed with the determined method for this session
        }
      } else if (storedPreferredMethod) {
        console.log(`Using stored preferred method: ${storedPreferredMethod}`);
        methodToUse = storedPreferredMethod; // Ensure explicitly using stored one
      } else {
        // No stored preference, no country match (or failed geocode) -> use default
        console.log(`Using default method: ${DEFAULT_PRAYER_METHOD}`);
        methodToUse = DEFAULT_PRAYER_METHOD;
      }
    } else {
      // Handle case where cache miss/expired AND fetch failed
      console.warn(
        "No location data available. Using stored preferred or default method."
      );
      methodToUse = storedPreferredMethod || DEFAULT_PRAYER_METHOD; // Already set above, just confirming logic
    }
    // --- End Processing ---

    // --- Final UI Updates & Calculation ---
    if (domRefs.locationSpan)
      domRefs.locationSpan.textContent = locationDisplayText;
    await selectMethodButton(methodToUse, false); // Update UI button *visually* first
    await calculateAndDisplayPrayerTimes(latitude, longitude, methodToUse); // Now calculate with the determined method
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
   */
  function saveLastLocation(latitude, longitude, displayText) {
    try {
      const locationData = {
        latitude: latitude,
        longitude: longitude,
        displayText: displayText,
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

  /** Sets up initial state and event listeners for method selection buttons. */
  async function setupMethodButtons() {
    const methodBtns = document.querySelectorAll(SEL_METHOD_BTN);
    if (methodBtns.length === 0) {
      console.warn("No calculation method buttons found.");
      return;
    }

    methodBtns.forEach((btn) => {
      btn.setAttribute("aria-pressed", "false"); // A11y: Initial state
      btn.addEventListener("click", handleMethodButtonClick);
    });

    // Apply stored/default method visually on load without triggering calculation yet
    const preferredMethod =
      localStorage.getItem(STORAGE_KEY_PRAYER_METHOD) || DEFAULT_PRAYER_METHOD;
    await selectMethodButton(preferredMethod, false); // Select visually only
  }

  /** Handles clicks on calculation method buttons. */
  async function handleMethodButtonClick(event) {
    const button = event.currentTarget; // Use currentTarget for the element listener is attached to
    const selectedMethodKey = button.getAttribute("data-method");
    if (!selectedMethodKey) {
      console.error(
        "Method button clicked, but 'data-method' attribute is missing."
      );
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY_PRAYER_METHOD, selectedMethodKey);
    } catch (e) {
      console.error("Failed to save selected prayer method:", e);
      // showToast("لم نتمكن من حفظ طريقة الحساب المختارة.", 'warning');
    }

    if (appState.currentLocation) {
      // Location is known, update visually and trigger recalculation
      resetForecastViewIfOpen();
      await selectMethodButton(selectedMethodKey, true);
    } else {
      // No location yet, just update visually and maybe prompt user
      await selectMethodButton(selectedMethodKey, false);
      showToast("يرجى تحديد الموقع أولاً لحساب المواقيت.", "info", 4000);
      setPrayerTimesSkeletonState(true); // Ensure times are cleared/skeleton if location missing
      domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // Not busy if no location
    }
  }

  /**
   * Updates the visual state of method buttons and optionally triggers recalculation.
   * @param {string} methodKey - The key of the method to select (e.g., 'MuslimWorldLeague').
   * @param {boolean} [triggerCalculation=true] - Whether to recalculate times if location is known.
   */
  async function selectMethodButton(methodKey, triggerCalculation = true) {
    let foundButton = false;
    let effectiveMethodKey = methodKey; // Use this to track the actually applied method
    const methodBtns = document.querySelectorAll(SEL_METHOD_BTN); // Query fresh list

    methodBtns.forEach((btn) => {
      const isButtonForThisMethod =
        btn.getAttribute("data-method") === methodKey;
      btn.classList.toggle(CSS_ACTIVE, isButtonForThisMethod);
      btn.setAttribute(
        "aria-pressed",
        isButtonForThisMethod ? "true" : "false"
      ); // A11y state
      if (isButtonForThisMethod) foundButton = true;
    });

    // Fallback if the provided methodKey doesn't match any button
    if (!foundButton) {
      console.warn(
        `Method button for key "${methodKey}" not found. Falling back to ${DEFAULT_PRAYER_METHOD}.`
      );
      effectiveMethodKey = DEFAULT_PRAYER_METHOD;
      // Deactivate all buttons first
      methodBtns.forEach((btn) => {
        btn.classList.remove(CSS_ACTIVE);
        btn.setAttribute("aria-pressed", "false");
      });
      // Activate the default button
      const defaultButton = document.querySelector(
        `${SEL_METHOD_BTN}[data-method="${DEFAULT_PRAYER_METHOD}"]`
      );
      if (defaultButton) {
        defaultButton.classList.add(CSS_ACTIVE);
        defaultButton.setAttribute("aria-pressed", "true");
      } else {
        console.error(
          `Default method button "${DEFAULT_PRAYER_METHOD}" also not found! Cannot set active button.`
        );
      }
    }

    // Trigger calculation if requested and location is available
    if (triggerCalculation && appState.currentLocation) {
      await calculateAndDisplayPrayerTimes(
        appState.currentLocation.latitude,
        appState.currentLocation.longitude,
        effectiveMethodKey
      );
    } else if (triggerCalculation) {
      // This case should ideally be handled before calling (like in handleMethodButtonClick)
      console.warn(
        "Calculation trigger requested, but current location is unknown."
      );
    }
  }

  /**
   * Calculates prayer times using Adhan.js and updates the display.
   * @param {number} latitude
   * @param {number} longitude
   * @param {string} methodKey - The calculation method key.
   */
  async function calculateAndDisplayPrayerTimes(
    latitude,
    longitude,
    methodKey
  ) {
    if (
      typeof adhan === "undefined" ||
      typeof adhan.PrayerTimes === "undefined"
    ) {
      handleCalculationError(new Error("Adhan.js library is not loaded."));
      return;
    }

    console.log(
      `Calculating times for ${latitude.toFixed(4)}, ${longitude.toFixed(
        4
      )} using method: ${methodKey}`
    );
    setPrayerTimesSkeletonState(true); // Show loading state immediately
    domRefs.prayerTimesContainer?.setAttribute("aria-busy", "true"); // A11y: busy state
    stopCountdown(); // Stop previous countdown

    // Defer heavy calculation slightly using setTimeout to allow the browser
    // to render the skeleton UI update first, improving perceived performance.
    setTimeout(async () => {
      try {
        const coordinates = new adhan.Coordinates(latitude, longitude);
        const date = new Date(); // Use current date
        const params = await getAdhanCalculationParameters(methodKey);
        appState.currentPrayerTimes = new adhan.PrayerTimes(
          coordinates,
          date,
          params
        );

        displayPrayerTimes(appState.currentPrayerTimes); // Update UI cards
        startCountdown(); // Start new countdown for next prayer
        //showToast("تم تحديث مواقيت الصلاة بنجاح.", "success", 2500);
        enableLocationButton(); // Re-enable location button after success
        domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // A11y: no longer busy
        if (domRefs.showForecastBtn) {
          domRefs.showForecastBtn.disabled = false;
        }
        // Reset forecast if it was open
        resetForecastViewIfOpen();
        // ----> Schedule Notifications <----
        // Check if enabled *before* calling the async schedule function
        // if (
        //   localStorage.getItem(STORAGE_KEY_NOTIFY_ENABLED) === "true" &&
        //   Notification.permission === "granted"
        // ) {
        //   await schedulePrayerNotifications(appState.currentPrayerTimes);
        // } else {
        //   // If disabled, ensure any previously scheduled (for this session/day) are cleared
        //   await cancelPrayerNotifications();
        // }
        // ----> End Notification Scheduling <----
      } catch (error) {
        // Catch errors during Adhan.js calculation or parameter retrieval
        handleCalculationError(error);
      }
    }, CALCULATION_RENDER_DELAY_MS);
  }

  /**
   * Handles errors that occur during prayer time calculation.
   * @param {Error} error - The error object.
   */
  async function handleCalculationError(error) {
    console.error("Error calculating prayer times:", error);
    // Escape potential HTML in error message before displaying
    const safeErrorMessage = escapeHtml(
      error.message || "Unknown calculation error"
    );
    const userMessage = `حدث خطأ أثناء حساب المواقيت. (${safeErrorMessage})`;

    showToast(userMessage, "error", 6000);
    enableLocationButton(true, "خطأ في الحساب"); // Show error on button
    setPrayerTimesSkeletonState(true); // Ensure skeleton state on error
    domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // A11y: no longer busy (error state)
    appState.currentPrayerTimes = null; // Clear invalid/old times data
    stopCountdown(); // Stop countdown if it was running
    // --> Cancel notifications on calculation error <--
    // await cancelPrayerNotifications();
  }

  /**
   * Gets the parameter object required by Adhan.js based on the method key.
   * Handles fallback to default method if key is invalid or Adhan.js is faulty.
   * @param {string} methodKey - The method key (e.g., 'Egyptian').
   * @returns {object} The Adhan.js parameters object.
   */
  async function getAdhanCalculationParameters(methodKey) {
    // Check if Adhan.js and its core components are loaded
    if (
      typeof adhan?.CalculationMethod?.MuslimWorldLeague !== "function" ||
      typeof adhan?.Madhab?.Shafi !== "string"
    ) {
      console.error(
        "Adhan.js library or essential calculation methods/madhabs not found."
      );
      // Return a known safe default to prevent crashes, although calculations will be wrong
      // Consider throwing an error here instead if Adhan.js is critical
      return { method: "MuslimWorldLeague", madhab: "shafi" }; // Raw strings as ultimate fallback
    }

    const baseParams = { madhab: adhan.Madhab.Shafi }; // Default Madhab for methods that use it

    // Map our keys to the actual Adhan.js static calculation methods
    const methodMap = {
      MuslimWorldLeague: adhan.CalculationMethod.MuslimWorldLeague,
      Egyptian: adhan.CalculationMethod.Egyptian,
      Karachi: adhan.CalculationMethod.Karachi,
      UmmAlQura: adhan.CalculationMethod.UmmAlQura,
      Dubai: adhan.CalculationMethod.Dubai,
      MoonsightingCommittee: adhan.CalculationMethod.MoonsightingCommittee, // Likely ISNA/NorthAmerica
      NorthAmerica: adhan.CalculationMethod.NorthAmerica,
      ISNA: adhan.CalculationMethod.NorthAmerica, // ISNA is an alias for NorthAmerica in AdhanJS
      Kuwait: adhan.CalculationMethod.Kuwait,
      Qatar: adhan.CalculationMethod.Qatar,
      Singapore: adhan.CalculationMethod.Singapore,
      Tehran: adhan.CalculationMethod.Tehran,
      // Add other methods supported by Adhan.js if needed
    };

    const calculationFunction = methodMap[methodKey];
    let effectiveMethodKey = methodKey; // Track which method is actually used

    if (calculationFunction && typeof calculationFunction === "function") {
      try {
        // Some methods might not accept/require baseParams (check Adhan.js docs if unsure)
        // Known methods that take no args or specific args: UmmAlQura, Kuwait, Qatar, Tehran
        if (["UmmAlQura", "Kuwait", "Qatar", "Tehran"].includes(methodKey)) {
          // Call the function directly if it doesn't take baseParams
          return calculationFunction();
        } else {
          // Call the function with a copy of baseParams (using spread syntax)
          return calculationFunction({ ...baseParams });
        }
      } catch (e) {
        console.error(
          `Error invoking Adhan.js parameter function for method ${methodKey}:`,
          e,
          `Falling back to ${DEFAULT_PRAYER_METHOD}.`
        );
        effectiveMethodKey = DEFAULT_PRAYER_METHOD; // Update effective key
        // Fallthrough to default case below
      }
    }

    // If the methodKey was invalid, or if invoking its function failed, fallback to default
    if (effectiveMethodKey !== DEFAULT_PRAYER_METHOD) {
      // Avoid redundant warning if already default
      console.warn(
        `Invalid or unsupported method key: "${methodKey}". Falling back to ${DEFAULT_PRAYER_METHOD}.`
      );
    }
    // Update the UI to show the fallback method is active
    await selectMethodButton(DEFAULT_PRAYER_METHOD, false); // Update UI visually only
    // Return the default parameters
    try {
      return adhan.CalculationMethod.MuslimWorldLeague({ ...baseParams });
    } catch (e) {
      console.error(
        "CRITICAL: Failed to get even the default Adhan.js parameters!",
        e
      );
      // Ultimate fallback if even default fails
      return { method: "MuslimWorldLeague", madhab: "shafi" };
    }
  }

  /**
   * Updates the prayer time cards in the DOM based on calculated times.
   * @param {adhan.PrayerTimes} prayerTimes - The calculated prayer times object.
   */
  function displayPrayerTimes(prayerTimes) {
    const container = domRefs.prayerTimesContainer;
    if (!container || !prayerTimes || typeof adhan === "undefined") {
      console.error(
        "Cannot display times: Missing container, times object, or Adhan library."
      );
      setPrayerTimesSkeletonState(true); // Reset to skeleton
      domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false"); // Not busy (error state)
      return;
    }

    let currentPrayerEnum = adhan.Prayer.None;
    let nextPrayerEnum = adhan.Prayer.None;
    const now = new Date();

    try {
      currentPrayerEnum = prayerTimes.currentPrayer(now);
      nextPrayerEnum = prayerTimes.nextPrayer(now);
    } catch (e) {
      console.error("Error getting current/next prayer enum from Adhan.js:", e);
      // Continue gracefully, defaults (None) will be used
    }

    // Store the current prayer to optimize countdown highlight updates
    appState.lastKnownCurrentPrayer = currentPrayerEnum;

    // --- Update Prayer Cards ---
    // Efficiently update cards without querying inside the loop
    PRAYER_DISPLAY_ORDER.forEach((prayerKey) => {
      const card = container.querySelector(
        `${SEL_PRAYER_CARD}[data-prayer="${prayerKey}"]`
      );
      if (!card) {
        console.warn(`Prayer card element not found for: ${prayerKey}`);
        return; // Skip this card if missing
      }

      const prayerTimeDate = prayerTimes[prayerKey]; // Access time via property name
      const timeEl = card.querySelector(SEL_PRAYER_TIME);
      const remainingEl = card.querySelector(SEL_PRAYER_REMAINING);

      // Reset card state before applying new state
      card.classList.remove(CSS_ACTIVE, CSS_SKELETON);
      if (timeEl) timeEl.classList.remove(CSS_SKELETON);
      if (remainingEl) remainingEl.textContent = ""; // Clear remaining time text

      if (isValidDate(prayerTimeDate)) {
        // Set the prayer time text
        if (timeEl) timeEl.textContent = formatTimeForDisplay(prayerTimeDate);

        // Check if this prayer is the current one
        const isCurrentPrayer = prayerKey === currentPrayerEnum;
        if (isCurrentPrayer) {
          card.classList.add(CSS_ACTIVE);
          if (remainingEl) {
            remainingEl.textContent = "حان وقت الصلاة الآن";
          }
        }
      } else {
        // Handle invalid/missing time for this prayer
        if (timeEl) {
          timeEl.textContent = "--:--";
          timeEl.classList.add(CSS_SKELETON); // Show as skeleton if time is invalid
        }
        if (remainingEl) remainingEl.textContent = ""; // Ensure remaining text is cleared
        console.warn(`Invalid or missing time for prayer: ${prayerKey}`);
      }
    });

    // --- Update Next Prayer Info Section ---
    updateNextPrayerDisplay(prayerTimes, nextPrayerEnum, now);

    // Mark overall display as loaded (remove skeleton classes)
    setPrayerTimesSkeletonState(false);
    // Set aria-busy false AFTER content is potentially populated
    domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false");
  }

  /**
   * Updates the display area showing the name of the next prayer.
   * @param {adhan.PrayerTimes} prayerTimes - The current prayer times object (needed for tomorrow's Fajr).
   * @param {adhan.Prayer} nextPrayerEnum - The enum value for the next prayer.
   * @param {Date} now - The current date/time.
   */
  function updateNextPrayerDisplay(prayerTimes, nextPrayerEnum, now) {
    const nextPrayerEl = domRefs.nextPrayerName;
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #next-prayer-name element
    // <span id="next-prayer-name" aria-live="polite" aria-atomic="true">---</span>
    if (!nextPrayerEl || typeof adhan === "undefined") return;

    let nextPrayerText = "خطأ"; // Default/error text

    try {
      if (nextPrayerEnum === adhan.Prayer.None) {
        // Isha has passed, next prayer is tomorrow's Fajr
        const tomorrowFajrTime = getTomorrowFajrTime(
          prayerTimes.coordinates,
          prayerTimes.calculationParameters
        );
        if (tomorrowFajrTime) {
          // Explicitly mention it's tomorrow
          nextPrayerText = PRAYER_NAMES_AR.fajr + " (غداً)";
        } else {
          nextPrayerText = "خطأ في حساب الفجر"; // More specific error
        }
      } else {
        // Get the Arabic name from our map, fallback to the enum key if not found
        nextPrayerText = PRAYER_NAMES_AR[nextPrayerEnum] || nextPrayerEnum;
      }

      nextPrayerEl.textContent = nextPrayerText;
      nextPrayerEl.classList.remove(CSS_SKELETON_TEXT); // Ensure skeleton class is removed
    } catch (e) {
      console.error(
        "Error determining or setting next prayer name display:",
        e
      );
      nextPrayerEl.textContent = "خطأ"; // Fallback text on error
      nextPrayerEl.classList.add(CSS_SKELETON_TEXT); // Indicate error state visually
    }
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
  /**
   * Helper to calculate tomorrow's Fajr time.
   * @param {adhan.Coordinates} coordinates - Location coordinates.
   * @param {object} params - Calculation parameters.
   * @returns {Date | null} Date object for tomorrow's Fajr or null on error.
   */
  function getTomorrowFajrTime(coordinates, params) {
    if (typeof adhan?.PrayerTimes !== "function" || !coordinates || !params) {
      console.error(
        "Cannot calculate tomorrow's Fajr: Adhan library, coordinates, or params missing."
      );
      return null;
    }
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      // Setting time to 00:00:00 is implicit when creating PrayerTimes for a specific date
      const tomorrowPrayerTimes = new adhan.PrayerTimes(
        coordinates,
        tomorrow,
        params
      );
      return tomorrowPrayerTimes.fajr; // Return the Date object for Fajr
    } catch (e) {
      console.error("Could not calculate tomorrow's Fajr time:", e);
      return null;
    }
  }

  /** Stops the countdown interval timer. */
  function stopCountdown() {
    if (appState.countdownIntervalId) {
      clearInterval(appState.countdownIntervalId);
      appState.countdownIntervalId = null;
      console.log("Countdown stopped.");
    }
    // Optional: Immediately reset countdown display to placeholder when stopped explicitly
    // updateCountdownDisplay(-1); // Show placeholder/error state like '--:--:--'
  }

  /** Starts the countdown timer to the next prayer. */
  function startCountdown() {
    stopCountdown(); // Ensure no previous interval is running

    // Check required elements and state
    if (
      !domRefs.countdown ||
      !domRefs.nextPrayerName ||
      !domRefs.prayerTimesContainer
    ) {
      console.error(
        "Cannot start countdown: Required DOM elements are missing."
      );
      return;
    }
    if (
      !appState.currentPrayerTimes ||
      !appState.currentPrayerTimes.coordinates ||
      !appState.currentPrayerTimes.calculationParameters
    ) {
      console.error(
        "Cannot start countdown: Prayer times data with coordinates/parameters is missing."
      );
      updateCountdownDisplay(-1); // Show error state
      return;
    }

    // Cache prayer card elements *once* before starting the interval for performance
    const prayerCardsMap = new Map(); // Use a Map for easier lookup by prayerKey
    domRefs.prayerTimesContainer
      .querySelectorAll(SEL_PRAYER_CARD)
      .forEach((card) => {
        const key = card.getAttribute("data-prayer");
        if (key) prayerCardsMap.set(key, card);
      });

    // The function that runs every second
    function updateCountdownTick() {
      // Re-check essential data; it might have been cleared by an error elsewhere
      if (!appState.currentPrayerTimes || typeof adhan === "undefined") {
        handleCountdownError(
          "Prayer times data or Adhan library became unavailable during countdown."
        );
        return;
      }

      const now = new Date();
      let nextPrayerEnum = adhan.Prayer.None;
      let nextPrayerTime = null;
      let timeDifferenceMillis = -1;
      let isNextPrayerTomorrow = false; // Flag for display logic

      try {
        // Ensure coordinates and parameters are still valid (defensive check)
        if (
          !appState.currentPrayerTimes.coordinates ||
          !appState.currentPrayerTimes.calculationParameters
        ) {
          throw new Error(
            "Missing coordinates or parameters in currentPrayerTimes state."
          );
        }

        // Determine the next prayer based on the current time
        nextPrayerEnum = appState.currentPrayerTimes.nextPrayer(now);

        if (nextPrayerEnum === adhan.Prayer.None) {
          // If nextPrayer is None, it means Isha has passed. Calculate tomorrow's Fajr.
          nextPrayerTime = getTomorrowFajrTime(
            appState.currentPrayerTimes.coordinates,
            appState.currentPrayerTimes.calculationParameters
          );
          if (!nextPrayerTime) {
            // This should ideally not happen if calculation worked initially, but handle it.
            throw new Error(
              "Failed to calculate tomorrow's Fajr time for countdown."
            );
          }
          isNextPrayerTomorrow = true; // Mark that the target is tomorrow
        } else {
          // Get the time for the determined next prayer
          nextPrayerTime =
            appState.currentPrayerTimes.timeForPrayer(nextPrayerEnum);
          if (!isValidDate(nextPrayerTime)) {
            // This indicates a potential issue with Adhan.js or the input data
            throw new Error(
              `Invalid Date object received for next prayer: ${nextPrayerEnum}`
            );
          }
        }

        // Calculate the difference in milliseconds
        timeDifferenceMillis = nextPrayerTime.getTime() - now.getTime();
      } catch (e) {
        // Catch errors specifically from time calculation/retrieval within the tick
        handleCountdownError(
          `Error during countdown time calculation: ${e.message}`
        );
        return; // Stop this tick's execution
      }

      // Check if the prayer time has been reached or passed
      if (timeDifferenceMillis <= 0) {
        handleNextPrayerTimeReached(); // Trigger refresh logic
        return; // Stop this tick; refresh will start a new countdown
      }

      // --- Update UI Elements ---

      // 1. Update the main countdown timer display (e.g., HH:MM:SS)
      updateCountdownDisplay(timeDifferenceMillis / 1000); // Convert ms to seconds

      // 2. Update the "Next Prayer" name display (only if needed)
      // This check prevents unnecessary DOM updates if the name hasn't changed.
      const expectedNextPrayerName = isNextPrayerTomorrow
        ? PRAYER_NAMES_AR.fajr + " (غداً)"
        : PRAYER_NAMES_AR[nextPrayerEnum] || nextPrayerEnum; // Use map or fallback to key

      if (
        domRefs.nextPrayerName &&
        domRefs.nextPrayerName.textContent !== expectedNextPrayerName
      ) {
        domRefs.nextPrayerName.textContent = expectedNextPrayerName;
        domRefs.nextPrayerName.classList.remove(CSS_SKELETON_TEXT); // Ensure no skeleton style
        console.log(
          "Next prayer name display updated to:",
          expectedNextPrayerName
        ); // Debug log
      }

      // 3. Update the currently active prayer card highlighting
      // This only performs DOM changes if the *current* prayer has changed since the last check.
      updateActiveCardHighlight(now, prayerCardsMap);
    } // --- End of updateCountdownTick function ---

    // --- Start the Interval ---
    // Initial immediate call to set the display right away
    updateCountdownTick();
    // Set up the interval to run the tick function every second
    appState.countdownIntervalId = setInterval(updateCountdownTick, 1000);
    console.log("Countdown started.");
  }

  /**
   * Handles errors occurring within the countdown interval.
   * @param {string} errorMessage - A description of the error.
   */
  function handleCountdownError(errorMessage) {
    console.error("Countdown error:", errorMessage);
    stopCountdown(); // Stop the faulty interval
    updateCountdownDisplay(-1); // Show error state (e.g., --:--:--)
    if (domRefs.nextPrayerName) {
      domRefs.nextPrayerName.textContent = "خطأ";
      domRefs.nextPrayerName.classList.add(CSS_SKELETON_TEXT);
    }
    // Consider showing a toast, but be mindful of spamming if the error persists every second
    // showToast("خطأ في تحديث الوقت المتبقي.", 'error', 5000);
  }

  /**
   * Called when the countdown reaches zero or less. Stops the current
   * countdown and triggers a recalculation/refresh of prayer times.
   */
  async function handleNextPrayerTimeReached() {
    console.log(
      "Next prayer time reached or passed. Updating display and triggering refresh..."
    );
    stopCountdown(); // Stop the current interval immediately
    updateCountdownDisplay(0); // Briefly show 00:00:00

    // Schedule a refresh after a short delay to allow time for propagation
    // and to avoid potential race conditions.
    setTimeout(async () => {
      // Double-check if a refresh is still needed and possible
      // (e.g., user hasn't navigated away, location data still exists)
      if (
        document.getElementById(
          "countdown"
        ) /* Check if element still exists */ &&
        appState.currentLocation
      ) {
        console.log(
          "Refreshing prayer times automatically after time reached."
        );
        // Get the *currently selected* method from the UI or storage
        const activeMethodBtn = document.querySelector(
          `${SEL_METHOD_BTN}.${CSS_ACTIVE}`
        );
        const currentMethodKey =
          activeMethodBtn?.getAttribute("data-method") ||
          localStorage.getItem(STORAGE_KEY_PRAYER_METHOD) ||
          DEFAULT_PRAYER_METHOD;

        // Trigger a full recalculation and display update
        await calculateAndDisplayPrayerTimes(
          appState.currentLocation.latitude,
          appState.currentLocation.longitude,
          currentMethodKey
        );
      } else if (!appState.currentLocation) {
        // If location was lost somehow, we can't auto-refresh
        console.warn(
          "Cannot refresh prayer times automatically: Location data is missing."
        );
        showToast(
          "لا يمكن تحديث المواقيت تلقائياً (الموقع غير معروف).",
          "warning",
          5000
        );
        setPrayerTimesSkeletonState(true); // Reset to skeleton if location is lost
        domRefs.prayerTimesContainer?.setAttribute("aria-busy", "false");
      } else {
        console.log("Automatic refresh skipped (e.g., UI elements removed).");
      }
    }, PRAYER_TIME_RECALC_DELAY_MS); // Use constant for delay
  }

  /**
   * Optimizes updating the active prayer card highlight within the countdown.
   * Only changes classes if the current prayer actually changes.
   * @param {Date} now - The current time.
   * @param {Map<string, HTMLElement>} prayerCardsMap - Map of prayer keys to card elements.
   */
  function updateActiveCardHighlight(now, prayerCardsMap) {
    // Defensive checks
    if (!appState.currentPrayerTimes || typeof adhan === "undefined") return;

    let currentPrayerEnum = adhan.Prayer.None;
    try {
      // Determine the *actual* current prayer based on the exact time 'now'
      currentPrayerEnum = appState.currentPrayerTimes.currentPrayer(now);
    } catch (e) {
      console.warn(
        "Could not determine current prayer in countdown update:",
        e
      );
      // Use the last known good value as a fallback, or None
      currentPrayerEnum = appState.lastKnownCurrentPrayer || adhan.Prayer.None;
    }

    // Compare with the last known current prayer. Only update DOM if it changed.
    // This is the core optimization for this function.
    if (currentPrayerEnum !== appState.lastKnownCurrentPrayer) {
      console.log(
        `Current prayer changed: ${appState.lastKnownCurrentPrayer} -> ${currentPrayerEnum}`
      );

      // Deactivate the previously active card
      const previousCard = prayerCardsMap.get(appState.lastKnownCurrentPrayer);
      if (previousCard) {
        previousCard.classList.remove(CSS_ACTIVE);
        const remainingEl = previousCard.querySelector(SEL_PRAYER_REMAINING);
        if (remainingEl) remainingEl.textContent = ""; // Clear "now" text
      }

      // Activate the new current prayer card
      const currentCard = prayerCardsMap.get(currentPrayerEnum);
      if (currentCard) {
        currentCard.classList.add(CSS_ACTIVE);
        const remainingEl = currentCard.querySelector(SEL_PRAYER_REMAINING);
        if (remainingEl) {
          // Set text indicating the prayer is current
          remainingEl.textContent = "حان وقت الصلاة الآن";
        }
      } else if (currentPrayerEnum !== adhan.Prayer.None) {
        // Log if we expect a card but didn't find it (e.g., data-prayer mismatch)
        console.warn(
          `Card element not found in map for newly current prayer: ${currentPrayerEnum}`
        );
      }

      // Update the state tracking the last known current prayer
      appState.lastKnownCurrentPrayer = currentPrayerEnum;
    }
    // If currentPrayerEnum === appState.lastKnownCurrentPrayer, do nothing.
  }

  /**
   * Updates the countdown display element (e.g., HH:MM:SS).
   * @param {number} totalSeconds - Remaining time in seconds. Negative or NaN shows placeholder.
   */
  function updateCountdownDisplay(totalSeconds) {
    const el = domRefs.countdown;
    // **Accessibility:** Add aria-live="polite" aria-atomic="true" to the HTML #countdown element
    // <span id="countdown" aria-live="polite" aria-atomic="true">--:--:--</span>
    if (!el) return;

    if (isNaN(totalSeconds) || totalSeconds < 0) {
      // Display placeholder/error state consistently
      el.textContent = "--:--:--";
      el.classList.add(CSS_SKELETON_TEXT);
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

    // Toggle skeleton on the cards themselves (optional, for background/layout)
    container.querySelectorAll(SEL_PRAYER_CARD).forEach((card) => {
      card.classList.toggle(CSS_SKELETON, showSkeleton);
      if (showSkeleton) {
        // Ensure card is not marked active and clear remaining text during skeleton state
        card.classList.remove(CSS_ACTIVE);
        const remainingEl = card.querySelector(SEL_PRAYER_REMAINING);
        if (remainingEl) remainingEl.textContent = "";
      }
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

    // Stop countdown when entering skeleton state.
    // Clear prayer times data as it's no longer represented by the UI.
    if (showSkeleton) {
      stopCountdown();
      appState.currentPrayerTimes = null;
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

  /** Initializes the cursor light effect if not on a touch device. */
  function initializeMouseEffects() {
    const lightElement = domRefs.cursorLight;
    const mainArea = domRefs.mainElement;

    if (!lightElement || !mainArea) {
      console.warn(
        "Cursor light effect disabled: Required elements (#cursor-light, main) not found."
      );
      return;
    }

    // Enhanced touch detection (more reliable than just 'ontouchstart')
    const hasTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer:coarse)").matches;

    if (hasTouch) {
      console.log("Touch input detected, disabling cursor light effect.");
      lightElement.style.display = "none"; // Hide the element permanently
      appState.isMouseEffectEnabled = false;
      return; // Do not add listeners
    }

    // Proceed only for non-touch devices
    console.log("Initializing cursor light effect for pointer device.");
    appState.isMouseEffectEnabled = true;

    // Style setup (ensure these are safe to apply)
    lightElement.style.opacity = "0"; // Start hidden
    lightElement.style.position = "absolute"; // Needed for positioning
    lightElement.style.pointerEvents = "none"; // Prevent interference with clicks/hovers
    lightElement.style.willChange = "transform"; // Hint browser about upcoming changes

    let mouseX = 0,
      mouseY = 0;
    // Cache prayer cards *potentially* affected by the glow.
    // This needs to be refreshed if the cards change (e.g., after calculation).
    let potentiallyAffectedCards = [];
    function refreshAffectedCards() {
      potentiallyAffectedCards = Array.from(
        mainArea.querySelectorAll(`${SEL_PRAYER_CARD}:not(.${CSS_ACTIVE})`)
      );
    }

    // The function run by requestAnimationFrame
    function updateEffectFrame() {
      // Exit early if effect was disabled or element removed
      if (!appState.isMouseEffectEnabled || !domRefs.mainElement) return;

      const mainRect = mainArea.getBoundingClientRect(); // Get dimensions in frame
      // Calculate light position relative to the main element's top-left corner
      const lightX = mouseX - mainRect.left - lightElement.offsetWidth / 2;
      const lightY = mouseY - mainRect.top - lightElement.offsetHeight / 2;

      // Apply position using translate3d for potential hardware acceleration
      lightElement.style.transform = `translate3d(${lightX}px, ${lightY}px, 0)`;

      // Update glow effect on relevant cards
      potentiallyAffectedCards.forEach((card) => {
        // Double-check if the card became active since caching, or if it's still valid
        if (card.isConnected && !card.classList.contains(CSS_ACTIVE)) {
          updateCardGlow(card, mouseX, mouseY);
        } else {
          // Card became active or removed, reset its glow properties
          resetCardGlow(card);
          // Optional: Remove from potentiallyAffectedCards array here? (Might be complex)
        }
      });

      appState.mouseEffectRAFId = null; // Signal that the frame is done
    }

    // Request animation frame when mouse moves
    function scheduleEffectUpdate(event) {
      mouseX = event.clientX;
      mouseY = event.clientY;
      // Only request a new frame if one isn't already pending and effect is enabled
      if (!appState.mouseEffectRAFId && appState.isMouseEffectEnabled) {
        appState.mouseEffectRAFId = requestAnimationFrame(updateEffectFrame);
      }
    }

    // Fade in light and refresh card list on entering the main area
    function handleMouseEnter() {
      if (!appState.isMouseEffectEnabled) return;
      refreshAffectedCards(); // Update the list of cards to affect
      lightElement.style.opacity = "1"; // Fade in
      // Ensure an update runs even if mouse stops immediately after entering
      if (!appState.mouseEffectRAFId) {
        appState.mouseEffectRAFId = requestAnimationFrame(updateEffectFrame);
      }
    }

    // Fade out light, cancel pending frame, and reset glows on leaving
    function handleMouseLeave() {
      if (!appState.isMouseEffectEnabled) return;
      if (appState.mouseEffectRAFId) {
        cancelAnimationFrame(appState.mouseEffectRAFId);
        appState.mouseEffectRAFId = null;
      }
      lightElement.style.opacity = "0"; // Fade out
      // Reset glow on all cards when mouse leaves the tracked area
      mainArea.querySelectorAll(SEL_PRAYER_CARD).forEach(resetCardGlow);
    }

    // Add listeners with passive: true as we don't preventDefault
    mainArea.addEventListener("mousemove", scheduleEffectUpdate, {
      passive: true,
    });
    mainArea.addEventListener("mouseenter", handleMouseEnter, {
      passive: true,
    });
    mainArea.addEventListener("mouseleave", handleMouseLeave, {
      passive: true,
    });

    // Ensure cards are reset initially
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
        // '-u-ca-islamic' specifies the Islamic calendar system.
        // '-umalqura' is optional, for the Umm al-Qura variant if supported/needed.
        // Example format: ٢٢ ذو القعدة ١٤٤٤ هـ
        domRefs.hijriDate.textContent = new Intl.DateTimeFormat(
          "ar-SA-u-ca-islamic",
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
            "ar-u-ca-islamic",
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
  }
  // ==============================================
  //          Push Notification Handling
  // ==============================================

  /** Checks if Notifications are supported */
  function notificationsSupported() {
    return (
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    );
  }

  /** Updates the Notification Button UI based on permission and enabled state */
  function updateNotificationButtonUI() {
    if (!domRefs.notifyBtn) return;

    const permission = Notification.permission;
    const isEnabled =
      localStorage.getItem(STORAGE_KEY_NOTIFY_ENABLED) === "true";
    const textSpan = domRefs.notifyBtn.querySelector(".btn-text");

    // Reset icons first
    if (domRefs.iconBellOn) domRefs.iconBellOn.hidden = true;
    if (domRefs.iconBellOff) domRefs.iconBellOff.hidden = true;

    if (permission === "denied") {
      domRefs.notifyBtn.disabled = true;
      domRefs.notifyBtn.setAttribute("aria-pressed", "false");
      domRefs.notifyBtn.dataset.state = "denied";
      if (textSpan) textSpan.textContent = "تم رفض الإشعارات";
      if (domRefs.iconBellOff) domRefs.iconBellOff.hidden = false; // Show bell off
      if (domRefs.notifyStatus)
        domRefs.notifyStatus.textContent = "تم حظر الإشعارات من قبل المتصفح.";
    } else if (permission === "granted") {
      domRefs.notifyBtn.disabled = false;
      domRefs.notifyBtn.dataset.state = isEnabled ? "enabled" : "disabled";
      domRefs.notifyBtn.setAttribute(
        "aria-pressed",
        isEnabled ? "true" : "false"
      );
      if (textSpan)
        textSpan.textContent = isEnabled
          ? "تعطيل الإشعارات"
          : "تفعيل الإشعارات";
      if (isEnabled && domRefs.iconBellOn) domRefs.iconBellOn.hidden = false; // Show bell on if enabled
      if (!isEnabled && domRefs.iconBellOff) domRefs.iconBellOff.hidden = false; // Show bell off if disabled
      if (domRefs.notifyStatus)
        domRefs.notifyStatus.textContent = isEnabled ? "الإشعارات مفعلة." : "";
    } else {
      // default
      domRefs.notifyBtn.disabled = false;
      domRefs.notifyBtn.setAttribute("aria-pressed", "false");
      domRefs.notifyBtn.dataset.state = "default";
      if (textSpan) textSpan.textContent = "تفعيل الإشعارات";
      if (domRefs.iconBellOff) domRefs.iconBellOff.hidden = false; // Show bell off
      if (domRefs.notifyStatus)
        domRefs.notifyStatus.textContent = "انقر لتفعيل إشعارات مواقيت الصلاة.";
    }
  }

  /** Handles click on the notification toggle button */
  async function handleNotificationToggle() {
    if (!notificationsSupported() || !domRefs.notifyBtn) {
      showToast("الإشعارات غير مدعومة في هذا المتصفح.", "warning");
      if (domRefs.notifyBtn) domRefs.notifyBtn.disabled = true;
      return;
    }

    const currentState =
      domRefs.notifyBtn.getAttribute("aria-pressed") === "true";
    const currentPermission = Notification.permission;

    // --- Disable Flow ---
    if (currentState) {
      console.log("Disabling notifications.");
      localStorage.removeItem(STORAGE_KEY_NOTIFY_ENABLED);
      updateNotificationButtonUI();
      await cancelPrayerNotifications(); // Attempt to cancel scheduled
      showToast("تم تعطيل إشعارات الصلاة.", "info");
      return;
    }

    // --- Enable Flow ---
    domRefs.notifyBtn.disabled = true; // Disable while processing
    const textSpan = domRefs.notifyBtn.querySelector(".btn-text");
    if (textSpan) textSpan.textContent = "جاري المعالجة...";

    let permissionResult = currentPermission;

    // 1. Request Permission if needed
    if (permissionResult === "default") {
      try {
        permissionResult = await Notification.requestPermission();
      } catch (error) {
        console.error("Error requesting notification permission:", error);
        showToast("حدث خطأ أثناء طلب إذن الإشعارات.", "error");
        permissionResult = "denied"; // Assume denied on error
      }
    }

    // 2. Handle Permission Result
    if (permissionResult === "granted") {
      localStorage.setItem(STORAGE_KEY_NOTIFY_ENABLED, "true");
      updateNotificationButtonUI();
      showToast("تم تفعيل الإشعارات بنجاح!", "success");
      // Schedule notifications for current times if available
      if (appState.currentPrayerTimes) {
        await schedulePrayerNotifications(appState.currentPrayerTimes);
      } else {
        showToast("سيتم جدولة الإشعارات عند حساب المواقيت.", "info");
      }
    } else {
      // denied or dismissed (treated as denied)
      localStorage.removeItem(STORAGE_KEY_NOTIFY_ENABLED); // Ensure disabled
      updateNotificationButtonUI(); // Will show denied state
      if (permissionResult === "denied") {
        showToast(
          "تم رفض إذن الإشعارات. يرجى تمكينه من إعدادات المتصفح.",
          "warning",
          6000
        );
      }
      // No else needed for 'default' if user dismissed prompt, button resets
    }

    // Re-enable button (unless denied)
    if (permissionResult !== "denied") {
      domRefs.notifyBtn.disabled = false;
    }
  }

  /**
   * Schedules notifications for the given prayer times object.
   * @param {adhan.PrayerTimes} prayerTimes - Calculated prayer times for the day.
   */
  async function schedulePrayerNotifications(prayerTimes) {
    if (
      !notificationsSupported() ||
      Notification.permission !== "granted" ||
      !prayerTimes
    ) {
      console.log(
        "Skipping notification scheduling (not supported, permission denied, or no times)."
      );
      return;
    }
    // Ensure notifications are marked as enabled in storage
    if (localStorage.getItem(STORAGE_KEY_NOTIFY_ENABLED) !== "true") {
      console.log(
        "Skipping scheduling: Notifications are globally disabled by user preference."
      );
      return;
    }

    console.log("Attempting to schedule notifications...");

    try {
      const registration = await navigator.serviceWorker.ready; // Get active SW registration
      const now = new Date();

      // --- Cancel potentially conflicting old notifications first ---
      // Getting notifications and closing them might be unreliable for *scheduled* ones.
      // Relying on the TAG to replace is safer. We'll log any existing ones.
      const existingNotifications = await registration.getNotifications({
        includeTriggered: true,
      }); // Try to include scheduled
      let cancelledCount = 0;
      existingNotifications.forEach((notif) => {
        if (notif.tag && notif.tag.startsWith(PRAYER_NOTIFICATION_TAG_PREFIX)) {
          notif.close(); // Close active/triggered ones with our tag
          cancelledCount++;
        }
      });
      if (cancelledCount > 0)
        console.log(
          `[Notifications] Closed ${cancelledCount} existing prayer notifications.`
        );

      // --- Schedule new notifications ---
      let scheduledCount = 0;
      for (const prayerKey of PRAYER_DISPLAY_ORDER) {
        // Use display order
        const prayerTime = prayerTimes[prayerKey]; // e.g., prayerTimes.fajr
        if (!isValidDate(prayerTime)) continue; // Skip invalid times

        // --- Schedule Pre-Notification (10 mins before) ---
        const prePrayerTime = new Date(
          prayerTime.getTime() - PRE_NOTIFICATION_MINUTES * 60 * 1000
        );
        const prePrayerTag = `${PRAYER_NOTIFICATION_TAG_PREFIX}${prayerKey}-pre`;

        if (prePrayerTime > now) {
          const prePrayerTitle = `صلاة ${
            PRAYER_NAMES_AR[prayerKey] || prayerKey
          }`;
          const prePrayerBody = `سيحين وقت الأذان بعد ${PRE_NOTIFICATION_MINUTES} دقائق بإذن الله.`;

          await registration.showNotification(prePrayerTitle, {
            body: prePrayerBody,
            icon: NOTIFICATION_ICON_PATH,
            tag: prePrayerTag, // Unique tag allows replacement/closing
            timestamp: prePrayerTime.getTime(), // Schedule for the future
            // renotify: false, // Prevent re-notification if tag exists? (Might interfere with updates)
            silent: false, // Ensure it makes sound/vibrates unless user settings override
          });
          scheduledCount++;
          // console.log(`Scheduled PRE-notification for ${prayerKey} at ${prePrayerTime.toLocaleTimeString()}`);
        }

        // --- Schedule Exact Time Notification ---
        const exactPrayerTime = prayerTime;
        const exactPrayerTag = `${PRAYER_NOTIFICATION_TAG_PREFIX}${prayerKey}-exact`;

        if (exactPrayerTime > now) {
          const exactPrayerTitle = `حان الآن وقت صلاة ${
            PRAYER_NAMES_AR[prayerKey] || prayerKey
          }`;
          const exactPrayerBody = `تقبل الله منا ومنكم صالح الأعمال.`; // Example body

          await registration.showNotification(exactPrayerTitle, {
            body: exactPrayerBody,
            icon: NOTIFICATION_ICON_PATH,
            tag: exactPrayerTag,
            timestamp: exactPrayerTime.getTime(),
            // renotify: false,
            silent: false,
          });
          scheduledCount++;
          // console.log(`Scheduled EXACT notification for ${prayerKey} at ${exactPrayerTime.toLocaleTimeString()}`);
        }
      } // end for loop

      if (scheduledCount > 0) {
        console.log(
          `[Notifications] Successfully scheduled ${scheduledCount} notifications for today.`
        );
        // Optional: showToast(`تم جدولة ${scheduledCount} إشعارًا للصلاة.`, 'info', 2000);
      } else {
        console.log(
          "[Notifications] No future prayer times found for today to schedule notifications."
        );
      }
    } catch (error) {
      console.error("Error scheduling notifications:", error);
      showToast("حدث خطأ أثناء جدولة إشعارات الصلاة.", "error");
    }
  }

  /** Attempts to cancel scheduled prayer notifications by closing active ones with specific tags. */
  async function cancelPrayerNotifications() {
    if (!notificationsSupported()) return;

    console.log("Attempting to cancel prayer notifications...");
    try {
      const registration = await navigator.serviceWorker.ready;
      const notifications = await registration.getNotifications({
        includeTriggered: true,
      }); // Get potentially active/scheduled
      let cancelledCount = 0;
      notifications.forEach((notification) => {
        if (
          notification.tag &&
          notification.tag.startsWith(PRAYER_NOTIFICATION_TAG_PREFIX)
        ) {
          notification.close();
          cancelledCount++;
        }
      });
      console.log(
        `[Notifications] Closed ${cancelledCount} notifications with tag prefix '${PRAYER_NOTIFICATION_TAG_PREFIX}'.`
      );
      // Note: This might not cancel notifications scheduled with `timestamp` that haven't fired yet.
      // The most reliable way to "cancel" is to stop scheduling new ones and let existing ones expire or be replaced.
    } catch (error) {
      console.error("Error cancelling notifications:", error);
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
                // showUpdateNotification();
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

  /** Handles the click event for the forecast toggle button. */
  function handleForecastToggle() {
    if (
      !domRefs.showForecastBtn ||
      !domRefs.forecastSection ||
      !domRefs.forecastContainer
    )
      return;

    const isExpanded =
      domRefs.showForecastBtn.getAttribute("aria-expanded") === "true";

    if (isExpanded) {
      // Collapse the forecast section
      domRefs.forecastSection.hidden = true;
      domRefs.showForecastBtn.setAttribute("aria-expanded", "false");
      domRefs.forecastContainer.innerHTML = `<p class="forecast-placeholder">انقر على الزر أعلاه لعرض المواقيت المستقبلية.</p>`; // Reset content
      domRefs.forecastContainer.setAttribute("aria-busy", "false");
      const btnTextSpan = domRefs.showForecastBtn.querySelector(".btn-text");
      if (btnTextSpan) btnTextSpan.textContent = "عرض مواقيت 14 يومًا قادمة";
    } else {
      // Expand the forecast section
      if (!appState.currentLocation) {
        showToast(
          "يرجى تحديد الموقع أولاً لعرض المواقيت المستقبلية.",
          "warning",
          4000
        );
        domRefs.showForecastBtn.disabled = true; // Disable button if no location
        setTimeout(() => {
          // Re-enable after a delay
          if (domRefs.showForecastBtn) domRefs.showForecastBtn.disabled = false;
        }, 3000);
        return;
      }

      domRefs.forecastSection.hidden = false;
      domRefs.showForecastBtn.setAttribute("aria-expanded", "true");
      domRefs.forecastContainer.setAttribute("aria-busy", "true");
      domRefs.forecastContainer.innerHTML = `<p class="forecast-loading">جارِ تحميل المواقيت المستقبلية...</p>`; // Show loading state

      const btnTextSpan = domRefs.showForecastBtn.querySelector(".btn-text");
      if (btnTextSpan) btnTextSpan.textContent = "إخفاء المواقيت المستقبلية";

      // Generate and display the forecast asynchronously
      generateAndDisplayForecast().catch((error) => {
        console.error("Error generating forecast:", error);
        domRefs.forecastContainer.innerHTML = `<p class="forecast-error">حدث خطأ أثناء تحميل المواقيت المستقبلية. حاول مرة أخرى.</p>`;
        domRefs.forecastContainer.setAttribute("aria-busy", "false");
        // Optionally reset button state here too
      });
    }
  }

  /** Generates prayer times for the next 14 days and renders the table. */
  async function generateAndDisplayForecast() {
    if (!appState.currentLocation || typeof adhan === "undefined") {
      throw new Error("Location or Adhan library not available for forecast.");
    }

    console.log("Generating 14-day forecast...");
    const { latitude, longitude } = appState.currentLocation;
    const currentMethodKey =
      localStorage.getItem(STORAGE_KEY_PRAYER_METHOD) || DEFAULT_PRAYER_METHOD;
    const params = await getAdhanCalculationParameters(currentMethodKey); // Reuse existing function
    const coordinates = new adhan.Coordinates(latitude, longitude);

    const forecastData = [];
    const today = new Date(); // Start from today

    for (let i = 0; i < 14; i++) {
      // Loop 14 times (0 to 13 for today + next 13 days)
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      targetDate.setHours(12, 0, 0, 0); // Set to midday to avoid DST issues across midnight

      try {
        const prayerTimes = new adhan.PrayerTimes(
          coordinates,
          targetDate,
          params
        );
        const formattedDay = {
          date: formatForecastDate(targetDate), // Use the new helper
          fajr: formatTimeForDisplay(prayerTimes.fajr),
          sunrise: formatTimeForDisplay(prayerTimes.sunrise),
          dhuhr: formatTimeForDisplay(prayerTimes.dhuhr),
          asr: formatTimeForDisplay(prayerTimes.asr),
          maghrib: formatTimeForDisplay(prayerTimes.maghrib),
          isha: formatTimeForDisplay(prayerTimes.isha),
        };
        forecastData.push(formattedDay);
      } catch (error) {
        console.error(
          `Error calculating times for date ${targetDate
            .toISOString()
            .slice(0, 10)}:`,
          error
        );
        // Add a placeholder row for the errored day
        forecastData.push({
          date: formatForecastDate(targetDate) + " (خطأ)",
          fajr: "--:--",
          sunrise: "--:--",
          dhuhr: "--:--",
          asr: "--:--",
          maghrib: "--:--",
          isha: "--:--",
        });
      }
    }

    renderForecastTable(forecastData);
    domRefs.forecastContainer.setAttribute("aria-busy", "false");
    console.log("Forecast displayed.");
  }

  /**
   * Renders the forecast data into an HTML table.
   * @param {Array<object>} forecastData - Array of objects, each representing a day's times.
   */
  function renderForecastTable(forecastData) {
    if (!domRefs.forecastContainer) return;

    if (!forecastData || forecastData.length === 0) {
      domRefs.forecastContainer.innerHTML = `<p class="forecast-placeholder">لم يتم العثور على بيانات للمواقيت المستقبلية.</p>`;
      return;
    }

    // Build table header
    const tableHeader = `
      <thead>
          <tr>
              <th>التاريخ</th>
              <th>الفجر</th>
              <th>الشروق</th>
              <th>الظهر</th>
              <th>العصر</th>
              <th>المغرب</th>
              <th>العشاء</th>
          </tr>
      </thead>
  `;

    // Build table body rows
    const tableBodyRows = forecastData
      .map(
        (day) => `
      <tr>
          <td>${escapeHtml(day.date)}</td>
          <td>${escapeHtml(day.fajr)}</td>
          <td>${escapeHtml(day.sunrise)}</td>
          <td>${escapeHtml(day.dhuhr)}</td>
          <td>${escapeHtml(day.asr)}</td>
          <td>${escapeHtml(day.maghrib)}</td>
          <td>${escapeHtml(day.isha)}</td>
      </tr>
  `
      )
      .join(""); // Join array of row strings into one big string

    // Combine and inject into container
    domRefs.forecastContainer.innerHTML = `
    <div class="table-warpper">
      <table class="forecast-table">
          ${tableHeader}
          <tbody>
              ${tableBodyRows}
          </tbody>
      </table>
    </div>
  `;
  }

  /** Resets the forecast section if it's open */
  function resetForecastViewIfOpen() {
    if (
      domRefs.showForecastBtn &&
      domRefs.forecastSection &&
      !domRefs.forecastSection.hidden
    ) {
      console.log("Resetting forecast view due to change.");
      // Collapse the section and reset the button
      domRefs.forecastSection.hidden = true;
      domRefs.showForecastBtn.setAttribute("aria-expanded", "false");
      domRefs.forecastContainer.innerHTML = `<p class="forecast-placeholder">تم تغيير الموقع أو طريقة الحساب. انقر على الزر أعلاه لتحديث المواقيت المستقبلية.</p>`;
      domRefs.forecastContainer.setAttribute("aria-busy", "false");
      const btnTextSpan = domRefs.showForecastBtn.querySelector(".btn-text");
      if (btnTextSpan) btnTextSpan.textContent = "عرض مواقيت 14 يومًا قادمة";
      showToast(
        "تم إخفاء المواقيت المستقبلية. أعد فتحها للتحديث.",
        "info",
        3500
      );
    }
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
    await setupMethodButtons(); // Load method pref and set up buttons visually

    // 4. Initialize Interactive Features
    initializeMouseEffects(); // Setup cursor light effect (checks for touch)

    // 5. Register Service Worker (for PWA features/caching/updates)
    registerServiceWorker();

    // // Setup Notification Button Listener & Initial State
    // if (notificationsSupported() && domRefs.notifyBtn) {
    //   // domRefs.notifyBtn.addEventListener("click", handleNotificationToggle);
    //   updateNotificationButtonUI(); // Set initial button state based on permission/storage
    // } else if (domRefs.notifyBtn) {
    //   domRefs.notifyBtn.disabled = true; // Disable if not supported
    //   const textSpan = domRefs.notifyBtn.querySelector(".btn-text");
    //   if (textSpan) textSpan.textContent = "الإشعارات غير مدعومة";
    //   if (domRefs.notifyStatus)
    //     domRefs.notifyStatus.textContent = "متصفحك لا يدعم الإشعارات.";
    // }

    // 6. Setup Core Event Listeners
    domRefs.locationButton.addEventListener("click", handleLocationButtonClick);
    // Add listener for the forecast button
    if (domRefs.showForecastBtn) {
      domRefs.showForecastBtn.addEventListener("click", handleForecastToggle);
      // Initially disable forecast button if no location is loaded from storage
      if (!appState.currentLocation) {
        domRefs.showForecastBtn.disabled = true;
      }
    } else {
      console.warn("Forecast toggle button not found.");
    }
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
          const methodKey =
            localStorage.getItem(STORAGE_KEY_PRAYER_METHOD) ||
            DEFAULT_PRAYER_METHOD;

          // Update app state
          appState.currentLocation = { latitude, longitude, source: "storage" };

          // Update UI immediately
          if (domRefs.locationSpan) {
            domRefs.locationSpan.textContent = displayText;
          }
          await selectMethodButton(methodKey, false); // Update button visually

          // Calculate and display times
          showToast("جارِ تحميل المواقيت للموقع المحفوظ...", "info", 2000); // Inform user
          // No need to await here, let it run. UI is already in skeleton state.
          await calculateAndDisplayPrayerTimes(latitude, longitude, methodKey);

          loadedFromStorage = true; // Mark as loaded
        } else {
          console.log("Stored location data was invalid. Clearing.");
          localStorage.removeItem(STORAGE_KEY_LAST_LOCATION);
        }
      } else {
        updateNotificationButtonUI();
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
