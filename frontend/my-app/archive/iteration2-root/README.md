# Iteration 2 website (archived, built for the plain address)

The same website as `archive/iteration2`, built a second time for plain
`routerest.app` instead of `routerest.app/iteration2`. The main site
serves it on the plain addresses while `ROOT_SITE` in `next.config.ts` is
`"iteration2"`, which it is until the Iteration 3 presentation.

**Do not edit anything in this folder by hand.** It is build output.

## Why a second build exists

`basePath` is baked into a static build: every script, style and link in
`archive/iteration2` starts with `/iteration2`. Serving those files at
`routerest.app/newjourney` would ask the browser for
`/iteration2/_next/...` from a page that is not under `/iteration2`, and
nothing would load. So the same source is built again with no `basePath`.

Only one of the two is ever the site at the root. `/iteration2` always
serves the other one.

## How it is served

1. `scripts/prepare-archives.mjs` copies this folder to
   `public/iteration2-root/` (gitignored), filling in the placeholders.
2. Scripts and styles are then served from `/iteration2-root/_next/...`.
3. The pages **and** the navigation data Next fetches when a link is
   clicked (`/index.txt`, `/newjourney/__next._tree.txt` and the like)
   are returned by `app/iteration2-root/[[...slug]]/route.ts`. The data is
   bundled into that module rather than left in `public/`, because those
   files are asked for at root addresses which `next.config.ts` rewrites,
   and a rewrite can only reach server code, never a file on the CDN.

## What is deliberately not here

No `models/`, `maplibre/` or `mediapipe/` folder. The face model, the map
worker and the camera runtime are requested at `/models/...`,
`/maplibre/...` and `/mediapipe/...`, addresses at the site root rather
than under this build's prefix, so copies kept here would never be
fetched. Every iteration uses the live site's files in `public/`. Leaving
them out saves about 38 MB per build, most of it the camera runtime.

Keep those three addresses working, or the archived camera check and map
stop working too.

## Placeholders

| Placeholder | Filled from |
|---|---|
| `__ROUTEREST_ITERATION2_API_URL__` | `NEXT_PUBLIC_API_URL` |
| `__ROUTEREST_ITERATION2_MAPTILER_KEY__` | `NEXT_PUBLIC_MAPTILER_KEY` |

## Rebuilding this folder

From a checkout of the `iteration-2` branch, in `frontend/my-app`, with
`basePath: "/iteration2"` in `next.config.ts` replaced by
`assetPrefix: "/iteration2-root"`:

```bash
npm ci
NEXT_PUBLIC_API_URL="__ROUTEREST_ITERATION2_API_URL__" \
NEXT_PUBLIC_MAPTILER_KEY="__ROUTEREST_ITERATION2_MAPTILER_KEY__" \
npx next build
```

Then replace the contents of this folder (keeping this README) with the
contents of `out/`, minus `models/`, `maplibre/` and `mediapipe/`.
