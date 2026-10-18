# Campfire

A cozy, self-hosted place for friends and communities to gather. Text, voice, video, and screen sharing—around your own digital campfire.

A place to catch up, share what you're working on, or just hang out together. Use Campfire in your browser or through the desktop app, with your community's own server at the center.

## What you can do

- **Chat together:** organize conversations into text channels, reply in threads, and message friends directly.
- **Hop into a call:** join a voice channel or start a private voice or video call with up to eight people.
- **Share your screen:** show a game, a project, or whatever you're watching, and choose whose streams to follow.
- **Share the little things:** send files and images, react with emojis, and add your community's own custom emojis.
- **Pick up where you left off:** browse older messages, search conversations, pin useful messages, and return to your saved reading position.
- **Make it yours:** choose a nickname, profile picture, status, and light or dark appearance.
- **Keep things comfortable:** adjust notifications, audio devices, and individual call volumes.
- **Look after your community:** manage invitations, roles, and who can see or post in each channel.

## Join a campfire

Ask your host for the server address and an invitation code if their community requires one. Open their browser link, or enter the address in the desktop app, then create an account or sign in.

Visit [Releases](https://github.com/d3cr1pt0r/Campfire/releases) for available desktop downloads. Each community has its own accounts and conversations.

## Host your own

With Node.js 22.13 or newer and npm installed, run these commands from the project folder:

```bash
npm ci
npm run build
npm run server
```

Open **http://localhost:3001**. Use the setup code printed in the server terminal to create the first account, which becomes the owner. New communities start in **Invite only** mode; manage invitations under **Settings → Server settings**.

Keep the server running for your community to stay connected. Your community's data is stored in `data/`; keep it backed up.

For internet hosting, use HTTPS and configure call connectivity. See [.env.example](.env.example) for the settings.

Prefer Docker? Run:

```bash
docker compose up --build -d
```

The setup code appears in `docker compose logs campfire`. Community data is kept in a persistent Docker volume.

For an existing installation, follow the [Campfire branding upgrade steps](REWORK.md#campfire-branding-upgrade) before starting this version.

## Run the desktop app from source

With the dependencies installed, open another terminal in the project folder and run:

```bash
npm start
```

Enter your community server's address when prompted. The desktop app connects to a server; it does not start one for you.

## For contributors and hosts

- [Configuration](.env.example)
- [Architecture and upgrade guide](REWORK.md)
- [Implementation notes](IMPLEMENTATION.md)

To check a code change:

```bash
npm run check
npm run build
npm test
```
