import { DTOServer, DTOUser } from 'dto';
import { Handler, NextFunction, Request, Response } from 'express';
import { body, check, validationResult } from 'express-validator';
import { TypedRequest } from 'express.types';
import fs from 'fs';
import mongoose, { HydratedDocument } from 'mongoose';
import passport from 'passport';
import { IVerifyOptions } from 'passport-local';
import sharp from 'sharp';
import Server from '../models/server';
import Channel from '../models/channel';
import User, { Availability, UserDocument, validateUserField } from '../models/user';
import '../passport';
import { FetchedChannel, FetchedServer, FetchedUser, serverDTO, userDTO } from '../utils/dto';
import { handleDocumentNotFound, requestErrorHandler } from '../utils/functions';

const checkAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user) {
    req.logIn(req.user, (err) => {
      if (err) {
        return next(err);
      }
      res.status(200).json({ user: userDTO(req.user as FetchedUser) });
    });
    return;
  }
  res.status(200).json({ user: null });
};

const login = async (req: TypedRequest, res: Response, next: NextFunction): Promise<void> => {
  await check('email', 'Email is not valid').isEmail().run(req);
  await check('password', 'Password cannot be blank').isLength({ min: 1 }).run(req);
  await body('email').normalizeEmail({ gmail_remove_dots: false }).run(req);

  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(401).json(errors);
    return;
  }

  passport.authenticate('local', (err: Error, user: UserDocument, info: IVerifyOptions) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      res.status(401).json({ message: info.message });
      return;
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      const { id } = user;
      User.findById(id)
        .populate(['chats', 'invitesToChannels', 'joinedChannels'])
        .then((user) => {
          if (!user) {
            const error = new Error('Could not find user.');
            //error.statusCode = 404;
            throw error;
          }
          user.availability = Availability.Online;
          user
            .save()
            .then(() => {
              res.status(200).json({ user: userDTO(user as FetchedUser) });
            })
            .catch((err) => requestErrorHandler(err, next)());
        })
        .catch((err) => requestErrorHandler(err, next)());
    });
  })(req, res, next);
};

const logout = (req: TypedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.send(200).end();
  }
  const { id } = req.user as HydratedDocument<UserDocument>;
  req.logout((err) => {
    if (err) {
      next(err);
    }
    User.findById(id)
      .then((user) => {
        if (!user) {
          const error = new Error('Could not find user.');
          //error.statusCode = 404;
          throw error;
        }
        user.availability = Availability.Offline;
        user
          .save()
          .then(() => {
            res.status(200).end();
          })
          .catch((err) => requestErrorHandler(err, next)());
      })
      .catch((err) => requestErrorHandler(err, next)());
  });
};

const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  await check('email', 'Email is not valid').isEmail().run(req);
  await check('password', 'Password must be at least 4 characters long').isLength({ min: 4 }).run(req);
  // await check('confirmPassword', 'Passwords do not match').equals(req.body.password).run(req);
  await body('email').normalizeEmail({ gmail_remove_dots: false }).run(req);

  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(401).json(errors);
    return;
  }

  const user = new User({
    email: req.body.email,
    password: req.body.password,
    name: req.body.name,
    availability: Availability.Online,
  });

  User.findOne({ email: req.body.email }, (err: NativeError, existingUser: UserDocument) => {
    if (err) {
      return next(err);
    }
    if (existingUser) {
      res.status(401).json({ message: 'Account with that email address already exists' });
      return;
    }
    user.save((err) => {
      if (err) {
        return next(err);
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        res.status(200).json({ user: userDTO(user) });
      });
    });
  });
};

