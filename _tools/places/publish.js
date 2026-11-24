#!/usr/bin/env node
"use strict";

// Tripzy Issue 382 (ADR-0048): turns the place Sheet's CSV into the published library file,
// within the owner's limits (D145). It never publishes by itself: the workflow opens a pull
// request, and the owner merges it.
//
// Usage: node _tools/places/publish.js <places.csv> <tripzy/places/places_sg.json> <summary.md>
// Exit codes: 0 changed (file and summary written); 3 no change; 1 a row failed the checks;
// 2 refused by a limit; 4 the current published file is unreadable.

const fs = require("node:fs");
const { buildPlaces } = require("./build.js");

const SCHEMA_VERSION = 1;
const MAX_REMOVALS = 3;

/** The published file now, or null before the first publish. Throws if it isn't one of ours. */
function readCurrent(file) {
    if (!fs.existsSync(file)) return null;
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const ok = json && json.schema_version === SCHEMA_VERSION && Number.isInteger(json.library_version) &&
        json.library_version >= 1 && Array.isArray(json.places) && Array.isArray(json.retired_ids);
    if (!ok) throw new Error("the current published file is not a schema 1 library file");
    return json;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** What changes from the current file to `places`, and anything the limits refuse. */
function compare(current, places) {
    const before = new Map((current ? current.places : []).map((p) => [p.id, p]));
    const after = new Map(places.map((p) => [p.id, p]));
    const retired = new Set(current ? current.retired_ids : []);
    const added = [...after.keys()].filter((id) => !before.has(id));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    const changed = [...after.keys()]
        .filter((id) => before.has(id) && !same(before.get(id), after.get(id)))
        .map((id) => {
            const a = before.get(id);
            const b = after.get(id);
            const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));
            return { id, fields: fields.map((k) => ({ field: k, before: a[k], after: b[k] })) };
        });
    const problems = [];
    if (current && removed.length > MAX_REMOVALS) {
        problems.push(`removes ${removed.length} places (${removed.join(", ")}); at most ${MAX_REMOVALS} at a time`);
    }
    for (const id of added) {
        if (retired.has(id)) problems.push(`"${id}" was removed before; an id is never reused`);
    }
    return { added, removed, changed, problems, before, after };
}

function publishedJson(current, places, removed) {
    const retired = [...new Set([...(current ? current.retired_ids : []), ...removed])].sort();
    const file = {
        schema_version: SCHEMA_VERSION,
        library_version: (current ? current.library_version : 0) + 1,
        country: "SG",
        count: places.length,
        places,
        retired_ids: retired,
    };
    return `${JSON.stringify(file, null, 2)}\n`;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayText = (ranges) => (ranges && ranges.length ? ranges.map((r) => r.join("-")).join(", ") : "closed");
/** Opening hours: only the days that changed, as "sun 10:00-21:00". */
function hoursChange(before, after) {
    const days = DAYS.filter((d) => !same((before || {})[d], (after || {})[d]));
    return {
        before: days.map((d) => `${d} ${dayText((before || {})[d])}`).join("; "),
        after: days.map((d) => `${d} ${dayText((after || {})[d])}`).join("; "),
    };
}

const show = (value) => {
    const text = value === null || value === undefined ? "(empty)" : typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
};
// Keeps table cells to one line and stops Markdown in a value from becoming markup.
const cell = (text) => text.replace(/[\r\n]+/g, " ").replace(/([\\`*_|<>[\]])/g, "\\$1");

function summary(current, result) {
    const from = current ? current.library_version : 0;
    const name = (id) => cell((result.after.get(id) || result.before.get(id)).name_en);
    const lines = [
        `## Tripzy place library: version ${from} → ${from + 1}`,
        "",
        `${result.after.size} places: ${result.added.length} added, ${result.removed.length} removed, ` +
            `${result.changed.length} changed. Every row passed the checks, and the limits held ` +
            `(at most ${MAX_REMOVALS} removals; no reused id).`,
        "",
        "Merging this publishes it: the app and the plan engine pick it up within hours.",
    ];
    if (result.added.length) {
        lines.push("", "### Added", "", ...result.added.map((id) => `- \`${id}\`: ${name(id)}`));
    }
    if (result.removed.length) {
        lines.push("", "### Removed", "", ...result.removed.map((id) => `- \`${id}\`: ${name(id)}`));
    }
    if (result.changed.length) {
        lines.push("", "### Changed", "", "| Place | Field | Before | After |", "| --- | --- | --- | --- |");
        for (const { id, fields } of result.changed) {
            for (const f of fields) {
                const pair = f.field === "opening_hours" ? hoursChange(f.before, f.after) : f;
                lines.push(`| \`${id}\` | ${f.field} | ${cell(show(pair.before))} | ${cell(show(pair.after))} |`);
            }
        }
    }
    return `${lines.join("\n")}\n`;
}

function main(argv, { now } = {}) {
    if (argv.length !== 3) {
        console.error("Usage: node _tools/places/publish.js <places.csv> <published.json> <summary.md>");
        return 1;
    }
    const [csvFile, publishedFile, summaryFile] = argv;
    const options = now ? { today: now } : {};
    const { places, errors } = buildPlaces(fs.readFileSync(csvFile, "utf8"), options);
    if (errors.length) {
        for (const e of errors) console.error(e);
        console.error(`\n${errors.length} problem(s) found; nothing was written.`);
        return 1;
    }
    let current;
    try {
        current = readCurrent(publishedFile);
    } catch (e) {
        console.error(`STOP: ${e.message}`);
        return 4;
    }
    const result = compare(current, places);
    if (result.problems.length) {
        for (const p of result.problems) console.error(`REFUSED: ${p}`);
        return 2;
    }
    if (current && !result.added.length && !result.removed.length && !result.changed.length) {
        console.log(`No change: ${places.length} places, library version ${current.library_version}.`);
        return 3;
    }
    fs.writeFileSync(publishedFile, publishedJson(current, places, result.removed));
    fs.writeFileSync(summaryFile, summary(current, result));
    console.log(`Library version ${(current ? current.library_version : 0) + 1}: ${places.length} places, ` +
        `${result.added.length} added, ${result.removed.length} removed, ${result.changed.length} changed.`);
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { MAX_REMOVALS, compare, main, publishedJson, readCurrent, summary };
