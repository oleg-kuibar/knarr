# Mutable store entries keyed by name and version, with bounded history

A store entry is one mutable slot per `name@version`, overwritten by each publish, not a content-addressed store. During development a package is republished many times without a version bump, and consumers should get the latest build under the version they already resolve. To make overwriting reversible, the replaced build moves to the entry's `history/` (default limit 3), and `rollback` brings one back. The content hash only answers "did anything change?"; it is not the storage key.
