// Build-time constants injected by vite.config.ts define option.
// Used by UI to show "you are on build <hash>" so cache issues are visible.

export const BUILD_HASH: string = __BUILD_HASH__;
export const BUILD_TIME: string = __BUILD_TIME__;

export const BUILD_LABEL = `build ${BUILD_HASH} · ${BUILD_TIME.slice(0, 16).replace('T', ' ')}`;
