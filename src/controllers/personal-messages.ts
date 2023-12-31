import { Handler } from 'express';
import PersonalMessage from '../models/personal-message';
import { DeletedRequestQuery } from '../routes/personal-messages';
import { personalMessageDTO } from '../utils/dto';
import { FetchedPersonalMessage } from '../utils/dto';
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import fs from 'fs';
const getPersonalMessages: Handler = (req, res, next) => {
  let docsCount = 0;

  const { deleted } = req.query;
  let query = () =>
    deleted === DeletedRequestQuery.With
      ? PersonalMessage.find()
      : deleted === DeletedRequestQuery.Only
      ? PersonalMessage.find().byDeleted(true)
      : PersonalMessage.find().byDeleted(false);

  query()
    .countDocuments()
    .then((count) => {
      docsCount = count;
      return query();
    })
    .then((personalMessages) => {
      res.status(200).json({
        message: 'Fetched personal messages successfully.',
        count: docsCount,
        messages: personalMessages,
      });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const createPersonalMessage: Handler = async (req: Request, res: Response, next: NextFunction) => {
  let file: any = req.files ? req.files : '';

  // let fileNameres = '';
  // let fileName = uuidv4() + '.jpg';
  // if (file) {
  //   file.img.mv(path.resolve(__dirname, '../../', 'static', fileName));
  //   fileNameres = fileName;
  // }

  let imageBuffer: Buffer | null = null;
  if (req.file) {
    const buffer = await sharp(req.file.path).resize().jpeg({ quality: 70 }).toBuffer();
    fs.unlinkSync(req.file.path);
    imageBuffer = Buffer.from(buffer.toString('base64'), 'base64');
  }
  const personalMessage = new PersonalMessage({
    fromUserId: req.body.fromUserId,
    toUserId: req.body.toUserId,
    responsedToMessageId: req.body.responsedToMessageId,
    responsedToMessage: req.body.responsedToMessageId,
    message: req.body.message,
    img: imageBuffer,
  });
  personalMessage
    .save()
    .then(() => {
      res.status(201).json({
        message: 'Message created successfully!',
        personalMessage,
      });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const getPersonalMessage: Handler = (req, res, next) => {
  const personalMessageId = req.params.id;

  PersonalMessage.findById(personalMessageId)
    .then((message) => {
      if (!message) {
        const error = new Error('Could not find message.');
        // error.statusCode = 404;
        throw error;
      }
      res.status(200).json({ messageInfo: 'Message fetched.', message: message });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const updatePersonalMessage: Handler = (req, res, next) => {
  const personalMessageId = req.params.id;

  PersonalMessage.findById(personalMessageId)
    .then((message) => {
      if (!message) {
        const error = new Error('Could not find message.');
        // error.statusCode = 404;
        throw error;
      }
      const contentMessage = req.body.message;
      message.message = contentMessage;
      return message.save();
    })
    .then((message) => {
      message.populate('responsedToMessage').then((message) => {
        res
          .status(200)
          .json({ messageInfo: 'Message updated!', message: personalMessageDTO(message as FetchedPersonalMessage) });
      });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

const deletePersonalMessage: Handler = (req, res, next) => {
  const personalMessageId = req.params.id;
  PersonalMessage.findById(personalMessageId)
    .then((message) => {
      if (!message) {
        const error = new Error('Could not find message.');
        // error.statusCode = 404;
        throw error;
      }
      return PersonalMessage.findByIdAndRemove(personalMessageId);
    })
    .then((result) => {
      res.status(200).json({ messageInfo: 'Deleted message.' });
    })
    .catch((err) => {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    });
};

export default {
  getPersonalMessages,
  getPersonalMessage,
  createPersonalMessage,
  updatePersonalMessage,
  deletePersonalMessage,
};
