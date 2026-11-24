#!/usr/bin/env node
"use strict";

// Issue 352: checks the place library CSV (exported from the owner's Google Sheet) and
// builds the JSON the app and the plan engine will read. Plain Node 22, no dependencies.
// Usage: node places/build.js [input.csv] [output.json]
// Rules: places/README.md. Nothing is written unless every row passes.

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 1;

const REQUIRED = [
    "id", "name_en", "name_zh", "area", "lat", "lng", "category", "indoor",
    "air_conditioned", "min_age_months", "max_age_months", "typical_duration_min",
    "stroller_friendly", "nursing_room", "diaper_changing", "opening_hours",
    "rainy_day_backup_ids", "source", "last_verified_at",
];
const OPTIONAL = [
    "country", "high_chairs", "shade", "cost_level", "booking_required", "nearest_mrt",
    "walk_min_from_mrt", "parking", "notes",
];
const COLUMNS = [...REQUIRED, ...OPTIONAL];

const CATEGORIES = [
    "playground", "park", "indoor_playground", "museum", "attraction", "mall", "farm",
    "water_play", "library", "other",
];
const STROLLER = ["yes", "partial", "no"];
const COST_LEVELS = ["free", "low", "medium", "high"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const BOUNDS = { latMin: 1.15, latMax: 1.48, lngMin: 103.6, lngMax: 104.1 };
// Issue 382 (D145): a web address in a text field (names, area, station, notes).
const LINK = /\bhttps?:\/\/|\bwww\./i;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    for (; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c === "\"") {
                if (text[i + 1] === "\"") {
                    field += "\"";
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += c;
            }
        } else if (c === "\"" && field === "") {
            quoted = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i += 1;
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += c;
        }
    }
    if (quoted) throw new Error("the file ends inside a quoted field");
    if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function todayInSingapore(now = new Date()) {
    return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function isRealDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function minutes(hhmm) {
    const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(hhmm);
    if (!m) return null;
    const total = Number(m[1]) * 60 + Number(m[2]);
    return total > 24 * 60 ? null : total;
}

/** "mon=09:00-18:00;tue=closed;..." → { mon: [["09:00","18:00"]], tue: [], ... } or an error. */
function parseOpeningHours(value) {
    const result = {};
    const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
        const eq = part.indexOf("=");
        const day = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
        const spec = eq < 0 ? "" : part.slice(eq + 1).trim().toLowerCase();
        if (!DAYS.includes(day)) return { error: `"${day}" is not a day (use ${DAYS.join(", ")})` };
        if (result[day]) return { error: `${day} appears twice` };
        if (spec === "closed") {
            result[day] = [];
            continue;
        }
        const ranges = [];
        for (const range of spec.split(",").map((r) => r.trim())) {
            const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(range);
            const start = m && minutes(m[1]);
            const end = m && minutes(m[2]);
            if (!m || start === null || end === null || start === 24 * 60) {
                return { error: `${day}: "${range}" is not HH:MM-HH:MM or closed` };
            }
            if (start >= end) return { error: `${day}: ${range} ends before it starts` };
            if (ranges.length && start < minutes(ranges[ranges.length - 1][1])) {
                return { error: `${day}: ranges overlap or are out of order` };
            }
            ranges.push([m[1], m[2]]);
        }
        result[day] = ranges;
    }
    const missing = DAYS.filter((d) => !result[d]);
    if (missing.length) return { error: `missing ${missing.join(", ")}` };
    return { value: Object.fromEntries(DAYS.map((d) => [d, result[d]])) };
}

