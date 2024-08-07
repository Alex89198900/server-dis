import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import compression from 'compression';
import path from 'path';
import bodyParser from 'body-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { Server } from 'socket.io';
import serversRoutes from './src/routes/servers';
import usersRoutes from './src/routes/users';
import personalMessagesRoutes from './src/routes/personal-messages';
import chatsRoutes from './src/routes/chats';
import channelsRoutes from './src/routes/channels';
import testRoutes from './src/routes/test';
import { initSocket } from './src/socket';
import cors from 'cors';
import * as passportConfig from './src/passport';
import env from './src/config';
import passport from 'passport';
import {
  AppSocket,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './src/socket/types';
import fileUpload from 'express-fileupload';
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
declare module 'express-session' {
  interface SessionData {
    returnTo: string;
  }
}

const whitelist = ['http://localhost:3000', 'http://localhost:8005'];

mongoose.set('strictQuery', true);

const isLocalConnection = true;

const mongooseUrl = isLocalConnection
  ? `mongodb://localhost:27017/discord`
  : 'mongodb+srv://superconscience:QrtczmnqiciavAoI@node.wiauk.mongodb.net/?retryWrites=true&w=majority';

type AppClients = Record<string, AppSocket>;

export class App {
  private server: http.Server;
  private port: number;

  private static io: Server;
  private static clients: AppClients = {};

  static getIo(): Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
    return App.io;
  }

  constructor(port: number) {
    this.port = port;
    const app = express();

    app.set('port', this.port || 3000);
    app.use(express.static(path.join(__dirname, '../../client/dist')));

    app.use(
      cors({  
          origin: true,
          // Allow follow-up middleware to override this CORS for options
          preflightContinue: true,
        credentials: true,
      })
    );

    app.use(compression());
    app.use(express.json());

    app.use(bodyParser.urlencoded({ extended: true }));
    // app.use(express.static(path.resolve(__dirname, 'static')));
    // app.use(fileUpload());
    app.use(
      session({
        resave: true,
        saveUninitialized: true,
        secret: 'gagagigu89',
        store: new MongoStore({
          mongoUrl:
          'mongodb+srv://alexdark02091989:Nv1vE8F3VHgoAnoK@discord.sz52rul.mongodb.net/?retryWrites=true&w=majority&appName=discord',
          mongoOptions: {
            connectTimeoutMS: 10000,
          },
        }),
      })
    );
    app.use(passport.initialize());
    app.use(passport.session());
    app.use((req, res, next) => {
      res.locals.user = req.user;
      next();
    });
    app.use((req, res, next) => {
      // After successful login, redirect back to the intended page
      if (
        !req.user &&
        req.path !== '/login' &&
        req.path !== '/signup' &&
        !req.path.match(/^\/auth/) &&
        !req.path.match(/\./)
      ) {
        req.session.returnTo = req.path;
      } else if (req.user && req.path == '/account') {
        req.session.returnTo = req.path;
      }
      next();
    });

    // TODO: add validation
    app.use('/test', testRoutes);
    app.use('/servers', serversRoutes);
    app.use('/users', usersRoutes);
    app.use('/personal-messages', personalMessagesRoutes);
    app.use('/chats', chatsRoutes);
    app.use('/channels', channelsRoutes);

    this.server = new http.Server(app);

    App.io = initSocket(this);
  }

  public Start() {
    if (process.env.MODE === 'front') {
      this.server.listen(this.port, () => {
        console.log(`Server listening on port ${this.port}. No database connection`);
      });
      return;
    }
    mongoose
      .connect(
        'mongodb+srv://alexdark02091989:Nv1vE8F3VHgoAnoK@discord.sz52rul.mongodb.net/?retryWrites=true&w=majority&appName=discord'
      )
      .then((result) => {
        // serversController.seedServers();
        this.server.listen(this.port, () => {
          console.log(`Server listening on port ${this.port}.`);
        });
      })
      .catch((err) => console.log(err));
  }

  static getClients(): AppClients {
    return App.clients;
  }

  static getClient(id: string): AppSocket {
    return App.clients[id];
  }

  static setClient(id: string, value: AppSocket): void {
    App.clients[id] = value;
  }

  getServer(): http.Server {
    return this.server;
  }
}

new App(8000).Start();
