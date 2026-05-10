const assert = require("assert");

global.Module = {
  register: function (name, moduleDefinition) {
    global.moedModule = moduleDefinition;
  }
};

global.moment = require("../../../vendor/node_modules/moment/moment.js");

require("../MMM-Moed.js");

/**
 * Creates an MMM-Moed module instance with merged defaults.
 *
 * @param {object} config Module config overrides.
 * @returns {object} Module instance.
 */
function createModule(config) {
  return Object.assign(
    {
      config: Object.assign({}, global.moedModule.defaults, config || {})
    },
    global.moedModule
  );
}

/**
 * Creates a future all-day calendar event.
 *
 * @param {string} title Event title.
 * @returns {object} Calendar event.
 */
function createFullDayEvent(title) {
  return {
    title: title,
    startDate: global.moment().add(1, "day").startOf("day").valueOf(),
    endDate: global.moment().add(2, "day").startOf("day").valueOf(),
    fullDayEvent: true
  };
}

/**
 * Creates one agenda item from a title.
 *
 * @param {object} moduleInstance Module instance under test.
 * @param {string} title Event title.
 * @param {object} calendar Calendar config.
 * @returns {object|null} Agenda item, or null when filtered.
 */
function createAgendaItem(moduleInstance, title, calendar) {
  return moduleInstance.createAgendaItem(
    createFullDayEvent(title),
    calendar || {},
    global.moment(),
    global.moment().add(45, "days"),
    {}
  );
}

const moduleInstance = createModule({
  excludedEvents: [
    "Juneteenth",
    { filterBy: "^Christmas", regex: true },
    { filterBy: "Easter Sunday", caseSensitive: true }
  ]
});

assert.strictEqual(
  moduleInstance.matchesEventFilter("Juneteenth National Independence Day", [
    "juneteenth"
  ]),
  true
);
assert.strictEqual(
  moduleInstance.matchesEventFilter("Christmas Day", [
    { filterBy: "^christmas", regex: true }
  ]),
  true
);
assert.strictEqual(
  moduleInstance.matchesEventFilter("easter sunday", [
    { filterBy: "Easter Sunday", caseSensitive: true }
  ]),
  false
);
assert.strictEqual(
  moduleInstance.matchesEventFilter("Easter Sunday", [
    { filterBy: "Easter Sunday", caseSensitive: true }
  ]),
  true
);

assert.strictEqual(
  createAgendaItem(moduleInstance, "Juneteenth National Independence Day"),
  null
);
assert.strictEqual(createAgendaItem(moduleInstance, "Christmas Day"), null);
assert.strictEqual(createAgendaItem(moduleInstance, "Easter Sunday"), null);
assert.notStrictEqual(createAgendaItem(moduleInstance, "Memorial Day"), null);

assert.strictEqual(
  createAgendaItem(createModule(), "Memorial Day", {
    excludedEvents: [{ filterBy: "^Memorial", regex: true }]
  }),
  null
);

console.log("MMM-Moed filter tests passed");