function buildPlaces(text, { today = todayInSingapore() } = {}) {
    const errors = [];
    let table;
    try {
        table = parseCsv(text);
    } catch (e) {
        return { places: [], errors: [`file: ${e.message}`] };
    }
    if (!table.length) return { places: [], errors: ["file: no header row"] };

    const header = table[0].map((h) => h.trim());
    const seen = new Set();
    for (const h of header) {
        if (!COLUMNS.includes(h)) errors.push(`header: unknown column "${h}"`);
        if (seen.has(h)) errors.push(`header: column "${h}" appears twice`);
        seen.add(h);
    }
    for (const r of REQUIRED) if (!seen.has(r)) errors.push(`header: missing column "${r}"`);
    if (errors.length) return { places: [], errors };

    const drafts = [];
    table.slice(1).forEach((cells, index) => {
        const rowNumber = index + 2; // the Sheet's row number; row 1 is the header
        if (cells.every((c) => c.trim() === "")) return;
        if (cells.length !== header.length) {
            errors.push(`row ${rowNumber}: has ${cells.length} cells, the header has ${header.length}`);
            return;
        }
        const raw = Object.fromEntries(header.map((h, i) => [h, cells[i].trim()]));
        const label = raw.id ? `row ${rowNumber} (${raw.id})` : `row ${rowNumber}`;
        const fail = (column, message) => errors.push(`${label}, column ${column}: ${message}`);
        const textField = (column, max, required) => {
            const v = raw[column] ?? "";
            if (!v) {
                if (required) fail(column, "is empty");
                return null;
            }
            if (v.length > max) fail(column, `is longer than ${max} characters`);
            // Issue 382 (D145): links belong only in `source`.
            if (LINK.test(v)) fail(column, "must not contain a link (put it in source)");
            return v;
        };
        const bool = (column, required) => {
            const v = (raw[column] ?? "").toUpperCase();
            if (v === "TRUE") return true;
            if (v === "FALSE") return false;
            if (!v && !required) return null;
            fail(column, "must be TRUE or FALSE");
            return null;
        };
        const int = (column, min, max, required) => {
            const v = raw[column] ?? "";
            if (!v && !required) return null;
            if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
                fail(column, `must be a whole number from ${min} to ${max}`);
                return null;
            }
            return Number(v);
        };
        const oneOf = (column, allowed, required) => {
            const v = (raw[column] ?? "").toLowerCase();
            if (!v && !required) return null;
            if (!allowed.includes(v)) {
                fail(column, `must be one of ${allowed.join(", ")}`);
                return null;
            }
            return v;
        };
        const coordinate = (column, min, max) => {
            const v = raw[column];
            if (!/^-?\d+(\.\d+)?$/.test(v) || Number(v) < min || Number(v) > max) {
                fail(column, `must be a number from ${min} to ${max} (Singapore)`);
                return null;
            }
            return Number(v);
        };

        if (!/^sg-[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id) || raw.id.length > 64) {
            fail("id", "must be sg- followed by lowercase letters, digits and single hyphens (at most 64 characters)");
        }

        let country = "SG";
        if (raw.country !== undefined && raw.country !== "") {
            if (raw.country.toUpperCase() === "MY") fail("country", "MY is not accepted until the Johor Bahru work starts");
            else if (raw.country.toUpperCase() !== "SG") fail("country", "must be SG or empty");
        }

        const minAge = int("min_age_months", 0, 216, true);
        const maxAge = int("max_age_months", 0, 216, true);
        if (minAge !== null && maxAge !== null && minAge > maxAge) {
            fail("max_age_months", "is below min_age_months");
        }

        const hours = parseOpeningHours(raw.opening_hours);
        if (hours.error) fail("opening_hours", hours.error);

        const sources = raw.source.split("|").map((s) => s.trim()).filter(Boolean);
        if (!sources.length) fail("source", "is empty");
        for (const s of sources) {
            if (s !== "onsite" && !/^https?:\/\/\S+$/.test(s)) {
                fail("source", `"${s}" is neither onsite nor a URL`);
            }
        }
        if (new Set(sources).size !== sources.length) fail("source", "lists the same entry twice");

        if (!isRealDate(raw.last_verified_at)) fail("last_verified_at", "must be a real date YYYY-MM-DD");
        else if (raw.last_verified_at > today) fail("last_verified_at", `is after today (${today})`);

        const place = {
            id: raw.id,
            name_en: textField("name_en", 120, true),
            name_zh: textField("name_zh", 120, true),
            country,
            area: textField("area", 120, true),
            lat: coordinate("lat", BOUNDS.latMin, BOUNDS.latMax),
            lng: coordinate("lng", BOUNDS.lngMin, BOUNDS.lngMax),
            category: oneOf("category", CATEGORIES, true),
            indoor: bool("indoor", true),
            air_conditioned: bool("air_conditioned", true),
            min_age_months: minAge,
            max_age_months: maxAge,
            typical_duration_min: int("typical_duration_min", 15, 480, true),
            stroller_friendly: oneOf("stroller_friendly", STROLLER, true),
            nursing_room: bool("nursing_room", true),
            diaper_changing: bool("diaper_changing", true),
            high_chairs: bool("high_chairs", false),
            shade: bool("shade", false),
            cost_level: oneOf("cost_level", COST_LEVELS, false),
            opening_hours: hours.value ?? null,
            booking_required: bool("booking_required", false),
            nearest_mrt: textField("nearest_mrt", 120, false),
            walk_min_from_mrt: int("walk_min_from_mrt", 0, 60, false),
            parking: bool("parking", false),
            rainy_day_backup_ids: raw.rainy_day_backup_ids.split("|").map((s) => s.trim()).filter(Boolean),
            notes: textField("notes", 500, false),
            source: sources,
            last_verified_at: raw.last_verified_at,
        };
        drafts.push({ place, label });
    });

    const byId = new Map();
    for (const { place, label } of drafts) {
        if (byId.has(place.id)) errors.push(`${label}, column id: "${place.id}" is used by an earlier row`);
        else byId.set(place.id, place);
    }
    for (const { place, label } of drafts) {
        const backups = place.rainy_day_backup_ids;
        if (place.indoor === false && !backups.length) {
            errors.push(`${label}, column rainy_day_backup_ids: an outdoor place needs at least one indoor backup`);
        }
        for (const id of backups) {
            const backup = byId.get(id);
            if (id === place.id) errors.push(`${label}, column rainy_day_backup_ids: a place cannot be its own backup`);
            else if (!backup) errors.push(`${label}, column rainy_day_backup_ids: "${id}" is not in the file`);
            else if (backup.indoor !== true) errors.push(`${label}, column rainy_day_backup_ids: "${id}" is not indoor`);
        }
    }

    if (errors.length) return { places: [], errors };
    const places = drafts.map((d) => d.place).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { places, errors: [] };
}

