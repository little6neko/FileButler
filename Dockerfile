FROM node:25-alpine AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web/dist ./web/dist
RUN go build -o /out/filebutler ./cmd/filebutler

FROM alpine:3.22
ARG VERSION=0.1.2
LABEL org.opencontainers.image.version="${VERSION}"
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend /out/filebutler /usr/local/bin/filebutler
COPY --from=frontend /src/web/dist /app/web/dist
COPY configs/filebutler.docker.yaml /app/filebutler.yaml
EXPOSE 8080
ENTRYPOINT ["filebutler"]
CMD ["-config", "/app/filebutler.yaml"]
