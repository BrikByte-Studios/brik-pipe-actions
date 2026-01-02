# Java Dockerfile (BrikByteOS v1)

## Assumptions
- Maven project (`pom.xml`)
- `mvn package` produces `target/*.jar`
- App listens on port 8080

## Common override points
- Gradle projects: create a separate `java-gradle/` scaffold later.
- If your jar name is fixed, replace `target/*.jar` with exact file.
