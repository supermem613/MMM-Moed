# MMM-Moed

MMM-Moed is a compact MagicMirror module for a curated "Today & Soon" agenda. It consumes iCal feeds, groups upcoming items into mirror-friendly sections, and adds semantic badges for Jewish and secular calendar items.

## Configuration

```js
{
    module: "MMM-Moed",
    header: "Coming Up",
    position: "top_left",
    config: {
        fetchInterval: 4 * 60 * 60 * 1000,
        renderRefreshInterval: 5 * 60 * 1000,
        maximumEntries: 8,
        maximumNumberOfDays: 45,
        calendars: [
            {
                label: "US",
                type: "holiday",
                url: "webcal://www.calendarlabs.com/ical-calendar/ics/76/US_Holidays.ics"
            },
            {
                label: "Hebcal",
                type: "jewish",
                url: "webcal://download.hebcal.com/v2/h/..."
            }
        ]
    }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `maximumEntries` | `8` | Maximum number of agenda items to render across sections. |
| `maximumNumberOfDays` | `45` | How far ahead to fetch and consider events. |
| `fetchInterval` | `14400000` | How often to refresh calendar feed data. |
| `renderRefreshInterval` | `300000` | How often to re-render without fetching data, keeping Today/Tomorrow labels fresh. Set to `0` to disable. |
| `sectionLimits` | `{ today: 5, tomorrow: 4, week: 5, later: 3 }` | Per-section display caps before items collapse into the "+N more" footer. |
| `calendars` | `[]` | iCal feeds. Each calendar can include `label`, `type`, `url`, and optional per-feed fetch options. |
| `excludedEvents` | `[]` | Case-insensitive title substrings to hide. |

Badges are inferred from event titles: `Chag` for major holidays, `Rosh` for Rosh Chodesh, `Erev` for erev days, `Fast` for fast days, `Israeli` for Israeli observances, and `Holiday` for US civil holidays. Minor Jewish holidays such as Purim and Tu B'Av render without a badge.
