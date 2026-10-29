/// <reference types="vite/client" />
import type { VidLiftApi } from "../shared/types";

declare global {
  interface Window {
    /** Exposed by the preload script; the page's only way to reach the app. */
    vidlift: VidLiftApi;
  }
}

export {};
