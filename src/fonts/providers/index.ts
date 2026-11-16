import type { FontProvider, FontProviderName } from "../types";
import { googleProvider } from "./google";
import { localProvider } from "./local";

/** Add new providers here (and to `FONT_PROVIDERS`) */
export const providers: Record<FontProviderName, FontProvider> = {
  google: googleProvider,
  local: localProvider,
};
