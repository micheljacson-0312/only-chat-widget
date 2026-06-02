import { Server as NetServer } from "http";
import { NextApiRequest } from "next";
import { NextApiResponseServerIO } from "@/types/socket";
import { initSocketServer } from "@/lib/services/socket-server";

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Pages-router bootstrap for Socket.IO during `next dev`. In production the
 * custom Node server (server.js) initialises the same shared socket server.
 * Both paths call `initSocketServer`, so there is a single implementation.
 */
const ioHandler = (_req: NextApiRequest, res: NextApiResponseServerIO) => {
  if (!res.socket.server.io) {
    const httpServer: NetServer = res.socket.server as unknown as NetServer;
    res.socket.server.io = initSocketServer(httpServer);
  }
  res.end();
};

export default ioHandler;
