"use strict";
// Verifies reconciliation lookup collisions:
// Current code: executedResults.find(e => e.name === expected.testName && e.category === expected.category)
// Risk: If two tests in different suites within the SAME category have the same name,
//       Array.find() returns the FIRST match, silently dropping the second.
// This script checks if any (testName, category) pair is non-unique across the discovered tests.

const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "../tests");
const catMap = {
  "authentication": "Authentication",
  "trips": "Trips",
  "groups": "Groups",
  "groupChat": "Group Chat",
  "aiAssistant": "AI Assistant",
  "mapsExplore": "Maps Explore",
  "navigation": "Directions & Navigation",
  "routeBuilder": "Route Builder",
  "profileNotifications": "Profile & Notifications",
  "accessibility": "UI UX & Accessibility",
  "endToEnd": "End-to-End User Journeys",
};

const keys = new Map(); // key -> count
let collisions = 0;

fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).forEach(f => {
  let cat = "Uncategorized";
  for (const [k, v] of Object.entries(catMap)) {
    if (f.includes(k)) { cat = v; break; }
  }
  const content = fs.readFileSync(path.join(dir, f), "utf-8");
  const matches = [...content.matchAll(/it\s*\(\s*["'`](.*?)["'`]/g)].map(m => m[1]);
  matches.forEach(name => {
    const key = `${cat}::${name}`;
    if (keys.has(key)) {
      console.log(`COLLISION: category="${cat}" testName="${name}" in file ${f}`);
      collisions++;
    }
    keys.set(key, (keys.get(key) || 0) + 1);
  });
});

if (collisions === 0) {
  console.log(`No collisions found. All (testName, category) pairs are unique.`);
  console.log(`Total unique keys: ${keys.size}`);
} else {
  console.log(`${collisions} collision(s) found — Array.find() reconciliation is UNSAFE.`);
}

// Also check cross-category: any testName that appears in multiple specs
const nameMap = new Map();
fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).forEach(f => {
  const content = fs.readFileSync(path.join(dir, f), "utf-8");
  const matches = [...content.matchAll(/it\s*\(\s*["'`](.*?)["'`]/g)].map(m => m[1]);
  matches.forEach(name => {
    if (!nameMap.has(name)) nameMap.set(name, []);
    nameMap.get(name).push(f);
  });
});

let crossCatDups = 0;
nameMap.forEach((files, name) => {
  if (files.length > 1) {
    console.log(`CROSS-SPEC DUPLICATE testName "${name}" in: ${files.join(", ")}`);
    crossCatDups++;
  }
});
if (crossCatDups === 0) {
  console.log(`No cross-spec test name duplicates.`);
}
