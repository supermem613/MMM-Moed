const NodeHelper = require("node_helper");
const Log = require("logger");
const CalendarFetcher = require("../default/calendar/calendarfetcher");
const moment = require("moment-timezone");

module.exports = NodeHelper.create({
  start: function () {
    Log.log(`Starting node helper for: ${this.name}`);
    this.fetchers = {};
    this.hebcal = null;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "ADD_MOED_CALENDAR") {
      this.createFetcher(payload);
    } else if (notification === "ADD_MOED_YAHRZEITS") {
      this.createYahrzeitItems(payload);
    }
  },

  loadHebcal: async function () {
    if (!this.hebcal) {
      this.hebcal = import("@hebcal/core");
    }

    return this.hebcal;
  },

  createFetcher: function (payload) {
    let parsedUrl;
    try {
      parsedUrl = new URL(payload.url);
    } catch (error) {
      Log.error("MMM-Moed: Malformed calendar url", payload.url, error);
      this.sendSocketNotification("MOED_ERROR", {
        id: payload.id,
        url: payload.url
      });
      return;
    }

    const key = `${payload.id}:${parsedUrl.href}`;
    let fetcher = this.fetchers[key];
    if (!fetcher) {
      fetcher = new CalendarFetcher(
        parsedUrl.href,
        payload.fetchInterval,
        payload.excludedEvents || [],
        payload.maximumEntries,
        payload.maximumNumberOfDays,
        payload.auth,
        false,
        payload.selfSignedCert
      );

      fetcher.onReceive((calendarFetcher) => {
        this.sendSocketNotification("MOED_EVENTS", {
          id: payload.id,
          url: calendarFetcher.url(),
          events: calendarFetcher.events()
        });
      });

      fetcher.onError((calendarFetcher, error) => {
        Log.error(
          "MMM-Moed: Could not fetch calendar",
          calendarFetcher.url(),
          error
        );
        this.sendSocketNotification("MOED_ERROR", {
          id: payload.id,
          url: calendarFetcher.url()
        });
      });

      this.fetchers[key] = fetcher;
    } else {
      fetcher.broadcastEvents();
    }

    fetcher.startFetch();
  },

  createYahrzeitItems: async function (payload) {
    try {
      const { HebrewCalendar, HDate, Zmanim, GeoLocation } = await this.loadHebcal();
      const timeZoneId = payload.timeZoneId || payload.timezone || "America/New_York";
      const now = payload.now ? moment.tz(payload.now, timeZoneId) : moment.tz(timeZoneId);
      const maxDate = now.clone().add(payload.maximumNumberOfDays || 45, "days").endOf("day");
      const location = this.createGeoLocation(GeoLocation, payload, timeZoneId);
      const items = [];

      for (const yahrzeit of payload.yahrzeits || []) {
        const item = this.createYahrzeitItem({
          HebrewCalendar,
          HDate,
          Zmanim,
          location,
          timeZoneId,
          yahrzeit,
          now,
          maxDate,
          referenceYear: payload.yahrzeitReferenceYear || 5700
        });

        if (item) {
          items.push(item);
        }
      }

      this.sendSocketNotification("MOED_YAHRZEITS", {
        id: payload.id,
        items
      });
    } catch (error) {
      Log.error("MMM-Moed: Could not compute yahrzeits", error);
      this.sendSocketNotification("MOED_ERROR", {
        id: payload.id,
        url: "yahrzeits"
      });
    }
  },

  createGeoLocation: function (GeoLocation, payload, timeZoneId) {
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const elevation = Number(payload.elevation || 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Yahrzeit location requires numeric latitude and longitude");
    }

    return new GeoLocation(
      payload.locationName || "Yahrzeit location",
      latitude,
      longitude,
      elevation,
      timeZoneId
    );
  },

  createYahrzeitItem: function (context) {
    const parsedDate = this.parseHebrewDate(context.yahrzeit.date);
    const currentHebrewYear = new context.HDate(context.now.toDate()).getFullYear();

    for (let year = currentHebrewYear; year <= currentHebrewYear + 2; year++) {
      const deathDate = new context.HDate(parsedDate.day, parsedDate.month, context.referenceYear);
      const observedHebrewDate = context.HebrewCalendar.getYahrzeit(year, deathDate);
      if (!observedHebrewDate) continue;

      const observedDate = this.createObservedDate(observedHebrewDate.greg(), context.timeZoneId);
      const start = this.getSunset(context.Zmanim, context.location, observedDate.clone().subtract(1, "day"), context.timeZoneId);
      const end = this.getSunset(context.Zmanim, context.location, observedDate, context.timeZoneId);
      if (end.isSameOrBefore(context.now) || start.isAfter(context.maxDate)) continue;

      const name = String(context.yahrzeit.name || "Yahrzeit").trim();
      const hebrewDate = context.yahrzeit.hebrewDate || context.yahrzeit.date;
      const id = context.yahrzeit.id || `${name}:${hebrewDate}`;

      return {
        id,
        name,
        hebrewDate,
        observedDateMs: observedDate.valueOf(),
        startMs: start.valueOf(),
        endMs: end.valueOf()
      };
    }

    return null;
  },

  createObservedDate: function (gregorianDate, timeZoneId) {
    return moment.tz(
      {
        year: gregorianDate.getFullYear(),
        month: gregorianDate.getMonth(),
        date: gregorianDate.getDate()
      },
      timeZoneId
    );
  },

  getSunset: function (Zmanim, location, date, timeZoneId) {
    const localDate = date.clone().tz(timeZoneId);
    const civilDate = new Date(localDate.year(), localDate.month(), localDate.date());
    return moment.tz(new Zmanim(location, civilDate, true).sunset(), timeZoneId);
  },

  parseHebrewDate: function (rawDate) {
    const parts = String(rawDate || "").trim().split(/\s+/);
    const day = Number(parts.shift());
    const rawMonth = parts.join(" ");
    const month = this.normalizeHebrewMonth(rawMonth);

    if (!Number.isInteger(day) || day < 1 || day > 30 || !month) {
      throw new Error(`Invalid yahrzeit Hebrew date: ${rawDate}`);
    }

    return { day, month };
  },

  normalizeHebrewMonth: function (rawMonth) {
    const key = String(rawMonth || "").toLowerCase();
    const aliases = {
      nisan: "Nisan",
      iyar: "Iyyar",
      iyyar: "Iyyar",
      sivan: "Sivan",
      tammuz: "Tammuz",
      tamuz: "Tammuz",
      av: "Av",
      elul: "Elul",
      tishrei: "Tishrei",
      tishri: "Tishrei",
      cheshvan: "Cheshvan",
      heshvan: "Cheshvan",
      kislev: "Kislev",
      tevet: "Tevet",
      shevat: "Shevat",
      shvat: "Shevat",
      adar: "Adar",
      "adar i": "Adar I",
      "adar 1": "Adar I",
      "adar ii": "Adar II",
      "adar 2": "Adar II"
    };

    return aliases[key];
  }
});
