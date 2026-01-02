# .NET Dockerfile (BrikByteOS v1)

## Assumptions
- .NET 8
- Solution at repo root (adjust COPY steps for monorepos)
- Published output runs as `dotnet YourService.dll`

## Required edits
- Replace `YourService.dll` with your app dll name.
- If csproj is nested, tune the restore COPY section.
