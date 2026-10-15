// Checks the app's prayer times against official published timetables.
// Usage: node scripts/check-times.js   (exits with 1 when a day is off; CI runs it before deploying)
//
// Each timetable is a few days an authority published for a city. The app's times for those days
// come from src/prayer-rules.js (the code the app runs) with the country's default method and
// madhab, at the city centre from src/cities/<country>.json, at the UTC offset the authority
// published in (so the check doesn't depend on the machine's time zone data).
"use strict";
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
globalThis.adhan = require(path.join(SRC, "adhan.umd.js"));
const { countryDefaults, prayerTimes } = require(path.join(SRC, "prayer-rules.js"));

const PRAYERS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

// utcOffset: hours ahead of UTC that the timetable uses.
// rows: [date, fajr, sunrise, dhuhr, asr, maghrib, isha], local times exactly as published;
// null where the authority doesn't publish that prayer.
// All fetched on 2026-10-15.
const TIMETABLES = [
  {
    city: "Istanbul",
    country: "TR",
    utcOffset: 3,
    source: "Diyanet, https://namazvakitleri.diyanet.gov.tr/tr-TR/9541/istanbul-icin-namaz-vakti",
    rows: [
      ["2026-10-15", "05:44", "07:08", "12:55", "16:00", "18:32", "19:51"],
      ["2026-10-16", "05:45", "07:09", "12:55", "15:58", "18:30", "19:49"],
      ["2026-10-17", "05:46", "07:10", "12:55", "15:57", "18:29", "19:48"],
      ["2026-10-18", "05:47", "07:11", "12:54", "15:56", "18:27", "19:47"],
      ["2026-10-19", "05:48", "07:13", "12:54", "15:55", "18:26", "19:45"],
      ["2026-10-20", "05:49", "07:14", "12:54", "15:54", "18:24", "19:44"],
      ["2026-10-21", "05:50", "07:15", "12:54", "15:53", "18:23", "19:42"],
    ],
  },
  {
    city: "Kuala Lumpur",
    country: "MY",
    utcOffset: 8,
    source: "JAKIM e-Solat, https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=week&zone=WLY01",
    rows: [
      ["2026-10-15", "05:50", "06:57", "13:02", "16:18", "19:02", "20:11"],
      ["2026-10-16", "05:50", "06:57", "13:02", "16:18", "19:02", "20:11"],
      ["2026-10-17", "05:50", "06:57", "13:01", "16:18", "19:01", "20:11"],
      ["2026-10-18", "05:50", "06:56", "13:01", "16:18", "19:01", "20:11"],
      ["2026-10-19", "05:49", "06:56", "13:01", "16:18", "19:01", "20:11"],
      ["2026-10-20", "05:49", "06:56", "13:01", "16:18", "19:00", "20:10"],
      ["2026-10-21", "05:49", "06:56", "13:01", "16:18", "19:00", "20:10"],
    ],
  },
  {
    city: "Singapore",
    country: "SG",
    utcOffset: 8,
    source: "MUIS, data.gov.sg dataset d_d441e7242e78efc566024dd5b0d9829c (Muslim Prayer Timetable 2026)",
    rows: [
      ["2026-10-15", "05:31", "06:48", "12:52", "16:06", "18:53", "20:03"],
      ["2026-10-16", "05:30", "06:48", "12:52", "16:06", "18:53", "20:03"],
      ["2026-10-17", "05:30", "06:48", "12:51", "16:07", "18:53", "20:03"],
      ["2026-10-18", "05:30", "06:48", "12:51", "16:07", "18:53", "20:02"],
      ["2026-10-19", "05:30", "06:48", "12:51", "16:07", "18:53", "20:02"],
      ["2026-10-20", "05:29", "06:47", "12:51", "16:07", "18:52", "20:02"],
      ["2026-10-21", "05:29", "06:47", "12:51", "16:07", "18:52", "20:02"],
    ],
  },
  {
    city: "Cairo",
    country: "EG",
    utcOffset: 3, // Egyptian summer time until 2026-10-29
    source: "Egyptian General Authority of Survey, https://www.esa.gov.eg/monthlymwaket.aspx (القاهرة, October)",
    rows: [
      ["2026-10-15", "05:30", "06:57", "12:41", "15:57", "18:24", "19:42"],
      ["2026-10-16", "05:31", "06:57", "12:40", "15:56", "18:23", "19:41"],
      ["2026-10-17", "05:31", "06:58", "12:40", "15:55", "18:22", "19:40"],
      ["2026-10-18", "05:32", "06:59", "12:40", "15:55", "18:21", "19:39"],
      ["2026-10-19", "05:32", "06:59", "12:40", "15:54", "18:20", "19:38"],
      ["2026-10-20", "05:33", "07:00", "12:40", "15:53", "18:19", "19:37"],
      ["2026-10-21", "05:34", "07:01", "12:40", "15:52", "18:18", "19:36"],
    ],
  },
  {
    city: "Amman",
    country: "JO",
    utcOffset: 3,
    source: "Jordan Ministry of Awqaf, https://www.awqaf.gov.jo/ar/Pages/PrayerTime (عمان، البلقاء، الزرقاء، مادبا)",
    rows: [
      ["2026-10-15", "05:18", "06:33", "12:22", "15:37", "18:10", "19:26"],
      ["2026-10-16", "05:19", "06:34", "12:22", "15:36", "18:09", "19:25"],
      ["2026-10-17", "05:19", "06:35", "12:22", "15:36", "18:08", "19:24"],
      ["2026-10-18", "05:20", "06:36", "12:22", "15:35", "18:07", "19:23"],
      ["2026-10-19", "05:21", "06:36", "12:22", "15:34", "18:06", "19:22"],
      ["2026-10-20", "05:21", "06:37", "12:22", "15:33", "18:05", "19:20"],
      ["2026-10-21", "05:22", "06:38", "12:21", "15:32", "18:04", "19:19"],
    ],
  },
  {
    city: "Casablanca",
    country: "MA",
    utcOffset: 0, // Morocco went back to GMT on 2026-09-20
    source: "Moroccan Ministry of Habous, https://www.habous.gov.ma/prieres/index.php?ville=58",
    rows: [
      ["2026-10-15", "05:07", "06:32", "12:21", "15:30", "18:01", "19:15"],
      ["2026-10-16", "05:08", "06:33", "12:21", "15:29", "18:00", "19:14"],
      ["2026-10-17", "05:09", "06:33", "12:21", "15:28", "17:59", "19:13"],
      ["2026-10-18", "05:09", "06:34", "12:21", "15:27", "17:58", "19:12"],
      ["2026-10-19", "05:10", "06:35", "12:21", "15:26", "17:57", "19:10"],
      ["2026-10-20", "05:11", "06:36", "12:20", "15:25", "17:56", "19:09"],
      ["2026-10-21", "05:12", "06:37", "12:20", "15:25", "17:54", "19:08"],
    ],
  },
  {
    city: "Makkah",
    country: "SA",
    utcOffset: 3,
    tolerance: 2, // The official Maghrib stays at 17:58 for Oct 13-15, then drops to 17:56
    source: "Umm al-Qura calendar (KACST), https://umqserv.kacst.gov.sa/api/v1/Prayer/GetPrayerByMonth?lang=en&format=24&yg=2026&mg=10&lat=21.426666&lon=39.831666&zone=3 and GetPrayerHijriMonth?yh=1448&mh=9 for Ramadan",
    rows: [
      ["2026-10-15", "05:01", "06:16", "12:07", "15:28", "17:58", "19:28"],
      ["2026-10-16", "05:01", "06:16", "12:07", "15:27", "17:56", "19:26"],
      ["2026-10-17", "05:02", "06:17", "12:07", "15:26", "17:55", "19:25"],
      ["2026-10-18", "05:02", "06:17", "12:06", "15:26", "17:54", "19:24"],
      ["2026-10-19", "05:02", "06:17", "12:06", "15:26", "17:54", "19:24"],
      ["2026-10-20", "05:03", "06:18", "12:06", "15:25", "17:53", "19:23"],
      ["2026-10-21", "05:03", "06:18", "12:06", "15:25", "17:52", "19:22"],
      // Ramadan 1448: Isha is 120 minutes after Maghrib instead of 90
      ["2027-02-08", "05:38", "06:55", "12:35", "15:50", "18:15", "20:15"],
      ["2027-02-09", "05:38", "06:55", "12:35", "15:50", "18:15", "20:15"],
      ["2027-02-10", "05:37", "06:54", "12:35", "15:51", "18:16", "20:16"],
      ["2027-02-22", "05:30", "06:46", "12:35", "15:54", "18:22", "20:22"],
      ["2027-03-08", "05:20", "06:35", "12:32", "15:55", "18:28", "20:28"],
    ],
  },
  {
    city: "Doha",
    country: "QA",
    utcOffset: 3,
    source: "Qatar Ministry of Endowments (Qatar Calendar House), https://meiaservicesext.islam.gov.qa/ServicesBrokerGatewayAPI/api/PrayerTimes?date=15-10-2026",
    rows: [
      ["2026-10-15", "04:15", "05:32", "11:20", "14:39", "17:09", "18:39"],
      ["2026-10-16", "04:15", "05:33", "11:19", "14:38", "17:08", "18:38"],
      ["2026-10-17", "04:16", "05:33", "11:19", "14:38", "17:07", "18:37"],
      ["2026-10-18", "04:16", "05:34", "11:19", "14:37", "17:06", "18:36"],
      ["2026-10-19", "04:17", "05:34", "11:19", "14:36", "17:05", "18:35"],
      ["2026-10-20", "04:17", "05:35", "11:19", "14:36", "17:04", "18:34"],
      ["2026-10-21", "04:17", "05:35", "11:19", "14:35", "17:04", "18:34"],
    ],
  },
  {
    city: "London",
    country: "GB",
    utcOffset: 1, // British Summer Time
    source: "Moonsighting Committee calculator, https://www.moonsighting.com/praytable.php?year=2026&tz=Europe/London&lat=51.5074&lon=-0.1278&method=0&both=true&time=0 (Asr(S), general Isha)",
    rows: [
      ["2026-10-15", "05:49", "07:24", "12:51", "15:33", "18:10", "19:30"],
      ["2026-10-16", "05:51", "07:26", "12:51", "15:31", "18:08", "19:28"],
      ["2026-10-17", "05:52", "07:28", "12:51", "15:29", "18:06", "19:26"],
      ["2026-10-18", "05:54", "07:29", "12:51", "15:28", "18:04", "19:24"],
      ["2026-10-19", "05:55", "07:31", "12:50", "15:26", "18:02", "19:22"],
      ["2026-10-20", "05:57", "07:33", "12:50", "15:24", "18:00", "19:20"],
      ["2026-10-21", "05:59", "07:35", "12:50", "15:23", "17:58", "19:19"],
    ],
  },
  {
    city: "New York City",
    country: "US",
    utcOffset: -4, // Eastern Daylight Time
    source: "Moonsighting Committee calculator, https://www.moonsighting.com/praytable.php?year=2026&tz=America/New_York&lat=40.7128&lon=-74.0060&method=0&both=true&time=0 (Asr(S), general Isha)",
    rows: [
      ["2026-10-15", "05:36", "07:07", "12:47", "15:47", "18:19", "19:37"],
      ["2026-10-16", "05:37", "07:08", "12:47", "15:46", "18:17", "19:35"],
      ["2026-10-17", "05:38", "07:09", "12:46", "15:45", "18:16", "19:34"],
      ["2026-10-18", "05:39", "07:11", "12:46", "15:43", "18:14", "19:33"],
      ["2026-10-19", "05:40", "07:12", "12:46", "15:42", "18:13", "19:31"],
      ["2026-10-20", "05:41", "07:13", "12:46", "15:41", "18:11", "19:30"],
      ["2026-10-21", "05:42", "07:14", "12:46", "15:40", "18:10", "19:29"],
    ],
  },
  {
    city: "Karachi",
    country: "PK",
    utcOffset: 5,
    // Publishes zawal (solar noon) instead of Dhuhr, and sunset as the start of Maghrib
    source: "Jamia Uloom-ul-Islamia Banuri Town (University of Islamic Sciences, Karachi), https://www.banuri.edu.pk/namaz-times?_chk=1&country=110-Pakistan&city=7487-Karachi%20-%20&month=10&method=1&time_method=1 (Hanafi Asr)",
    rows: [
      ["2026-10-15", "05:14", "06:30", null, "16:28", "18:05", "19:21"],
      ["2026-10-16", "05:14", "06:30", null, "16:27", "18:04", "19:20"],
      ["2026-10-17", "05:15", "06:31", null, "16:26", "18:03", "19:19"],
      ["2026-10-18", "05:15", "06:31", null, "16:25", "18:02", "19:19"],
      ["2026-10-19", "05:15", "06:32", null, "16:24", "18:02", "19:18"],
      ["2026-10-20", "05:16", "06:32", null, "16:24", "18:01", "19:17"],
      ["2026-10-21", "05:16", "06:33", null, "16:23", "18:00", "19:16"],
    ],
  },
  {
    city: "Jakarta",
    country: "ID",
    utcOffset: 7,
    // Kemenag's main site (bimasislam.kemenag.go.id) was unreachable; this is its Pusaka app's feed
    source: "Kementerian Agama (Pusaka app API), https://pusaka-auth.kemenag.go.id/api-get-prayer-times?city=KOTA%20JAKARTA (May 2025)",
    rows: [
      ["2025-05-15", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-16", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-17", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-18", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-19", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-20", "04:35", "05:51", "11:53", "15:14", "17:47", "18:59"],
      ["2025-05-21", "04:35", "05:52", "11:53", "15:14", "17:47", "19:00"],
    ],
  },
  {
    city: "Abu Dhabi",
    country: "AE",
    utcOffset: 4,
    // Every area of Abu Dhabi city (Al Hosn, Corniche, Al Mushrif, Musaffah) has the same times
    source: "General Authority of Islamic Affairs, Endowments and Zakat (Awqaf), https://www.awqaf.gov.ae/prayer-times (قائمة مواقيت الصلاة: أبوظبي / الحصن)",
    rows: [
      ["2026-10-15", "05:03", "06:17", "12:11", "15:28", "17:59", "19:12"],
      ["2026-10-16", "05:04", "06:17", "12:10", "15:28", "17:58", "19:11"],
      ["2026-10-17", "05:04", "06:18", "12:10", "15:27", "17:57", "19:10"],
      ["2026-10-18", "05:05", "06:18", "12:10", "15:26", "17:56", "19:10"],
      ["2026-10-19", "05:05", "06:19", "12:10", "15:26", "17:55", "19:09"],
      ["2026-10-20", "05:05", "06:19", "12:10", "15:25", "17:54", "19:08"],
      ["2026-10-21", "05:06", "06:20", "12:09", "15:25", "17:54", "19:07"],
      // Solstices, so a wrong twilight angle can't hide behind a minute offset
      ["2026-06-21", "04:05", "05:31", "12:27", "15:45", "19:17", "20:43"],
      ["2026-12-21", "05:39", "06:58", "12:23", "15:20", "17:42", "19:01"],
    ],
  },
  {
    city: "Dubai",
    country: "AE",
    utcOffset: 4,
    // Every area of Dubai city (Al Fahidi, Jebel Ali, Wadi Al Safa, Al Rashidiya) has the same times
    source: "General Authority of Islamic Affairs, Endowments and Zakat (Awqaf), https://www.awqaf.gov.ae/prayer-times (قائمة مواقيت الصلاة: دبي / الفهيدي)",
    rows: [
      ["2026-10-15", "05:00", "06:14", "12:07", "15:25", "17:55", "19:09"],
      ["2026-10-16", "05:00", "06:14", "12:07", "15:24", "17:54", "19:08"],
      ["2026-10-17", "05:01", "06:15", "12:07", "15:24", "17:54", "19:07"],
      ["2026-10-18", "05:01", "06:15", "12:07", "15:23", "17:53", "19:07"],
      ["2026-10-19", "05:02", "06:15", "12:07", "15:22", "17:52", "19:06"],
      ["2026-10-20", "05:02", "06:16", "12:06", "15:22", "17:51", "19:05"],
      ["2026-10-21", "05:02", "06:17", "12:06", "15:21", "17:50", "19:04"],
      ["2026-06-21", "03:59", "05:26", "12:23", "15:44", "19:15", "20:42"],
      ["2026-12-21", "05:37", "06:56", "12:20", "15:16", "17:38", "18:57"],
    ],
  },
  {
    city: "Muscat",
    country: "OM",
    utcOffset: 4,
    // Printed as 12-hour times without AM/PM
    source: "Ministry of Endowments and Religious Affairs, https://www.mara.gov.om/calendar_page2.asp (مسقط; POST year=2026&month=10&CityID=0)",
    rows: [
      ["2026-10-15", "04:49", "06:04", "11:58", "15:18", "17:47", "18:57"],
      ["2026-10-16", "04:49", "06:04", "11:58", "15:17", "17:46", "18:56"],
      ["2026-10-17", "04:49", "06:05", "11:57", "15:17", "17:45", "18:55"],
      ["2026-10-18", "04:50", "06:05", "11:57", "15:16", "17:44", "18:54"],
      ["2026-10-19", "04:50", "06:06", "11:57", "15:16", "17:43", "18:54"],
      ["2026-10-20", "04:51", "06:06", "11:57", "15:15", "17:42", "18:53"],
      ["2026-10-21", "04:51", "06:07", "11:57", "15:14", "17:42", "18:52"],
      ["2026-06-21", "03:53", "05:21", "12:14", "15:31", "19:01", "20:24"],
      ["2026-12-21", "05:24", "06:44", "12:10", "15:10", "17:30", "18:46"],
    ],
  },
  {
    city: "Manama",
    country: "BH",
    utcOffset: 3,
    // The ministry's current times are only in its apps; these are its newest published tables
    // (one national timetable, "Al Zubarah and Bahrain calendar" method since 1443/2021)
    source: "Ministry of Justice, Islamic Affairs and Waqf, https://www.islam.gov.bh/wp-content/uploads/2025/03/MOIA-Emsakia-Booklet-E-2025.pdf (Ramadan 1446) and https://www.islam.gov.bh/wp-content/uploads/2021/08/1443.pdf (calendar 1443)",
    rows: [
      ["2025-03-01", "04:43", "06:00", "11:51", "15:10", "17:40", "18:55"],
      ["2025-03-02", "04:43", "05:59", "11:51", "15:10", "17:40", "18:56"],
      ["2025-03-03", "04:42", "05:58", "11:51", "15:10", "17:41", "18:56"],
      ["2025-03-04", "04:41", "05:57", "11:50", "15:11", "17:41", "18:57"],
      ["2025-03-05", "04:40", "05:56", "11:50", "15:11", "17:42", "18:57"],
      ["2025-03-06", "04:39", "05:55", "11:50", "15:11", "17:42", "18:58"],
      ["2025-03-07", "04:38", "05:54", "11:50", "15:11", "17:43", "18:58"],
      ["2021-10-15", "04:19", "05:36", "11:25", "14:42", "17:10", "18:26"],
      ["2021-10-16", "04:19", "05:36", "11:24", "14:41", "17:09", "18:25"],
      ["2021-10-17", "04:20", "05:37", "11:24", "14:41", "17:09", "18:24"],
      ["2021-10-18", "04:20", "05:37", "11:24", "14:40", "17:08", "18:23"],
      ["2021-10-19", "04:21", "05:38", "11:24", "14:40", "17:07", "18:22"],
      ["2021-10-20", "04:21", "05:39", "11:24", "14:39", "17:06", "18:22"],
      ["2021-10-21", "04:22", "05:39", "11:23", "14:38", "17:05", "18:21"],
    ],
  },
  {
    city: "Rangamati",
    country: "BD",
    utcOffset: 6,
    // The Foundation publishes no Dhaka table online; this district poster is copied from its
    // permanent timetable book (same dates every year), printed 12-hour in Bengali digits
    source: "Islamic Foundation Bangladesh, Rangamati district office, https://islamicfoundation.rangamati.gov.bd/pages/static-pages/6990cf4635ce18e1c071a9c9 (রাঙ্গামাটি জেলার নামাযের স্থায়ী সময়সূচী)",
    rows: [
      ["2026-10-15", "04:34", "05:47", "11:41", "15:56", "17:30", "18:43"],
      ["2026-10-16", "04:35", "05:48", "11:40", "15:55", "17:29", "18:42"],
      ["2026-10-17", "04:35", "05:48", "11:40", "15:54", "17:28", "18:41"],
      ["2026-10-18", "04:36", "05:49", "11:40", "15:54", "17:27", "18:40"],
      ["2026-10-19", "04:36", "05:49", "11:40", "15:53", "17:26", "18:39"],
      ["2026-10-20", "04:36", "05:49", "11:40", "15:52", "17:26", "18:39"],
      ["2026-10-21", "04:37", "05:50", "11:39", "15:52", "17:25", "18:38"],
      ["2026-06-21", "03:41", "05:06", "11:56", "16:39", "18:42", "20:07"],
      ["2026-12-21", "05:08", "06:27", "11:53", "15:43", "17:15", "18:33"],
    ],
  },
  {
    city: "Baghdad",
    country: "IQ",
    utcOffset: 3,
    // sunniaffairs.gov.iq is offline; its home page's daily box (العراق , بغداد) survives in the
    // Wayback Machine, one snapshot per day. Printed 12-hour without AM/PM
    source: "Sunni Endowment Office (ديوان الوقف السني), https://web.archive.org/web/20221015011759/http://sunniaffairs.gov.iq/ar/ (اوقات الصلاة, daily snapshots)",
    rows: [
      ["2022-10-15", "04:44", "06:06", "11:53", "15:05", "17:32", "18:47"],
      ["2022-10-16", "04:45", "06:07", "11:53", "15:04", "17:31", "18:46"],
      ["2022-10-17", "04:46", "06:08", "11:53", "15:03", "17:29", "18:44"],
      ["2022-10-18", "04:47", "06:08", "11:53", "15:02", "17:28", "18:43"],
      ["2022-10-19", "04:47", "06:09", "11:52", "15:01", "17:27", "18:42"],
      ["2022-10-20", "04:48", "06:10", "11:52", "15:00", "17:26", "18:41"],
      ["2022-10-21", "04:49", "06:11", "11:52", "15:00", "17:25", "18:40"],
      ["2023-04-15", "04:05", "05:31", "12:07", "15:44", "18:36", "19:55"],
      ["2023-04-16", "04:04", "05:30", "12:07", "15:44", "18:37", "19:56"],
      ["2023-04-17", "04:03", "05:29", "12:07", "15:44", "18:37", "19:57"],
      ["2023-04-18", "04:01", "05:28", "12:07", "15:44", "18:38", "19:58"],
      ["2023-04-19", "04:00", "05:27", "12:07", "15:44", "18:39", "19:59"],
      ["2023-04-20", "03:58", "05:25", "12:06", "15:44", "18:40", "20:00"],
      ["2023-04-21", "03:57", "05:24", "12:06", "15:44", "18:40", "20:01"],
    ],
  },
  {
    city: "Khartoum",
    country: "SD",
    utcOffset: 3, // As printed: Sudan's offset until November 2017 (UTC+2 since)
    // Perpetual calendar (same dates every year) for العاصمة المثلثة, 15°36'N 32°31'E; irshad.gov.sd
    // is offline, so this is the Wayback Machine copy of the PDF it linked
    source: "Islamic Fiqh Academy (مجمع الفقه الإسلامي), تقويم السودان 3rd ed. 2015, https://web.archive.org/web/20190414235645id_/http://irshad.gov.sd/resources/uploads/files/ALASEMH%20ALMTHALTHA.pdf",
    rows: [
      ["2026-10-15", "05:30", "06:41", "12:38", "15:56", "18:29", "19:41"],
      ["2026-10-16", "05:30", "06:42", "12:38", "15:56", "18:28", "19:40"],
      ["2026-10-17", "05:30", "06:42", "12:38", "15:56", "18:27", "19:39"],
      ["2026-10-18", "05:30", "06:42", "12:37", "15:55", "18:27", "19:39"],
      ["2026-10-19", "05:30", "06:42", "12:37", "15:55", "18:26", "19:38"],
      ["2026-10-20", "05:30", "06:43", "12:37", "15:55", "18:26", "19:38"],
      ["2026-10-21", "05:31", "06:43", "12:37", "15:55", "18:25", "19:37"],
      ["2026-06-21", "04:59", "06:20", "12:54", "16:16", "19:23", "20:44"],
      ["2026-12-21", "05:55", "07:12", "12:51", "16:00", "18:24", "19:41"],
    ],
  },
  {
    city: "Algiers",
    country: "DZ",
    utcOffset: 1,
    // Scanned yearly calendar for مدينة الجزائر; Dhuhr is its الزوال column
    source: "Ministry of Religious Affairs and Wakfs, https://marw.gov.dz/media/calendrier/1448/Alger.pdf (pages 2, 6 and 8)",
    rows: [
      ["2026-10-15", "05:29", "06:56", "12:34", "15:44", "18:15", "19:33"],
      ["2026-10-16", "05:30", "06:56", "12:34", "15:43", "18:14", "19:32"],
      ["2026-10-17", "05:31", "06:57", "12:34", "15:42", "18:12", "19:30"],
      ["2026-10-18", "05:32", "06:58", "12:33", "15:41", "18:11", "19:29"],
      ["2026-10-19", "05:33", "06:59", "12:33", "15:40", "18:10", "19:28"],
      ["2026-10-20", "05:34", "07:00", "12:33", "15:39", "18:08", "19:27"],
      ["2026-10-21", "05:35", "07:01", "12:33", "15:38", "18:07", "19:26"],
      ["2026-06-21", "03:38", "05:30", "12:50", "16:42", "20:13", "21:55"],
      ["2026-12-21", "06:24", "07:57", "12:46", "15:18", "17:39", "19:03"],
    ],
  },
  {
    city: "Tunis",
    country: "TN",
    utcOffset: 1,
    // INM's Asr wanders ±1.5 minutes around the shadow rule over the year, so no whole-minute
    // offset keeps every month within 1 (the best leaves December to May 2 minutes late)
    tolerance: 2,
    // The Ministry of Religious Affairs' widget (https://www.affaires-religieuses.tn/public/getData/1)
    // shows only today's times, the same as INM's on 2026-10-15. Sunrise is INM's lever_coucher_gouvernorat
    source: "Institut National de la Météorologie, https://www.meteo.tn/horaire_gouvernorat/2026-10-15/342/615 (مدينة تونس)",
    rows: [
      ["2026-10-15", "05:00", "06:26", "12:12", "15:16", "17:45", "19:09"],
      ["2026-10-16", "05:01", "06:27", "12:12", "15:15", "17:44", "19:08"],
      ["2026-10-17", "05:02", "06:28", "12:12", "15:14", "17:43", "19:07"],
      ["2026-10-18", "05:03", "06:29", "12:11", "15:13", "17:41", "19:06"],
      ["2026-10-19", "05:03", "06:30", "12:11", "15:12", "17:40", "19:04"],
      ["2026-10-20", "05:04", "06:31", "12:11", "15:11", "17:39", "19:03"],
      ["2026-10-21", "05:05", "06:32", "12:11", "15:10", "17:38", "19:02"],
      ["2026-06-21", "03:08", "05:00", "12:28", "16:13", "19:44", "21:35"],
      ["2026-12-21", "05:55", "07:28", "12:24", "14:48", "17:09", "18:40"],
    ],
  },
  {
    city: "Tripoli",
    country: "LY",
    utcOffset: 2,
    // The feed behind ifta.ly's widget (today and the next 7 days); the General Authority of Awqaf's
    // widget (awqaf.gov.ly, today only) gave the same 2026-10-15
    source: "Dar al-Ifta, https://api.ifta.ly/api/v1/prayer-time (حسب التوقيت لمدينة طرابلس)",
    rows: [
      ["2026-10-15", "05:46", "07:10", "12:56", "16:06", "18:38", "19:58"],
      ["2026-10-16", "05:47", "07:11", "12:56", "16:05", "18:37", "19:56"],
      ["2026-10-17", "05:48", "07:12", "12:56", "16:04", "18:35", "19:55"],
      ["2026-10-18", "05:49", "07:13", "12:55", "16:04", "18:34", "19:54"],
      ["2026-10-19", "05:49", "07:13", "12:55", "16:03", "18:33", "19:53"],
      ["2026-10-20", "05:50", "07:14", "12:55", "16:02", "18:32", "19:52"],
      ["2026-10-21", "05:51", "07:15", "12:55", "16:01", "18:31", "19:51"],
    ],
  },
];

const toMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
// Difference in minutes, the short way round midnight
const difference = (app, official) =>
  ((((toMinutes(app) - toMinutes(official) + 720) % 1440) + 1440) % 1440) - 720;

let checkedDays = 0;
let failedDays = 0;
for (const { city, country, utcOffset, source, tolerance = 1, rows } of TIMETABLES) {
  const { cities } = require(path.join(SRC, "cities", `${country}.json`));
  const cityRow = cities.find((row) => row[1] === city);
  if (!cityRow) throw new Error(`${city} is not in src/cities/${country}.json`);
  const [, , latitude, longitude] = cityRow;
  const { method, madhab } = countryDefaults(country);
  const clock = (date) => new Date(date.getTime() + utcOffset * 3600e3).toISOString().slice(11, 16);

  for (const [date, ...official] of rows) {
    const [year, month, day] = date.split("-").map(Number);
    const times = prayerTimes(latitude, longitude, new Date(year, month - 1, day, 12), method, madhab);
    const app = PRAYERS.map((prayer) => clock(times[prayer]));
    const diffs = app.map((time, i) => (official[i] ? difference(time, official[i]) : null));
    const failed = diffs.some((diff) => Math.abs(diff) > tolerance);
    checkedDays++;
    failedDays += failed;
    const summary = PRAYERS.map((prayer, i) => `${prayer} ${diffs[i] === null ? "-" : (diffs[i] > 0 ? "+" : "") + diffs[i]}`).join("  ");
    console.log(`${failed ? "FAIL" : "ok  "} ${city.padEnd(12)} ${date}  ${summary}`);
    if (failed) {
      console.log(`       official ${official.map((time) => time ?? "--:--").join(" ")}\n       app      ${app.join(" ")}  (${method}, ${madhab})\n       ${source}`);
    }
  }
}

console.log(`\n${checkedDays - failedDays}/${checkedDays} days within tolerance (app minus official, in minutes)`);
process.exitCode = failedDays ? 1 : 0;
