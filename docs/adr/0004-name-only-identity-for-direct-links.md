# Check only the package name for a consumer's own node_modules link

Before injecting through a symlink into a virtual store, Knarr checks that the resolved directory belongs to the package. When the consumer's own `node_modules/<pkg>` points there, only the name must match, because the package's version is often bumped mid-development while the consumer still has the old version installed. Directories found by scanning the virtual store, with no direct link, must match name and version, since nothing else ties them to this consumer. See `resolveInjectionTarget` in `src/core/injector.ts`.
