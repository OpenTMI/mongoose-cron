'use strict';

/* initializing mongodb */

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const dbhost = process.env.DB_HOST || 'localhost:27017';
const dbname = process.env.DB_NAME || 'testdb';
const db = mongoose.connect(`mongodb://${dbhost}/${dbname}`, { useNewUrlParser: true });

/* defining polymorphic model with support for cron */

const {cronPlugin} = require('..');

let noteSchema = new mongoose.Schema({
  name: {type: String}
});
let checklistSchema = new mongoose.Schema({
  description: {type: String}
});
let reminderSchema = new mongoose.Schema({
  description: {type: String}
});

noteSchema.plugin(cronPlugin, {
  handler: doc => console.log('processing', doc.name)
});

let Note = mongoose.model('Note', noteSchema);
let Checklist = Note.discriminator('Checklist', checklistSchema);
let Reminder = Note.discriminator('Reminder', reminderSchema);

/* creating cron worker and starting the heartbit */

let cron = Note.createCron().start();

/* sedding */

Checklist.create({
  name: 'Job 1',
  description: 'ignored by the cron heartbeat'
}).then(res => {}).catch(console.log);

Reminder.create({
  name: 'Job 2',
  description: 'remind me every 1s',
  cron: {
    enabled: true,
    startAt: new Date(),
    interval: '* * * * * *'
  }
}).then(res => {}).catch(console.log);
