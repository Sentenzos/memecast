export function demoModeEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_MODE === "true";
}
