/**
 * TripSync Appium E2E — Centralized Test Data
 * All credentials and test content sourced from environment variables.
 * Never hardcode credentials in test files.
 */

"use strict";

const testData = {
  // ─────── Authentication ───────
  credentials: {
    validEmail: process.env.TEST_EMAIL || "testuser@tripsync.dev",
    validPassword: process.env.TEST_PASSWORD || "Test@123456",
    invalidEmail: "invalid@notexist.xyz",
    invalidPassword: "WrongPass999",
    newUserEmail: `e2e_${Date.now()}@tripsync.dev`,
    newUserPassword: "NewUser@12345",
    newUserName: process.env.TEST_USER_NAME || "E2ETestUser",
  },

  // ─────── App Package ───────
  app: {
    package: "com.kondajeswanth.TripSyncApp",
    activity: "com.kondajeswanth.TripSyncApp.MainActivity",
    apkPath:
      process.env.APK_PATH ||
      "android/app/build/outputs/apk/debug/app-debug.apk",
  },

  // ─────── Trips ───────
  trips: {
    name: "E2E Goa Adventure",
    destination: "Goa, India",
    budget: "30000",
    startDate: "2025-12-01",
    endDate: "2025-12-05",
    editedName: "E2E Goa Adventure (Edited)",
    editedDestination: "Goa - Updated",
  },

  // ─────── Groups ───────
  groups: {
    name: "E2E Travel Squad",
    destination: "Kerala, India",
    budget: "50000",
    startDate: "2025-11-15",
    endDate: "2025-11-20",
    editedName: "E2E Travel Squad (Updated)",
    joinCode: process.env.TEST_GROUP_CODE || "TRIPSYNC01",
    chatMessage: "Hello from E2E automation! 🤖",
  },

  // ─────── AI Assistant ───────
  ai: {
    chatPrompt: "Plan a 3-day trip to Goa",
    safetyPrompt: "Is Goa safe to visit?",
  },

  // ─────── Maps & Explore ───────
  maps: {
    searchQuery: "Taj Mahal, Agra",
    searchQueryShort: "Goa Beach",
  },

  // ─────── Navigation ───────
  navigation: {
    routeFrom: "Goa Airport",
    routeTo: "Calangute Beach",
  },

  // ─────── Timeouts (ms) ───────
  timeouts: {
    elementWait: 20000,
    appLaunch: 45000,
    networkOp: 30000,
    animationSettle: 2000,
    shortPause: 1000,
  },
};

module.exports = testData;
