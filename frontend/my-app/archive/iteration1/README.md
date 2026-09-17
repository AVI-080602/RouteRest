# Iteration 1 website (archived)

This folder is the RouteRest website as it was at the end of Iteration 1
(everything up to 4 September 2026), built as plain static files. The
main site serves it at `routerest.app/iteration1`.

**Do not edit anything in this folder by hand.** It is build output. To
change the Iteration 1 site, change the `iteration-1` branch and rebuild
this folder as described below.

## Where it comes from

- Source: branch `iteration-1`, frozen at commit `d01879e` (the last
  commit on `main` before 13 September) plus one config commit that adds
  `basePath: "/iteration1"` and `output: "export"`.
- Built with the same package versions as the main site (every package
  the Iteration 1 site uses is at the same version on both).

## How it is served

1. `scripts/prepare-iteration1.mjs` runs on `postinstall`, `predev` and
   `prebuild`. It copies this folder to `public/iteration1/` (gitignored)
   and fills in the two placeholders below from the environment.
2. The static files (`/iteration1/_next/...`, the `.txt` navigation data)
   are then served like any other public file.
3. The three pages (`/iteration1`, `/iteration1/newjourney`,
   `/iteration1/route-breaks`) are returned by
   `app/iteration1/[[...slug]]/route.ts`, because a request for
   `/iteration1/newjourney` does not map to `newjourney.html` on its own.

## Placeholders

No key or address is stored in this folder. The build uses placeholders,
which the prepare script replaces:

| Placeholder | Filled from |
|---|---|
| `__ROUTEREST_ITERATION1_API_URL__` | `NEXT_PUBLIC_API_URL` |
| `__ROUTEREST_ITERATION1_MAPTILER_KEY__` | `NEXT_PUBLIC_MAPTILER_KEY` |

## Rebuilding this folder

From a checkout of the `iteration-1` branch, in `frontend/my-app`:

```bash
npm ci
NEXT_PUBLIC_API_URL="__ROUTEREST_ITERATION1_API_URL__" \
NEXT_PUBLIC_MAPTILER_KEY="__ROUTEREST_ITERATION1_MAPTILER_KEY__" \
npx next build
```

Then replace the contents of this folder (keeping this README) with the
contents of `out/`.
