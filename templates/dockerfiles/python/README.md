# Python Dockerfile (BrikByteOS v1)

## Assumptions
- `requirements.txt` exists
- App runs via: `uvicorn app:app`

## Build args (OCI labels)
- IMAGE_SOURCE, VCS_REF, BUILD_DATE

## Common override points
- If you use Poetry/pyproject, add a separate scaffold variant later.
- If not using ASGI, replace CMD with your entrypoint.
