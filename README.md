# SHOOTEM UP

SHOOTEM UP is a browser-based voxel first-person arena shooter built around
short, decisive 1v1 duels. Every round moves to a new arena with a different
set of disposable weapons. Win two takes to claim a round; win four rounds to
take the match.

![SHOOTEM UP title screen](docs/screenshot.png)

The game is designed to be immediately playable against a movement-aware bot.
It includes sprinting, sliding, wall-running, air control, seven distinct
weapons, three original arenas, synthesized spatial audio, voxel destruction,
dynamic lighting, post-processing, and a complete match loop.

## Controls

- `WASD` move
- `Mouse` aim
- `Left mouse` fire
- `Right mouse` focus
- `Shift` sprint
- `Space` jump / wall-run
- `Control` or `C` slide
- `R` discard an empty weapon
- `Escape` pause

## Development

```sh
npm install
npm run dev
```

Run the test suite and production build:

```sh
npm test
npm run build
```

Serve the production build on port 8080:

```sh
npm start
```

## Deployment

The included `Dockerfile` and `fly.toml` deploy the production server to
Fly.io:

```sh
flyctl deploy
```

## Design note

SHOOTEM UP takes inspiration from the pace and pickup-driven structure of
small-format arena shooters. Its code, arenas, models, effects, sound design,
interface, and visual identity are original.
