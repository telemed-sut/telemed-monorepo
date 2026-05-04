// fallow-ignore-file circular-dependency
type PreloadKey = "patient-detail" | "patient-heart-sound";

const preloadedBundles = new Map<PreloadKey, Promise<void>>();
const shouldSkipBundlePreload = process.env.NODE_ENV === "test";

function preloadOnce(key: PreloadKey, loader: () => Promise<unknown>) {
  const existing = preloadedBundles.get(key);
  if (existing) {
    return existing;
  }

  const next = loader()
    .then(() => undefined)
    .catch(() => undefined);

  preloadedBundles.set(key, next);
  return next;
}

export function preloadPatientDetailBundle() {
  if (shouldSkipBundlePreload) {
    return Promise.resolve();
  }
  return preloadOnce("patient-detail", () =>
    import("@/components/dashboard/patient-detail")
  );
}

export function preloadPatientHeartSoundBundle() {
  if (shouldSkipBundlePreload) {
    return Promise.resolve();
  }
  return preloadOnce("patient-heart-sound", () =>
    import("@/components/dashboard/patient-heart-sound")
  );
}

export function preloadPatientWorkspaceBundles() {
  return Promise.all([
    preloadPatientDetailBundle(),
    preloadPatientHeartSoundBundle(),
  ]).then(() => undefined);
}