const getUsers: Handler = (req, res, next) => {
  let docsCount = 0;

  User.find()
    .countDocuments()
    .then((count) => {
      docsCount = count;
      return User.find().populate(['chats', 'invitesToChannels', 'joinedChannels']);
    })
    .then((users) => {
      const exportedUsers = users.map((u) => userDTO(u));
      res.status(200).json({
        message: 'Fetched users successfully.',
        count: docsCount,
        users: exportedUsers,
      });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const createUser: Handler = (req, res, next) => {
  const user = new User({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    phone: req.body.phone,
  });

  user
    .save()
    .then((result) => {
      res.status(201).json({
        message: 'User created successfully!',
        user: userDTO(user),
      });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const getUser: Handler = (req, res, next) => {
  const userId = req.params.id;
  User.findById(userId)
    .populate(['chats', 'invitesToChannels', 'joinedChannels'])
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        //error.statusCode = 404;
        throw error;
      }
      res.status(200).json({ messageInfo: 'User fetched.', user: userDTO(user) });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const searchUsers: Handler = (req, res, next) => {
  const search = req.query.search;

  if (!search) {
    res.status(200).json({ users: [] });
    return;
  }

  const regexpOptions = { $regex: search, $options: 'i' };

  User.find({ $or: [{ name: regexpOptions }, { email: regexpOptions }] })
    .then((users) => {
      res.status(200).json({
        message: 'Users found',
        users: users.map((u) => userDTO(u as FetchedUser)),
      });
    })
    .catch((err) => requestErrorHandler(err, next));
};

const updateUser = (
  req: TypedRequest<
    { socketId: string; remove: (keyof DTOUser)[] | undefined },
    DTOUser & { invitesToChannels: string[]; joinedChannels: string[] }
  >,
  res: Response,
  next: NextFunction
) => {
  const { id: userId } = req.params;
  const { remove } = req.query;

  User.findById(userId)
    .populate('chats')
    .then(async (user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }
      Object.entries(User.schema.paths).map(([path, data]) => {
        if (path in req.body) {
          if (path === 'name' || path === 'email' || path === 'password' || path === 'phone') {
            user[path] = req.body[path];
          } else if (
            path === 'invitesFrom' ||
            path === 'invitesTo' ||
            path === 'friends' ||
            path === 'invitesToChannels' ||
            path === 'joinedChannels'
          ) {
            if (remove && remove.includes(path)) {
              const newValueOfStr = (user[path] || [])
                .map((id) => id.toString())
                .filter((id) => !req.body[path].includes(id));
              user[path] = [...new Set(newValueOfStr)].map((id) => new mongoose.Types.ObjectId(id));
            } else {
              const newValueOfStr = (user[path] || []).map((id) => id.toString()).concat(req.body[path]);
              user[path] = [...new Set(newValueOfStr)].map((id) => new mongoose.Types.ObjectId(id));
            }
          }
        } else if (req.body.profile) {
          if (path === 'profile.about') {
            const about = req.body.profile.about;
            if (about !== undefined) {
              user.profile.about = about || '';
            }
          } else if (path === 'profile.banner') {
            const banner = req.body.profile.banner;
            if (banner !== undefined) {
              user.profile.banner = banner || '';
            }
          }
        }
      });

      if (req.file) {
        console.log(req.file);
        if (req.file) {
          const buffer = await sharp(req.file.path).resize().jpeg({ quality: 10 }).toBuffer();
          fs.unlinkSync(req.file.path);
          user.profile.avatar = Buffer.from(buffer.toString('base64'), 'base64');
        }
      }

      return user.save();
    })
    .then((user) => {
      user
        .populate(['chats', 'invitesToChannels', 'joinedChannels'])
        .then((user) => {
          res.status(200).json({ messageInfo: 'User updated!', user: userDTO(user) });
        })
        .catch((err) => requestErrorHandler(err, next));
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const deleteUser: Handler = (req, res, next) => {
  const userId = req.params.id;
  User.findById(userId)
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }
      return User.findByIdAndRemove(userId);
    })
    .then((result) => {
      res.status(200).json({ messageInfo: 'Deleted user.' });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const getFriends: Handler = (req, res, next) => {
  const userId = req.params.id;

  User.findById(userId)
    .populate('friends')
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }
      const exportedFriends = user.friends.map((f) => userDTO(f as unknown as FetchedUser));
      res.status(200).json({ messageInfo: 'Friends fetched.', friends: exportedFriends });
    })
    .catch((err) => requestErrorHandler(err, next));
};

const getInvitedToFriends: Handler = (req, res, next) => {
  const userId = req.params.id;

  User.findById(userId)
    .populate('invitesTo')
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }
      const invitedToFriends = (user.invitesTo || []).map((f) => userDTO(f as unknown as FetchedUser));
      res.status(200).json({ message: 'Users invited to friends fetched.', invitedToFriends });
    })
    .catch((err) => requestErrorHandler(err, next));
};

const getInvitedFromFriends: Handler = (req, res, next) => {
  const userId = req.params.id;

  User.findById(userId)
    .populate('invitesFrom')
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }
      const invitedFromFriends = (user.invitesFrom || []).map((f) => userDTO(f as unknown as FetchedUser));
      res.status(200).json({ message: 'Users invited to friends fetched.', invitedFromFriends });
    })
    .catch((err) => requestErrorHandler(err, next));
};

