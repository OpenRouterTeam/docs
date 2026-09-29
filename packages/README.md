## NOTES

- We separate utils into several runtime-specific packages to help with bundling and tree-shaking. It's easier to pick which package should be included in which runtime/bundle this way.

- To create a new package, make a new directory, and copy the `package.json` and `tsconfig.json` from an existing package.
