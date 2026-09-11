# The security release is source-only; build the pinned upstream release rather
# than falling back to an older prebuilt image.
FROM golang:1.24.8-alpine AS build
RUN apk add --no-cache git ca-certificates
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath github.com/minio/minio@${MINIO_VERSION}
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath github.com/minio/mc@${MC_VERSION}

FROM alpine:3.22 AS server
RUN apk add --no-cache ca-certificates && mkdir -p /data && chown 1000:1000 /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
USER 1000:1000
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]

FROM alpine:3.22 AS client
RUN apk add --no-cache ca-certificates
COPY --from=build /go/bin/mc /usr/local/bin/mc
USER 1000:1000
ENTRYPOINT ["mc"]
