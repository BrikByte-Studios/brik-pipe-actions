# Node Dockerfile (BrikByteOS v1)

## Assumptions
- `npm ci` is valid (a lockfile exists)
- `npm run build` produces `dist/`
- `node dist/index.js` starts the app

## Build args (OCI labels)
- IMAGE_SOURCE, VCS_REF, BUILD_DATE

## Local build
```bash
docker build \
  --build-arg IMAGE_SOURCE="https://github.com/ORG/REPO" \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t node-service:dev .
```

## Common override points
- If your output isn’t `dist/`, update COPY + CMD.
- If you use `pnpm` or `yarn``, swap install steps accordingly.