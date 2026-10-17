export type * from '../shared/contracts';
import type { Socket } from 'socket.io-client';
import type { ServerEvents, ClientEvents } from '../shared/contracts';
export type AppSocket = Socket<ServerEvents, ClientEvents>;
