// prayer-rules.js: which calculation method and Asr madhab a country uses, and how Adhan.js is
// set up for a day. Shared by app.js (browser global `prayerRules`) and scripts/check-times.js
// (Node), so the accuracy check tests exactly what the app runs. Needs the global `adhan`.
(function (root) {
  "use strict";

  const DEFAULT_METHOD = "MuslimWorldLeague";

  // Country codes (ISO 3166-1 alpha-2) to Adhan.js method names; other countries use DEFAULT_METHOD
  const COUNTRY_METHODS = {
    SA: "UmmAlQura",
    EG: "Egyptian",
    // Adhan's guide recommends Moonsighting Committee for North America and the UK
    US: "MoonsightingCommittee",
    CA: "MoonsightingCommittee",
    GB: "MoonsightingCommittee",
    FR: "MuslimWorldLeague",
    DE: "MuslimWorldLeague",
    PK: "Karachi",
    IR: "Tehran",
    KW: "Kuwait",
    QA: "Qatar",
    AE: "Dubai",
    SG: "Singapore",
    MY: "JAKIM",
    ID: "Kemenag",
    TR: "Turkey",
    BD: "Bangladesh",
    IN: "Karachi",
    AF: "Karachi",
    SY: "Egyptian",
    LB: "Egyptian",
    TN: "Tunisia",
    DZ: "Algeria",
    LY: "Libya",
    MA: "Morocco",
    JO: "Jordan",
    IQ: "Iraq",
    SD: "Sudan",
    YE: "UmmAlQura",
    OM: "Oman",
    BH: "Bahrain",
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
  };
  // Countries whose mosques use the Hanafi (later) Asr by default
  const HANAFI_COUNTRIES = ["PK", "IN", "BD", "AF"];

  // Authorities' own timetables, measured by scripts/check-times.js: the twilight angles, and the
  // minutes each authority adds to the plain astronomical times (then rounded to the nearest
  // minute). Methods Adhan.js lacks, plus corrections to some of its own.
  // ponytail: most are fitted on one week of October 2026 (plus June and December where the
  // authority publishes them); add other seasons to the check where they're still missing
  const OFFICIAL_METHODS = {
    // JAKIM, Malaysia: Subuh at 18 degrees, not Singapore's 20
    JAKIM: {
      base: "MuslimWorldLeague",
      fajrAngle: 18,
      ishaAngle: 18,
      minutes: { fajr: 2, sunrise: -1, dhuhr: 3, asr: 2, maghrib: 1, isha: 1 },
    },
    // Kementerian Agama, Indonesia
    Kemenag: {
      base: "MuslimWorldLeague",
      fajrAngle: 20,
      ishaAngle: 18,
      minutes: { fajr: 2, sunrise: -3, dhuhr: 4, asr: 3, maghrib: 3, isha: 2 },
    },
    // Ministry of Awqaf, Jordan
    Jordan: {
      base: "MuslimWorldLeague",
      fajrAngle: 18,
      ishaAngle: 18,
      minutes: { sunrise: -6, asr: 1, maghrib: 6, isha: 1 },
    },
    // Ministry of Habous, Morocco
    Morocco: {
      base: "MuslimWorldLeague",
      fajrAngle: 19,
      ishaAngle: 17,
      minutes: { sunrise: -3, dhuhr: 5, asr: 1, maghrib: 5 },
    },
    // Diyanet, Turkey (Adhan's approximation runs a minute early for Asr, Maghrib and Isha)
    Turkey: { base: "Turkey", minutes: { sunrise: -7, dhuhr: 5, asr: 5, maghrib: 8, isha: 1 } },
    // Moonsighting Committee's own calculator (Adhan's Asr runs a minute early)
    MoonsightingCommittee: {
      base: "MoonsightingCommittee",
      minutes: { dhuhr: 5, asr: 1, maghrib: 3 },
    },
    // Qatar Calendar House: Maghrib 2 minutes after sunset, Isha 90 minutes after that
    Qatar: { base: "Qatar", minutes: { fajr: -1, maghrib: 2, isha: 2 } },
    // Egyptian General Authority of Survey adds nothing (Adhan adds a minute to Dhuhr)
    Egyptian: { base: "Egyptian", minutes: {} },
    // UAE General Authority of Islamic Affairs (Awqaf): Asr is 1 minute after the shadow time, not 3
    Dubai: { base: "Dubai", minutes: { sunrise: -3, dhuhr: 3, asr: 1, maghrib: 3 } },
    // Ministry of Endowments and Religious Affairs, Oman (rounds up, so some days are a minute early)
    Oman: {
      base: "MuslimWorldLeague",
      fajrAngle: 18,
      ishaAngle: 18,
      minutes: { fajr: 1, sunrise: 1, dhuhr: 6, asr: 6, maghrib: 6, isha: 1 },
    },
    // Ministry of Justice, Islamic Affairs and Waqf, Bahrain: Isha by angle, also in Ramadan
    Bahrain: {
      base: "MuslimWorldLeague",
      fajrAngle: 18,
      ishaAngle: 18,
      minutes: { fajr: -1, sunrise: -1, dhuhr: 1, maghrib: 1, isha: -1 },
    },
    // Sunni Endowment Office, Iraq
    Iraq: { base: "MuslimWorldLeague", minutes: { sunrise: -1, dhuhr: 5, asr: 3, maghrib: 3 } },
    // Islamic Fiqh Academy, Sudan
    Sudan: {
      base: "MuslimWorldLeague",
      fajrAngle: 18,
      ishaAngle: 18,
      minutes: { fajr: -1, dhuhr: 3 },
    },
    // Ministry of Religious Affairs and Wakfs, Algeria
    Algeria: {
      base: "MuslimWorldLeague",
      minutes: { fajr: 1, sunrise: 1, dhuhr: 1, asr: 1, maghrib: 4, isha: 1 },
    },
    // Dar al-Ifta, Libya (October only: no other season published)
    Libya: {
      base: "MuslimWorldLeague",
      fajrAngle: 19,
      ishaAngle: 18,
      minutes: { fajr: 2, sunrise: -1, dhuhr: 3, maghrib: 3, isha: 1 },
    },
    // Tunisia's meteorology institute, whose times the Ministry of Religious Affairs shows
    Tunisia: { base: "Karachi", minutes: { dhuhr: 7, asr: 1, maghrib: 2 } },
    // Islamic Foundation Bangladesh (with Hanafi Asr, the country default)
    Bangladesh: { base: "Karachi", minutes: { fajr: 1, dhuhr: 3, asr: 7, maghrib: 3, isha: 2 } },
  };

  // Umm al-Qura month number of a date ("9" in Ramadan)
  const hijriMonthFormat = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    month: "numeric",
  });

  /**
   * The method and Asr madhab a country's mosques use by default.
   * @param {string} [countryCode] - ISO 3166-1 alpha-2 code, if known.
   * @returns {{method: string, madhab: "Shafi" | "Hanafi"}}
   */
  function countryDefaults(countryCode) {
    return {
      method: COUNTRY_METHODS[countryCode] || DEFAULT_METHOD,
      madhab: HANAFI_COUNTRIES.includes(countryCode) ? "Hanafi" : "Shafi",
    };
  }

  /**
   * Prayer times for one day at a place.
   * @param {number} latitude
   * @param {number} longitude
   * @param {Date} date - The day as a local Date (Adhan.js uses its year, month and day).
   * @param {string} methodKey - An OFFICIAL_METHODS or adhan.CalculationMethod name, or ISNA
   *   (Adhan's NorthAmerica); unknown keys fall back to DEFAULT_METHOD.
   * @param {string} madhab - "Hanafi" for the later Asr; anything else is Shafi.
   * @param {Function} [dayOf] - The day an instant falls on where the place is, as a local Date
   *   like `date`. Adhan.js calculates the solar day whose noon falls on `date` in UTC, which is
   *   the next day where the clock runs a day ahead of the sun (Samoa, Tonga, Kiribati's Line
   *   Islands); with dayOf, the date is moved so that Dhuhr falls on `date` there.
   * @returns {object} adhan.PrayerTimes
   */
  function prayerTimes(latitude, longitude, date, methodKey, madhab, dayOf) {
    const methods = adhan.CalculationMethod;
    const name = methodKey === "ISNA" ? "NorthAmerica" : methodKey;
    const official = Object.hasOwn(OFFICIAL_METHODS, name) ? OFFICIAL_METHODS[name] : null;
    const baseName = official ? official.base : name;
    const params = (
      Object.hasOwn(methods, baseName) ? methods[baseName] : methods[DEFAULT_METHOD]
    )();
    if (official) {
      if (official.fajrAngle) params.fajrAngle = official.fajrAngle;
      if (official.ishaAngle) params.ishaAngle = official.ishaAngle;
      params.methodAdjustments = {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
        ...official.minutes,
      };
      params.rounding = adhan.Rounding.Nearest;
    }
    const coordinates = new adhan.Coordinates(latitude, longitude);
    params.madhab = madhab === "Hanafi" ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
    // The default rule puts both Fajr and Isha at midnight in high-latitude summers (e.g. London)
    params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coordinates);
    // Umm al-Qura's Isha is 2 hours after Maghrib in Ramadan, not 90 minutes (Adhan's docs: add 30)
    if (name === "UmmAlQura" && Number(hijriMonthFormat.format(date)) === 9) {
      params.adjustments.isha = 30;
    }
    const times = new adhan.PrayerTimes(coordinates, date, params);
    const shiftDays = dayOf ? Math.round((date - dayOf(times.dhuhr)) / 864e5) : 0; // Rounded over DST
    if (!shiftDays) return times;
    const solarDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + shiftDays, 12);
    return new adhan.PrayerTimes(coordinates, solarDate, params);
  }

  const prayerRules = { DEFAULT_METHOD, countryDefaults, prayerTimes };
  if (typeof module === "object" && module.exports) module.exports = prayerRules;
  else root.prayerRules = prayerRules;
})(this);
