FROM eclipse-temurin:25-jdk@sha256:e787e08ef76f4c16866108cd7f9fcd96a68eef3ac6cc76866897d4d02d5a2262 AS build
WORKDIR /app
COPY backend/ .
ARG JAVA_TOOL_OPTIONS
RUN --mount=type=cache,id=hadesd-gradle,target=/root/.gradle ./gradlew --no-daemon bootJar
FROM eclipse-temurin:25-jre@sha256:f9e65324a37f28209ce7dd0e5149a7aa954520ed936fb87813cf6ded2400a112
WORKDIR /app
COPY --from=build /app/build/libs/*.jar /app/
USER 1000:1000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${SERVER_PORT:-8080}; printf 'GET /health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; IFS= read -r line <&3; [[ \"$line\" == *' 200 '* ]]"]
ENTRYPOINT ["sh", "-c", "exec java --enable-native-access=ALL-UNNAMED -jar /app/daemon-1.0.0.jar \"$@\"", "--"]