const getRelatedServers: Handler = (req, res, next) => {
  const userId = req.params.id;

  User.findById(userId)
    .populate([
      {
        path: 'invitesToChannels',
        populate: { path: 'serverId', populate: { path: 'owner' } },
      },
      {
        path: 'joinedChannels',
        populate: { path: 'serverId', populate: { path: 'owner' } },
      },
    ])
    .then((user) => {
      if (handleDocumentNotFound(user)) {
        Server.find({ owner: userId })
          .populate('owner')
          .then((servers) => {
            const invitedServers: (DTOServer | null)[] = (user.invitesToChannels || [])
              .map((channel) => {
                const server = (channel as unknown as FetchedChannel).serverId as unknown as FetchedServer;
                if (!server) {
                  return null;
                }
                return serverDTO((channel as unknown as FetchedChannel).serverId as unknown as FetchedServer);
              })
              .filter(Boolean);
            const joinedServers: (DTOServer | null)[] = (user.joinedChannels || [])
              .map((channel) => {
                const server = (channel as unknown as FetchedChannel).serverId as unknown as FetchedServer;
                if (!server) {
                  return null;
                }
                return serverDTO((channel as unknown as FetchedChannel).serverId as unknown as FetchedServer);
              })
              .filter(Boolean);
            const ownServers = servers.map((server) => serverDTO(server as unknown as FetchedServer));
            const allServers = invitedServers.concat(joinedServers, ownServers);
            const uniqueAllServers = allServers.filter((server, i) => {
              if (!server) {
                return false;
              }
              return allServers.findIndex((s) => s && s.id === server.id) === i;
            });
            res.status(200).json({
              message: 'Related servers fetched.',
              servers: uniqueAllServers,
            });
          });
      }
    });
};

const getRelatedChannels: Handler = (req, res, next) => {
  const userId = req.params.id;

  User.findById(userId).then((user) => {
    if (handleDocumentNotFound(user)) {
      Server.find({ owner: userId }).then((servers) => {
        const ownServersIDs = servers.map((server) => server.id);
        const inviteChannelsIDs = user.invitesToChannels.map((c) => c.toString());
        Channel.find({
          $or: [
            {
              _id: { $in: inviteChannelsIDs },
            },
            {
              serverId: { $in: ownServersIDs },
            },
          ],
        }).then((channels) => {
          console.log(inviteChannelsIDs);
          console.log(channels);
        });
      });
    }
  });

  res.status(200).end();
};

const updateFriends: Handler = async (req, res, next) => {
  const userId = req.params.id;
  let friendIds = req.body.friends;
  const { action } = req.query;

  if (!validateUserField(friendIds, 'friends')) {
    const error = new Error('Validation failed, entered data is incorrect.');
    // error.statusCode = 422;
    next(error);
    return;
  }

  if (typeof action !== 'string' || !['add', 'delete'].includes(action)) {
    const error = new Error('Validation failed, `action` query parameter is required.');
    // error.statusCode = 422;
    next(error);
    return;
  }

  friendIds = friendIds.filter((id) => id !== userId);

  User.findById(userId)
    .populate('friends')
    .then((user) => {
      if (!user) {
        const error = new Error('Could not find user.');
        // error.statusCode = 404;
        throw error;
      }

      if (action === 'delete') {
        user.friends = user.friends.filter((friend) => !friendIds.includes(friend.id));

        return user.save().then((user) => {
          user.populate('friends').then((user) => {
            res.status(200).json({ messageInfo: 'Friends deleted!', friends: user.friends });
          });
        });
      }

      User.find({ _id: { $in: friendIds } })
        .select('id')
        .then((foundUsers) => {
          const newFriends = foundUsers.map((user) => user.id);
          user.friends = [...new Set([...user.friends.map((user) => user.id), ...newFriends])];

          return user.save();
        })
        .then((user) => {
          user.populate('friends').then((user) => {
            res.status(200).json({ messageInfo: 'Friends added!', friends: user.friends });
          });
        });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

export default {
  getUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  getFriends,
  getInvitedToFriends,
  getInvitedFromFriends,
  updateFriends,
  login,
  register,
  checkAuth,
  logout,
  searchUsers,
  getRelatedServers,
  getRelatedChannels,
};
