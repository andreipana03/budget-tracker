# Production image for the API. Build context is the repo root (see deploy/docker-compose.prod.yml).
FROM golang:1.27-alpine AS build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum backend/tools.mod backend/tools.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -modfile=tools.mod -o /out/goose github.com/pressly/goose/v3/cmd/goose

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/api /out/goose /app/
COPY backend/db/migrations /app/migrations
USER app
EXPOSE 8080
CMD ["/app/api"]
