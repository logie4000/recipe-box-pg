# syntax=docker/dockerfile:1
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG APP_VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/read-api ./cmd/read-api

# distroless: no shell, runs as nonroot.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/read-api /read-api
ENV READ_API_ADDR=:8080 READ_API_SKIP_DOTENV=1
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/read-api"]
