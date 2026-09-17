# Iteration 1 website for plain routerest.app (archived)

This folder is the same Iteration 1 website as `archive/iteration1`, built
a second time for the root address. While `ROOT_SITE` in `next.config.ts`
is `"iteration1"`, the main site shows it at `routerest.app`,
`routerest.app/newjourney` and `routerest.app/route-breaks`, with no
`/iteration1` in the address.

A second build is needed because `archive/iteration1` was built with
`basePath: "/iteration1"`, so every link and file inside it points under
`/iteration1`.

**Do not edit anything in this folder by hand.** It is build output.

## Where it comes from

- Source: commit `d01879e`, the same commit as `archive/iteration1`.
- Config: `output: "export"` and `assetPrefix: "/iteration1-root"`, with no
  `basePath`. Links point at the root pages. Scripts and styles are
  requested from `/iteration1-root/_next/...`, so they cannot clash with
  the main site's own `/_next` files.
- Built with the same package versions as the main site.

## How it is served

1. `scripts/prepare-iteration1.mjs` copies the files to
   `public/iteration1-root/` (gitignored), filling in the placeholders, and
   bundles the pages and the `.txt` navigation data into
   `app/iteration1-root/[[...slug]]/pages.generated.ts`.
2. `next.config.ts` rewrites `/`, `/newjourney`, `/route-breaks` and the
   navigation data Next asks for (`/index.txt`,
   `/newjourney/__next._tree.txt` and so on) to
   `app/iteration1-root/[[...slug]]/route.ts`, which returns them.

The placeholders are the same as in `archive/iteration1`:
`__ROUTEREST_ITERATION1_API_URL__` and
`__ROUTEREST_ITERATION1_MAPTILER_KEY__`.

## Rebuilding this folder

From a checkout of commit `d01879e`, in `frontend/my-app`, set
`next.config.ts` to:

```ts
const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: "/iteration1-root",
};
```

Then:

```bash
npm ci
NEXT_PUBLIC_API_URL="__ROUTEREST_ITERATION1_API_URL__" \
NEXT_PUBLIC_MAPTILER_KEY="__ROUTEREST_ITERATION1_MAPTILER_KEY__" \
npx next build
```

Replace the contents of this folder (keeping this README) with the
contents of `out/`.
