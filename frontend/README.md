# Trade Frontend

Static browser app for the Netrue crypto trading platform.

## Local Preview

```bash
npm start
```

By default, the frontend calls API routes on the same origin. For a separate frontend deployment, update `window.TRADE_API_BASE_URL` in `public/config.js` or configure your host to proxy `/api`, `/ws`, and `/socket.io` to the backend deployment.

## Render Static Site

- Build command: `npm install && npm run build`
- Publish directory: `public`
- Environment variable: `TRADE_API_BASE_URL=https://trade-backend-tsjf.onrender.com`
