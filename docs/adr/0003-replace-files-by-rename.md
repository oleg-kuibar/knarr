# Never write through an existing file; copy to a temp sibling and rename

Injection writes each changed file to a temporary sibling and renames it over the target, and publish swaps whole store entries the same way. pnpm and Bun hardlink installed files to their global store, so the earlier in-place overwrite leaked a linked build into that store and every other project using that version (commit 2b508f7). Rename also keeps readers from seeing half-written files. Because temp files are live during a concurrent inject, cleanup must not delete them blindly (commit 19a3e03).
