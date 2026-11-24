"use strict";

// Tripzy Issue 382: offline tests for the place library publisher (D145's limits).
// The places are made up for the tests; they are not library data.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { COLUMNS } = require("../build.js");
const { main, MAX_REMOVALS } = require("../publish.js");

const TODAY = "2026-11-24";
const HOURS = "mon=10:00-21:00;tue=10:00-21:00;wed=10:00-21:00;thu=10:00-21:00;fri=10:00-21:00;sat=10:00-21:00;sun=10:00-21:00";
const place = (n, extra = {}) => ({
    id: `sg-test-place-${n}`, name_en: `Test Place ${n}`, name_zh: `测试地点${n}`, area: "Woodlands",
    lat: "1.436", lng: "103.786", category: "library", indoor: "TRUE", air_conditioned: "TRUE",
    min_age_months: "0", max_age_months: "144", typical_duration_min: "60", stroller_friendly: "yes",
    nursing_room: "TRUE", diaper_changing: "TRUE", opening_hours: HOURS, rainy_day_backup_ids: "",
    source: "https://example.org/place", last_verified_at: "2026-11-21", ...extra,
});
const quote = (v) => (/[",\n\r]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, "\"\"")}"` : String(v ?? ""));
const csv = (rows) => [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => quote(r[c])).join(","))].join("\n");

function workspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tripzy-places-"));
    const files = { csv: path.join(dir, "places.csv"), published: path.join(dir, "places_sg.json"), summary: path.join(dir, "summary.md") };
    const run = (rows) => {
        fs.writeFileSync(files.csv, csv(rows));
        const errors = console.error;
        const logs = console.log;
        console.error = () => {};
        console.log = () => {};
        try {
            return main([files.csv, files.published, files.summary], { now: TODAY });
        } finally {
            console.error = errors;
            console.log = logs;
        }
    };
    const published = () => JSON.parse(fs.readFileSync(files.published, "utf8"));
    return { dir, files, run, published };
}

const five = [1, 2, 3, 4, 5].map((n) => place(n));

test("the first publish writes version 1 with no retired ids", () => {
    const w = workspace();
    assert.equal(w.run(five), 0);
    const file = w.published();
    assert.equal(file.schema_version, 1);
    assert.equal(file.library_version, 1);
    assert.equal(file.count, 5);
    assert.deepEqual(file.retired_ids, []);
    assert.match(fs.readFileSync(w.files.summary, "utf8"), /version 0 → 1[\s\S]*5 added/);
});

test("the same Sheet again is no change, and nothing is written", () => {
    const w = workspace();
    w.run(five);
    const before = fs.readFileSync(w.files.published, "utf8");
    fs.rmSync(w.files.summary);
    assert.equal(w.run(five), 3);
    assert.equal(fs.readFileSync(w.files.published, "utf8"), before);
    assert.equal(fs.existsSync(w.files.summary), false);
});

test("a changed fact raises the version and lists the field with before and after", () => {
    const w = workspace();
    w.run(five);
    const rows = five.map((r) => (r.id === "sg-test-place-2" ? { ...r, opening_hours: HOURS.replace("sun=10:00-21:00", "sun=closed") } : r));
    assert.equal(w.run(rows), 0);
    assert.equal(w.published().library_version, 2);
    const text = fs.readFileSync(w.files.summary, "utf8");
    assert.match(text, /0 added, 0 removed, 1 changed/);
    assert.match(text, /`sg-test-place-2` \| opening_hours \| sun 10:00-21:00 \| sun closed \|/,
        "only the changed day, in plain form");
});

test(`up to ${MAX_REMOVALS} removals are allowed and their ids are retired`, () => {
    const w = workspace();
    w.run(five);
    assert.equal(w.run(five.slice(0, 2)), 0);
    const file = w.published();
    assert.equal(file.count, 2);
    assert.deepEqual(file.retired_ids, ["sg-test-place-3", "sg-test-place-4", "sg-test-place-5"]);
});

test(`more than ${MAX_REMOVALS} removals at once are refused, and nothing is written`, () => {
    const w = workspace();
    w.run(five);
    const before = fs.readFileSync(w.files.published, "utf8");
    assert.equal(w.run(five.slice(0, 1)), 2);
    assert.equal(fs.readFileSync(w.files.published, "utf8"), before);
});

test("a retired id can never come back", () => {
    const w = workspace();
    w.run(five);
    w.run(five.slice(0, 4));
    assert.equal(w.run(five), 2, "sg-test-place-5 was retired");
});

test("a row that fails the checks (a link in the notes) stops everything", () => {
    const w = workspace();
    w.run(five);
    const before = fs.readFileSync(w.files.published, "utf8");
    const rows = [...five, place(6, { notes: "Hours at https://example.org/hours" })];
    assert.equal(w.run(rows), 1);
    assert.equal(fs.readFileSync(w.files.published, "utf8"), before);
});

test("an unreadable current file stops the run", () => {
    const w = workspace();
    fs.writeFileSync(w.files.published, JSON.stringify({ schema_version: 2, places: [] }));
    assert.equal(w.run(five), 4);
});

test("Markdown in a place's name can't change the pull request's layout", () => {
    const w = workspace();
    w.run(five);
    assert.equal(w.run([...five, place(6, { name_en: "Fun | Play <b>zone</b>" })]), 0);
    const text = fs.readFileSync(w.files.summary, "utf8");
    assert.match(text, /Fun \\\| Play \\<b\\>zone\\<\/b\\>/);
    assert.doesNotMatch(text, /<b>/);
});
