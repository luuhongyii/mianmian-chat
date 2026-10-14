# Mianmian Chat

A simple, cute web chatbot built with [React ChatBotify](https://github.com/react-chatbotify/react-chatbotify), powered by NVIDIA cloud models, with streaming replies and conversation context.

## Running

Requires Node.js 22.12+ or 24+.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173.

The `NVIDIA_ENV_FILE` setting in the local `.env` file can point to an existing credentials file, or you can set `NVIDIA_API_KEY` directly in `.env`. The key is read only by the server and is not bundled into the web app. `NVIDIA_MODEL` defaults to `nvidia/nemotron-3.5-lightning-30b-a3b`, with thinking mode disabled.

```powershell
npm test
npm run build
npm start
```

Chat history is saved automatically in the current browser. Click History to switch between conversations and continue previous chats. Refreshing or reopening the same URL restores your history, and New chat does not delete previous conversations. History does not sync across browsers or devices. Clearing site data deletes the saved history.
