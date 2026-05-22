const GRAPH_PRICING_CONFIRMATION_STORAGE_KEY = "media-studio:graph-studio:skip-pricing-confirmation";

export function readSkipGraphPricingConfirmationPreference() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(GRAPH_PRICING_CONFIRMATION_STORAGE_KEY) === "1";
}

export function writeSkipGraphPricingConfirmationPreference(skip: boolean) {
  if (typeof window === "undefined") return;
  if (skip) {
    window.localStorage.setItem(GRAPH_PRICING_CONFIRMATION_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(GRAPH_PRICING_CONFIRMATION_STORAGE_KEY);
}

export { GRAPH_PRICING_CONFIRMATION_STORAGE_KEY };
