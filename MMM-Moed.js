Module.register("MMM-Moed", {
  defaults: {
    maximumEntries: 8,
    maximumNumberOfDays: 45,
    fetchInterval: 4 * 60 * 60 * 1000,
    renderRefreshInterval: 5 * 60 * 1000,
    animationSpeed: 1000,
    calendars: [],
    excludedEvents: [],
    sectionLimits: {
      today: 5,
      tomorrow: 4,
      week: 5,
      later: 3
    }
  },

  getStyles: function () {
    return ["MMM-Moed.css", "font-awesome.css"];
  },

  getScripts: function () {
    return ["moment.js"];
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`);
    moment.locale(config.language);

    this.calendarData = {};
    this.error = null;
    this.loaded = false;
    this.renderRefreshTimer = null;

    for (var i = 0; i < this.config.calendars.length; i++) {
      var calendar = this.config.calendars[i];
      calendar.url = calendar.url.replace("webcal://", "http://");
      this.addCalendar(calendar);
    }

    this.startRenderRefreshTimer();
  },

  suspend: function () {
    this.stopRenderRefreshTimer();
  },

  resume: function () {
    this.startRenderRefreshTimer();
    this.updateDom(this.config.animationSpeed);
  },

  startRenderRefreshTimer: function () {
    this.stopRenderRefreshTimer();

    var interval = Number(this.config.renderRefreshInterval);
    if (!Number.isFinite(interval) || interval <= 0) return;

    var self = this;
    this.renderRefreshTimer = setInterval(function () {
      self.updateDom(self.config.animationSpeed);
    }, interval);
  },

  stopRenderRefreshTimer: function () {
    if (!this.renderRefreshTimer) return;

    clearInterval(this.renderRefreshTimer);
    this.renderRefreshTimer = null;
  },

  socketNotificationReceived: function (notification, payload) {
    if (payload && payload.id && payload.id !== this.identifier) return;

    if (notification === "MOED_EVENTS") {
      this.calendarData[payload.url] = payload.events;
      this.loaded = true;
      this.error = null;
    } else if (notification === "MOED_ERROR") {
      this.loaded = true;
      this.error = "Calendar feed unavailable";
      Log.error(`MMM-Moed: Could not fetch ${payload.url}`);
    } else {
      return;
    }

    this.updateDom(this.config.animationSpeed);
  },

  getDom: function () {
    var wrapper = document.createElement("div");
    wrapper.className = "moed small";

    if (this.error) {
      wrapper.className += " dimmed";
      wrapper.textContent = this.error;
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.className += " dimmed";
      wrapper.textContent = "Loading agenda...";
      return wrapper;
    }

    var sections = this.createSections();
    if (sections.total === 0) {
      wrapper.className += " dimmed";
      wrapper.textContent = "No upcoming calendar items.";
      return wrapper;
    }

    this.renderSection(wrapper, "Today", sections.today);
    this.renderSection(wrapper, "Tomorrow", sections.tomorrow);
    this.renderSection(wrapper, "This week", sections.week);
    this.renderSection(wrapper, "Later", sections.later);

    if (sections.hidden > 0) {
      var more = document.createElement("div");
      more.className = "ja-more dimmed";
      more.textContent = `+${sections.hidden} more upcoming`;
      wrapper.appendChild(more);
    }

    return wrapper;
  },

  renderSection: function (wrapper, title, items) {
    if (items.length === 0) return;

    var header = document.createElement("div");
    header.className = "ja-section";
    header.textContent = title;
    wrapper.appendChild(header);

    for (var i = 0; i < items.length; i++) {
      wrapper.appendChild(this.renderItem(items[i]));
    }
  },

  renderItem: function (item) {
    var row = document.createElement("div");
    row.className = `ja-row ja-${item.kind}`;
    if (item.isToday) row.className += " ja-today";

    var when = document.createElement("div");
    when.className = "ja-when light";
    when.textContent = item.when;
    row.appendChild(when);

    var body = document.createElement("div");
    body.className = "ja-body";

    var title = document.createElement("div");
    title.className = "ja-title bright";
    title.textContent = item.title;
    body.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "ja-meta dimmed";
    meta.textContent = item.meta;
    body.appendChild(meta);

    row.appendChild(body);

    if (item.badge) {
      var badge = document.createElement("div");
      badge.className = `ja-badge ja-badge-${item.badgeClass}`;
      badge.textContent = item.badge;
      row.appendChild(badge);
    }

    return row;
  },

  createSections: function () {
    var items = this.createAgendaItems();
    var sections = {
      today: [],
      tomorrow: [],
      week: [],
      later: [],
      total: 0,
      hidden: 0
    };

    for (var i = 0; i < items.length; i++) {
      var bucket = this.getBucket(items[i]);
      var limit = this.config.sectionLimits[bucket];
      if (sections.total < this.config.maximumEntries && sections[bucket].length < limit) {
        sections[bucket].push(items[i]);
        sections.total++;
      } else {
        sections.hidden++;
      }
    }

    return sections;
  },

  createAgendaItems: function () {
    var items = [];
    var seen = {};
    var calendars = this.getCalendarsByUrl();
    var now = moment();
    var maxDate = moment().startOf("day").add(this.config.maximumNumberOfDays, "days").endOf("day");

    for (var url in this.calendarData) {
      var events = this.calendarData[url];
      var calendar = calendars[url] || {};
      for (var i = 0; i < events.length; i++) {
        var item = this.createAgendaItem(events[i], calendar, now, maxDate);
        if (!item) continue;

        var dedupeKey = `${item.dayKey}:${item.kind}:${item.title.toLowerCase()}`;
        if (seen[dedupeKey]) continue;

        seen[dedupeKey] = true;
        items.push(item);
      }
    }

    items.sort(function (a, b) {
      var dateDiff = a.startMs - b.startMs;
      if (dateDiff !== 0) return dateDiff;
      var priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return a.title.localeCompare(b.title);
    });

    return items.slice(0, this.config.maximumEntries + this.countSectionOverflowAllowance());
  },

  createAgendaItem: function (event, calendar, now, maxDate) {
    var start = moment(event.startDate, "x");
    var end = moment(event.endDate, "x");

    if (!start.isValid() || start.isAfter(maxDate)) return null;
    if (event.fullDayEvent && end.isSameOrBefore(moment().startOf("day"))) return null;
    if (!event.fullDayEvent && end.isBefore(now)) return null;

    var title = this.cleanTitle(event.title);
    if (this.isExcluded(title)) return null;

    var kind = this.getKind(title, calendar);
    var sourceLabel = calendar.label || calendar.name || this.defaultLabelForKind(kind);
    var startOfToday = moment().startOf("day");
    var isToday = start.isSame(startOfToday, "day");
    var badge = this.getBadge(title, calendar, kind);

    return {
      title: title,
      kind: kind,
      badge: badge,
      badgeClass: this.getBadgeClass(badge),
      sourceLabel: sourceLabel,
      priority: this.priorityForKind(kind),
      startMs: Number(event.startDate),
      dayKey: start.format("YYYY-MM-DD"),
      isToday: isToday,
      when: this.formatWhen(start, event.fullDayEvent),
      meta: this.formatMeta(start, event.fullDayEvent, sourceLabel)
    };
  },

  getBucket: function (item) {
    var start = moment(item.startMs, "x");
    var today = moment().startOf("day");

    if (start.isSame(today, "day")) return "today";
    if (start.isSame(today.clone().add(1, "day"), "day")) return "tomorrow";
    if (start.isBefore(today.clone().add(7, "days"), "day")) return "week";
    return "later";
  },

  formatWhen: function (start, fullDayEvent) {
    if (!fullDayEvent) return start.format("h:mm A");

    var today = moment().startOf("day");
    if (start.isSame(today, "day")) return "Today";
    if (start.isSame(today.clone().add(1, "day"), "day")) return "Tomorrow";
    if (start.isBefore(today.clone().add(7, "days"), "day")) return start.format("ddd");
    return start.format("MMM D");
  },

  formatMeta: function (start, fullDayEvent, sourceLabel) {
    var date = fullDayEvent ? start.format("MMM D") : start.format("ddd, MMM D");
    return `${date} · ${sourceLabel}`;
  },

  getCalendarsByUrl: function () {
    var calendars = {};
    for (var i = 0; i < this.config.calendars.length; i++) {
      calendars[this.config.calendars[i].url] = this.config.calendars[i];
    }
    return calendars;
  },

  addCalendar: function (calendar) {
    this.sendSocketNotification("ADD_MOED_CALENDAR", {
      id: this.identifier,
      url: calendar.url,
      fetchInterval: calendar.fetchInterval || this.config.fetchInterval,
      maximumEntries: calendar.maximumEntries || this.config.maximumEntries * 3,
      maximumNumberOfDays: calendar.maximumNumberOfDays || this.config.maximumNumberOfDays,
      excludedEvents: calendar.excludedEvents || this.config.excludedEvents,
      auth: calendar.auth,
      selfSignedCert: calendar.selfSignedCert
    });
  },

  cleanTitle: function (title) {
    return String(title || "Event")
      .replace(/\\,/g, ",")
      .replace(/\s+/g, " ")
      .trim();
  },

  isExcluded: function (title) {
    var lowerTitle = title.toLowerCase();
    for (var i = 0; i < this.config.excludedEvents.length; i++) {
      if (lowerTitle.includes(String(this.config.excludedEvents[i]).toLowerCase())) {
        return true;
      }
    }
    return false;
  },

  getKind: function (title, calendar) {
    if (calendar.type) return calendar.type;

    var lower = title.toLowerCase();
    if (
      lower.includes("candle") ||
      lower.includes("havdalah") ||
      lower.includes("omer") ||
      lower.includes("rosh chodesh") ||
      lower.includes("parashat") ||
      lower.includes("shabbat") ||
      lower.includes("yom ") ||
      lower.includes("shavuot") ||
      lower.includes("sukkot") ||
      lower.includes("pesach") ||
      lower.includes("passover") ||
      lower.includes("chanukah") ||
      lower.includes("tisha b")
    ) {
      return "jewish";
    }

    return "holiday";
  },

  priorityForKind: function (kind) {
    if (kind === "jewish") return 1;
    if (kind === "personal") return 2;
    return 3;
  },

  getBadge: function (title, calendar, kind) {
    var lower = title.toLowerCase();
    if (lower.includes("rosh chodesh")) return "Rosh";
    if (lower.startsWith("erev ")) return "Erev";
    if (this.isFastDay(lower)) return "Fast";
    if (this.isMajorChag(lower)) return "Chag";
    if (this.isIsraeliDay(lower)) return "Israeli";
    if (this.isHolidayBadge(calendar, kind)) return "Holiday";
    return this.defaultBadgeForKind(kind);
  },

  getBadgeClass: function (badge) {
    return badge.toLowerCase();
  },

  isFastDay: function (lowerTitle) {
    return (
      lowerTitle.includes("ta’anis") ||
      lowerTitle.includes("ta'anis") ||
      lowerTitle.includes("taanis") ||
      lowerTitle.includes("tzom") ||
      lowerTitle.includes("asara") ||
      lowerTitle.includes("tish’a b’av") ||
      lowerTitle.includes("tish'a b'av") ||
      lowerTitle.includes("tisha b'av")
    );
  },

  isMajorChag: function (lowerTitle) {
    return (
      /^pesach (i|ii|iii|iv|v|vi|vii|viii)\b/.test(lowerTitle) ||
      lowerTitle.startsWith("shavuos") ||
      lowerTitle.startsWith("shavuot") ||
      lowerTitle.startsWith("sukkos") ||
      lowerTitle.startsWith("sukkot") ||
      lowerTitle.startsWith("shmini atzeres") ||
      lowerTitle.startsWith("shemini atzeret") ||
      lowerTitle.startsWith("simchas torah") ||
      lowerTitle.startsWith("simchat torah") ||
      /^rosh hashana( \d| ii|$)/.test(lowerTitle) ||
      lowerTitle.startsWith("yom kippur")
    );
  },

  isIsraeliDay: function (lowerTitle) {
    return (
      lowerTitle.startsWith("yom haaliyah") ||
      lowerTitle.startsWith("yom hashoah") ||
      lowerTitle.startsWith("yom hazikaron") ||
      lowerTitle.startsWith("yom haatzma") ||
      lowerTitle.startsWith("yom yerushalayim")
    );
  },

  isHolidayBadge: function (calendar, kind) {
    return kind === "holiday" || Boolean(calendar.badge);
  },

  defaultBadgeForKind: function (kind) {
    if (kind === "jewish") return "";
    if (kind === "personal") return "You";
    return "Holiday";
  },

  defaultLabelForKind: function (kind) {
    if (kind === "jewish") return "Hebcal";
    if (kind === "personal") return "Personal";
    return "Holiday";
  },

  countSectionOverflowAllowance: function () {
    return (
      this.config.sectionLimits.today +
      this.config.sectionLimits.tomorrow +
      this.config.sectionLimits.week +
      this.config.sectionLimits.later
    );
  }
});
