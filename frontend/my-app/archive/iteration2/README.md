# Iteration 2 website (archived)

This folder is the RouteRest website as it was at the end of Iteration 2
(everything up to 29 September 2026), built as plain static files. The
main site serves it at `routerest.app/iteration2`.

**Do not edit anything in this folder by hand.** It is build output. To
change the Iteration 2 site, change the `iteration-2` branch and rebuild
this folder as described below.

## Where it comes from

- Source: branch `iteration-2`, frozen at the last commit on `main` that
  belongs to Iteration 2, plus one config commit that adds
  `basePath: "/iteration2"` and `output: "export"`, removes the rewrites
  and the machinery that serves older iterations, and makes
  `utils/appNavigation.tsx` a passthrough (with `basePath` set, Next.js
  already adds the prefix, so adding it again would produce
  `/iteration2/iteration2/newjourney`).
- Built with the same package versions as the main site.

## How it is served

1. `scripts/prepare-archives.mjs` runs on `postinstall`, `predev` and
   `prebuild`. It copies this folder to `public/iteration2/` (gitignored)
   and fills in the two placeholders below from the environment.
2. The static files (`/iteration2/_next/...`, the `.txt` navigation data)
   are then served like any other public file.
3. The pages are returned by `app/iteration2/[[...slug]]/route.ts`,
   because a request for `/iteration2/newjourney` does not map to
   `newjourney.html` on its own.

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

No key or address is stored in this folder. The build uses placeholders,
which the prepare script replaces:

| Placeholder | Filled from |
|---|---|
| `__ROUTEREST_ITERATION2_API_URL__` | `NEXT_PUBLIC_API_URL` |
| `__ROUTEREST_ITERATION2_MAPTILER_KEY__` | `NEXT_PUBLIC_MAPTILER_KEY` |

## Rebuilding this folder

From a checkout of the `iteration-2` branch, in `frontend/my-app`:

```bash
npm ci
NEXT_PUBLIC_API_URL="__ROUTEREST_ITERATION2_API_URL__" \
NEXT_PUBLIC_MAPTILER_KEY="__ROUTEREST_ITERATION2_MAPTILER_KEY__" \
npx next build
```

Then replace the contents of this folder (keeping this README) with the
contents of `out/`, minus `models/`, `maplibre/` and `mediapipe/`.
