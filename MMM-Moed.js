Module.register("MMM-Moed", {
  defaults: {
    maximumEntries: 8,
    maximumNumberOfDays: 45,
    fetchInterval: 4 * 60 * 60 * 1000,
    renderRefreshInterval: 5 * 60 * 1000,
    animationSpeed: 1000,
    calendars: [],
    excludedEvents: [],
    yahrzeits: [],
    timeZoneId: null,
    locationName: null,
    latitude: null,
    longitude: null,
    elevation: 0,
    yahrzeitReferenceYear: 5700,
    yahrzeitRefreshInterval: 4 * 60 * 60 * 1000,
    frameWidth: 300 // px width of the rendered module column; raise to align with neighbouring modules
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
    this.yahrzeitData = [];
    this.error = null;
    this.loaded = false;
    this.renderRefreshTimer = null;
    this.yahrzeitRefreshTimer = null;

    for (var i = 0; i < this.config.calendars.length; i++) {
      var calendar = this.config.calendars[i];
      calendar.url = calendar.url.replace("webcal://", "http://");
      this.addCalendar(calendar);
    }

    this.addYahrzeits();
    this.startYahrzeitRefreshTimer();
    this.startRenderRefreshTimer();
  },

  suspend: function () {
    this.stopRenderRefreshTimer();
    this.stopYahrzeitRefreshTimer();
  },

  resume: function () {
    this.addYahrzeits();
    this.startYahrzeitRefreshTimer();
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

  startYahrzeitRefreshTimer: function () {
    this.stopYahrzeitRefreshTimer();

    if (!this.hasYahrzeits()) return;

    var interval = Number(this.config.yahrzeitRefreshInterval);
    if (!Number.isFinite(interval) || interval <= 0) return;

    var self = this;
    this.yahrzeitRefreshTimer = setInterval(function () {
      self.addYahrzeits();
    }, interval);
  },

  stopYahrzeitRefreshTimer: function () {
    if (!this.yahrzeitRefreshTimer) return;

    clearInterval(this.yahrzeitRefreshTimer);
    this.yahrzeitRefreshTimer = null;
  },

  socketNotificationReceived: function (notification, payload) {
    if (payload && payload.id && payload.id !== this.identifier) return;

    if (notification === "MOED_EVENTS") {
      this.calendarData[payload.url] = payload.events;
      this.loaded = true;
      this.error = null;
    } else if (notification === "MOED_YAHRZEITS") {
      this.yahrzeitData = payload.items || [];
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
    wrapper.style.width = `${this.config.frameWidth}px`;

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

    this.renderSection(wrapper, "Today", sections.today, "today");
    this.renderSection(wrapper, "Tonight", sections.tonight, "tonight");
    this.renderSection(wrapper, "Tomorrow", sections.tomorrow, "tomorrow");
    this.renderSection(wrapper, "This week", sections.week, "week");
    this.renderSection(wrapper, "Later", sections.later, "later");

    return wrapper;
  },

  renderSection: function (wrapper, title, items, bucket) {
    if (items.length === 0) return;

    var header = document.createElement("div");
    header.className = "ja-section";
    header.textContent = title;
    wrapper.appendChild(header);

    for (var i = 0; i < items.length; i++) {
      wrapper.appendChild(this.renderItem(items[i], bucket));
    }
  },

  renderItem: function (item, bucket) {
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
    meta.textContent = this.getDisplayMeta(item, bucket);
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

  getDisplayMeta: function (item, bucket) {
    if (item.meta || bucket !== "later") return item.meta;
    return moment(item.startMs, "x").format("dddd");
  },

  createSections: function () {
    var items = this.createAgendaItems().slice(0, this.config.maximumEntries);
    var sections = {
      today: [],
      tonight: [],
      tomorrow: [],
      week: [],
      later: [],
      total: items.length
    };

    for (var i = 0; i < items.length; i++) {
      var bucket = this.getBucket(items[i]);
      sections[bucket].push(items[i]);
    }

    return sections;
  },

  createAgendaItems: function () {
    var items = [];
    var seen = {};
    var calendars = this.getCalendarsByUrl();
    var timingIndex = this.createTimingIndex();
    var now = moment();
    var maxDate = moment()
      .startOf("day")
      .add(this.config.maximumNumberOfDays, "days")
      .endOf("day");

    for (var url in this.calendarData) {
      var events = this.calendarData[url];
      var calendar = calendars[url] || {};
      for (var i = 0; i < events.length; i++) {
        this.addAgendaItem(
          items,
          seen,
          this.createAgendaItem(events[i], calendar, now, maxDate, timingIndex)
        );
      }
    }

    for (var y = 0; y < this.yahrzeitData.length; y++) {
      this.addAgendaItem(
        items,
        seen,
        this.createYahrzeitAgendaItem(this.yahrzeitData[y], now, maxDate)
      );
    }

    items.sort(function (a, b) {
      var dateDiff = a.startMs - b.startMs;
      if (dateDiff !== 0) return dateDiff;
      var priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return a.title.localeCompare(b.title);
    });

    return this.collapseConsecutiveItems(items);
  },

  addAgendaItem: function (items, seen, item) {
    if (!item) return;

    var dedupeKey =
      item.dedupeKey ||
      `${item.dayKey}:${item.kind}:${item.title.toLowerCase()}`;
    if (seen[dedupeKey]) return;

    seen[dedupeKey] = true;
    items.push(item);
  },

  createAgendaItem: function (event, calendar, now, maxDate, timingIndex) {
    var start = moment(event.startDate, "x");
    var end = moment(event.endDate, "x");

    if (!start.isValid() || start.isAfter(maxDate)) return null;
    if (event.fullDayEvent && end.isSameOrBefore(moment().startOf("day")))
      return null;
    if (!event.fullDayEvent && end.isBefore(now)) return null;

    var title = this.cleanTitle(event.title);
    if (this.isTimingTitle(title)) return null;
    if (this.isExcluded(title, calendar)) return null;

    var kind = this.getKind(title, calendar);
    var sourceLabel =
      calendar.label || calendar.name || this.defaultLabelForKind(kind);
    var startOfToday = moment().startOf("day");
    var isToday = start.isSame(startOfToday, "day");
    var badge = this.getBadge(title, calendar, kind);
    var timing = this.getTimingForItem(title, start, badge, timingIndex);

    return {
      title: title,
      kind: kind,
      badge: badge,
      badgeClass: this.getBadgeClass(badge),
      sourceLabel: sourceLabel,
      priority: this.priorityForKind(kind),
      startMs: Number(event.startDate),
      rangeEndMs: Number(event.startDate),
      rangeCount: 1,
      dayKey: start.format("YYYY-MM-DD"),
      fullDayEvent: event.fullDayEvent,
      timing: timing,
      isToday: isToday,
      when: this.formatWhen(start, event.fullDayEvent),
      meta:
        this.formatTimingMeta(timing) ||
        this.formatMeta(start, event.fullDayEvent, sourceLabel)
    };
  },

  createTimingIndex: function () {
    var timingIndex = {};

    for (var url in this.calendarData) {
      var events = this.calendarData[url];
      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var title = this.cleanTitle(event.title);
        if (!this.isTimingTitle(title)) continue;

        var start = moment(event.startDate, "x");
        if (!start.isValid()) continue;

        var dayKey = start.format("YYYY-MM-DD");
        if (!timingIndex[dayKey]) timingIndex[dayKey] = {};

        var lower = title.toLowerCase();
        if (lower === "candle lighting")
          timingIndex[dayKey].candleLighting = start;
        if (lower === "havdalah") timingIndex[dayKey].havdalah = start;
        if (lower === "fast begins") timingIndex[dayKey].fastBegins = start;
        if (lower === "fast ends") timingIndex[dayKey].fastEnds = start;
      }
    }

    return timingIndex;
  },

  createYahrzeitAgendaItem: function (yahrzeit, now, maxDate) {
    var start = moment(yahrzeit.startMs, "x");
    var end = moment(yahrzeit.endMs, "x");
    var observedDate = moment(yahrzeit.observedDateMs, "x");
    if (!start.isValid() || !end.isValid() || !observedDate.isValid())
      return null;
    if (end.isSameOrBefore(now) || start.isAfter(maxDate)) return null;

    var lifecycle = this.getYahrzeitLifecycle(start, end, observedDate, now);
    return {
      title: yahrzeit.name,
      kind: "yahrzeit",
      badge: "Yahrzeit",
      badgeClass: "yahrzeit",
      sourceLabel: "Yahrzeit",
      priority: this.priorityForKind("yahrzeit"),
      startMs: start.valueOf(),
      rangeEndMs: start.valueOf(),
      rangeCount: 1,
      dayKey: observedDate.format("YYYY-MM-DD"),
      fullDayEvent: false,
      timing: {},
      isToday: lifecycle.isActive,
      when: lifecycle.when,
      meta: lifecycle.meta,
      bucket: lifecycle.bucket,
      dedupeKey: `yahrzeit:${yahrzeit.id}:${observedDate.format("YYYY-MM-DD")}`
    };
  },

  getYahrzeitLifecycle: function (start, end, observedDate, now) {
    var today = now.clone().startOf("day");
    var startsToday = start.isSame(today, "day");
    var observedToday = observedDate.isSame(today, "day");
    var isActive = now.isSameOrAfter(start) && now.isBefore(end);

    if (observedToday) {
      return {
        bucket: "today",
        when: "Today",
        meta: `began last night · ends ${end.format("h:mm A")}`,
        isActive: true
      };
    }

    if (startsToday) {
      var startTime = start.format("h:mm A");
      return {
        bucket: "tonight",
        when: "Tonight",
        meta: isActive
          ? `started ${startTime} · through tomorrow`
          : `starts ${startTime}`,
        isActive: isActive
      };
    }

    if (observedDate.isSame(today.clone().add(1, "day"), "day")) {
      return {
        bucket: "tomorrow",
        when: "Tomorrow",
        meta: `starts tonight ${start.format("h:mm A")}`,
        isActive: false
      };
    }

    if (observedDate.isBefore(today.clone().add(7, "days"), "day")) {
      return {
        bucket: "week",
        when: observedDate.format("ddd"),
        meta: `starts ${start.format("ddd h:mm A")}`,
        isActive: false
      };
    }

    return {
      bucket: "later",
      when: observedDate.format("MMM D"),
      meta: `starts ${start.format("ddd h:mm A")}`,
      isActive: false
    };
  },

  collapseConsecutiveItems: function (items) {
    var collapsed = [];
    var openBySeriesKey = {};

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var series = this.getCollapsibleSeries(item);
      if (!series) {
        collapsed.push(item);
        continue;
      }

      var seriesKey = `${item.kind}:${item.badge}:${item.sourceLabel}:${series.key}`;
      var openItem = openBySeriesKey[seriesKey];
      if (openItem && this.isNextDay(openItem.rangeEndMs, item.startMs)) {
        this.mergeConsecutiveItem(openItem, item, series.title);
      } else {
        item.seriesKey = seriesKey;
        item.seriesTitle = series.title;
        openBySeriesKey[seriesKey] = item;
        collapsed.push(item);
      }
    }

    return collapsed;
  },

  mergeConsecutiveItem: function (target, item, title) {
    target.title = title;
    target.rangeEndMs = item.startMs;
    target.rangeCount++;
    target.timing.end = item.timing.end || target.timing.end;
    target.timing.fastEnds = item.timing.fastEnds || target.timing.fastEnds;
    target.when = this.formatRangeWhen(
      moment(target.startMs, "x"),
      moment(target.rangeEndMs, "x")
    );
    target.meta =
      this.formatTimingMeta(target.timing) ||
      this.formatRangeMeta(target.rangeCount);
  },

  isNextDay: function (previousMs, nextMs) {
    var previous = moment(previousMs, "x").startOf("day");
    var next = moment(nextMs, "x").startOf("day");
    return next.diff(previous, "days") === 1;
  },

  getCollapsibleSeries: function (item) {
    if (!item.fullDayEvent) return null;

    var lower = item.title.toLowerCase();
    var roshChodesh = lower.match(/^rosh chodesh (.+)$/);
    if (roshChodesh)
      return { key: `rosh-chodesh:${roshChodesh[1]}`, title: item.title };
    if (/^pesach (i|ii|iii|iv|v|vi|vii|viii)\b/.test(lower))
      return { key: "chag:pesach", title: "Pesach" };
    if (/^shavuos (i|ii)\b/.test(lower) || /^shavuot (i|ii)\b/.test(lower))
      return { key: "chag:shavuos", title: "Shavuos" };
    if (
      /^sukkos (i|ii|iii|iv|v|vi|vii)\b/.test(lower) ||
      /^sukkot (i|ii|iii|iv|v|vi|vii)\b/.test(lower)
    )
      return { key: "chag:sukkos", title: "Sukkos" };
    if (/^rosh hashana( \d| ii|$)/.test(lower))
      return { key: "chag:rosh-hashana", title: "Rosh Hashana" };
    if (lower.startsWith("chanukah:"))
      return { key: "holiday:chanukah", title: "Chanukah" };
    return null;
  },

  getBucket: function (item) {
    if (item.bucket) return item.bucket;

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
    if (start.isBefore(today.clone().add(7, "days"), "day"))
      return start.format("ddd");
    return start.format("MMM D");
  },

  formatRangeWhen: function (start, end) {
    if (start.isSame(end, "day")) return this.formatWhen(start, true);
    if (start.isSame(end, "month"))
      return `${start.format("MMM D")}–${end.format("D")}`;
    return `${start.format("MMM D")}–${end.format("MMM D")}`;
  },

  formatMeta: function () {
    return "";
  },

  formatTimingMeta: function (timing) {
    if (!timing) return "";

    if (timing.fastBegins && timing.fastEnds) {
      return `fast ${timing.fastBegins.format(
        "h:mm A"
      )}–${timing.fastEnds.format("h:mm A")}`;
    }
    if (timing.fastBegins)
      return `fast begins ${timing.fastBegins.format("h:mm A")}`;
    if (timing.fastEnds) return `fast ends ${timing.fastEnds.format("h:mm A")}`;

    if (timing.start && timing.end) {
      return `${this.formatTimingTime(timing.start)} – ${this.formatTimingTime(
        timing.end
      )}`;
    }
    if (timing.start) return `starts ${this.formatTimingTime(timing.start)}`;
    if (timing.end) return `ends ${this.formatTimingTime(timing.end)}`;
    return "";
  },

  formatTimingTime: function (time) {
    return time.format("ddd h:mm A");
  },

  formatRangeMeta: function (count) {
    return `${count} days`;
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
      maximumEntries:
        calendar.maximumEntries ||
        Math.max(this.config.maximumEntries * 8, 100),
      maximumNumberOfDays:
        calendar.maximumNumberOfDays || this.config.maximumNumberOfDays,
      excludedEvents: calendar.excludedEvents || this.config.excludedEvents,
      auth: calendar.auth,
      selfSignedCert: calendar.selfSignedCert
    });
  },

  hasYahrzeits: function () {
    return this.config.yahrzeits && this.config.yahrzeits.length > 0;
  },

  addYahrzeits: function () {
    if (!this.hasYahrzeits()) return;

    this.sendSocketNotification("ADD_MOED_YAHRZEITS", {
      id: this.identifier,
      yahrzeits: this.config.yahrzeits,
      maximumNumberOfDays: this.config.maximumNumberOfDays,
      timeZoneId: this.config.timeZoneId,
      locationName: this.config.locationName,
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      elevation: this.config.elevation,
      yahrzeitReferenceYear: this.config.yahrzeitReferenceYear
    });
  },

  cleanTitle: function (title) {
    return String(title || "Event")
      .replace(/\\,/g, ",")
      .replace(/\s+/g, " ")
      .trim();
  },

  isTimingTitle: function (title) {
    var lower = title.toLowerCase();
    return (
      lower === "candle lighting" ||
      lower === "havdalah" ||
      lower === "fast begins" ||
      lower === "fast ends"
    );
  },

  getTimingForItem: function (title, start, badge, timingIndex) {
    var dayKey = start.format("YYYY-MM-DD");
    var sameDay = timingIndex[dayKey] || {};
    var previousDay =
      timingIndex[start.clone().subtract(1, "day").format("YYYY-MM-DD")] || {};
    var timing = {};

    if (badge === "Erev") {
      timing.start = sameDay.candleLighting;
      return timing;
    }

    if (badge === "Chag") {
      timing.start = previousDay.candleLighting || sameDay.candleLighting;
      timing.end = sameDay.havdalah;
      return timing;
    }

    if (badge === "Fast") {
      timing.fastBegins = sameDay.fastBegins;
      timing.fastEnds = sameDay.fastEnds;
    }

    return timing;
  },

  isExcluded: function (title, calendar) {
    var calendarFilters = calendar.excludedEvents || [];
    return (
      this.matchesEventFilter(title, this.config.excludedEvents) ||
      this.matchesEventFilter(title, calendarFilters)
    );
  },

  matchesEventFilter: function (title, filters) {
    if (!Array.isArray(filters)) return false;

    for (var i = 0; i < filters.length; i++) {
      var entry = filters[i];
      var filter =
        typeof entry === "string" ? { filterBy: entry, regex: false } : entry;
      if (!filter || !filter.filterBy) continue;

      if (filter.regex) {
        var regexFlags = filter.caseSensitive ? "" : "i";
        if (new RegExp(filter.filterBy, regexFlags).test(title)) return true;
      } else if (filter.caseSensitive) {
        if (title.includes(filter.filterBy)) return true;
      } else if (
        title.toLowerCase().includes(String(filter.filterBy).toLowerCase())
      ) {
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
    if (kind === "yahrzeit") return 2;
    if (kind === "personal") return 2;
    return 3;
  },

  getBadge: function (title, calendar, kind) {
    var lower = title.toLowerCase();
    if (kind === "yahrzeit") return "Yahrzeit";
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
    if (kind === "yahrzeit") return "Yahrzeit";
    if (kind === "personal") return "You";
    return "Holiday";
  },

  defaultLabelForKind: function (kind) {
    if (kind === "jewish") return "Hebcal";
    if (kind === "yahrzeit") return "Yahrzeit";
    if (kind === "personal") return "Personal";
    return "Holiday";
  }
});
