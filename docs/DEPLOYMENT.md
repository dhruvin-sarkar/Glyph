# GitHub Pages

GLYPHFIELD is published from the `main` branch of
[dhruvin-sarkar/Glyph](https://github.com/dhruvin-sarkar/Glyph).
The site address is [dhruvin-sarkar.github.io/Glyph/](https://dhruvin-sarkar.github.io/Glyph/).

## Publishing

The repository's **Settings → Pages → Build and deployment → Source** must be
**GitHub Actions**. Every push to `main` runs `.github/workflows/deploy.yml`.
The workflow installs the lockfile with Node.js 24 and `npm ci`, runs the test
suite, type-checks and builds the application, then publishes `dist/` through
GitHub's official Pages actions. The same workflow can be run manually from
the repository's **Actions** tab.

Deployment uses GitHub's built-in token and OpenID Connect; no additional
repository secrets are required. Deployments are serialized through the
`github-pages` concurrency group and use the `github-pages` environment.

## Build paths

```sh
npm run build -- --mode pages
npm run preview -- --mode pages
```

The `pages` mode sets Vite's asset base to `/Glyph/`. Open the local preview at
`http://localhost:4173/Glyph/` to check the same paths used on GitHub Pages.

The regular `npm run build` retains relative asset paths for local or other
static hosting. `npm run build:single` retains the self-contained offline HTML
in `dist-single/`. GitHub Pages publishes the standard multi-file build in
`dist/`, including the bundled fonts; it does not require a backend service.

## Checking a deployment

1. Confirm both jobs in **Actions → Publish GLYPHFIELD** finish successfully.
2. Open the URL reported by the deployment job and hard-refresh after updates.
3. Check the field, all three experiments, the parameter controls and the math
   drawer. Check a narrow viewport as well as a desktop viewport.

A successful build confirms the tests, TypeScript compilation and static
packaging. Browser checks establish that the deployed site and its asset
paths load; they do not establish performance on every exhibition device.

## References

- [Vite: Deploying a static site](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub: Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
