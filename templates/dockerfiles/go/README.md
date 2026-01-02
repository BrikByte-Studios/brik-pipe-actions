# Go Dockerfile (BrikByteOS v1)

## Assumptions
- Go module project
- `go build ./...` produces a runnable binary (adjust if needed)
- App listens on 8080

## Notes
- Uses distroless runtime (nonroot) by default.
- If you need shell/debug tools, switch runtime to `debian:bookworm-slim` and add a user.
