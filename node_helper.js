const NodeHelper = require("node_helper");
const Log = require("logger");
const CalendarFetcher = require("../default/calendar/calendarfetcher");

module.exports = NodeHelper.create({
  start: function () {
    Log.log(`Starting node helper for: ${this.name}`);
    this.fetchers = {};
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "ADD_MOED_CALENDAR") {
      this.createFetcher(payload);
    }
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
  }
});
