# 棉棉聊天

简单的可爱风网页版 chatbot，基于 [React ChatBotify](https://github.com/react-chatbotify/react-chatbotify)，接入 NVIDIA 云端模型，支持流式回复和当前对话上下文。

## 运行

需要 Node.js 22.12+ 或 24+。

```powershell
npm install
npm run dev
```

打开 http://127.0.0.1:5173。

本地 `.env` 的 `NVIDIA_ENV_FILE` 可指向已有密钥文件，也可以直接在 `.env` 中配置 `NVIDIA_API_KEY`。密钥仅由服务端读取，不打包到网页。`NVIDIA_MODEL` 默认为 `nvidia/nemotron-3.5-lightning-30b-a3b`，关闭思考模式。

```powershell
npm test
npm run build
npm start
```

聊天记录自动保存在当前浏览器。点击 History 可切换并继续之前的对话；刷新或重新打开同一地址可恢复记录，New chat 不会删除旧对话。记录不跨浏览器或设备同步，清除网站数据会删除记录。
