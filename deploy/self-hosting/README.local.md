# Local self-hosting images

This folder contains the official self-hosting stack plus a local override for
testing this checkout instead of the published Fluxer images.

## Build the local API and app images

```sh
cd deploy/self-hosting
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml build api app-proxy
```

The `worker` service uses the same `fluxer-api:local-iptv-profile` image as
`api`, so building `api` is enough for both API entrypoints.

## Run the stack with the local images

```sh
cd deploy/self-hosting
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml up -d
```

If you change API or app code later, rebuild the changed image and restart:

```sh
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml build api app-proxy
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local.yml up -d api worker app-proxy
```

## IPTV note

The local API image includes `ffmpeg`, which the IPTV service needs. LiveKit
ingress may still need to be enabled in the deployment environment before IPTV
streams can be started end-to-end.