function toJson(places) {
    return `${JSON.stringify({ schema_version: SCHEMA_VERSION, country: "SG", count: places.length, places }, null, 2)}\n`;
}

// Copies the consumers read (written only for the default run, never for explicit paths).
const COPIES = [
    // Issue 354: the half-day plan engine.
    path.join(__dirname, "..", "backend", "functions", "familyPlan", "places_sg.json"),
    // Issue 355: the app (owner decision D3: the library ships inside the app).
    path.join(__dirname, "..", "ios_app", "Tripzy3", "FamilyPlaces", "places_sg.json"),
];

function main(argv) {
    const input = argv[0] ?? path.join(__dirname, "sg_places.csv");
    const output = argv[1] ?? path.join(__dirname, "places_sg.json");
    const copies = argv.length ? [] : COPIES;
    const { places, errors } = buildPlaces(fs.readFileSync(input, "utf8"));
    if (errors.length) {
        for (const e of errors) console.error(e);
        console.error(`\n${errors.length} problem(s) found; ${path.basename(output)} was not written.`);
        return 1;
    }
    const json = toJson(places);
    for (const file of [output, ...copies]) {
        fs.writeFileSync(file, json);
        console.log(`${places.length} place(s) OK → ${path.relative(process.cwd(), file)}`);
    }
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { COPIES, COLUMNS, REQUIRED, OPTIONAL, parseCsv, parseOpeningHours, buildPlaces, toJson, todayInSingapore };
