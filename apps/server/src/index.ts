import './loadEnv.js';
import http from 'http';
import app from './app.js';
import { attachYjsWebSocket } from './collab/yjsSocket.js';

const port = Number(process.env.PORT ?? 3000);

const server = http.createServer(app);
attachYjsWebSocket(server);

server.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
