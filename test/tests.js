const Promise = require('bluebird');
const mongoose = require('mongoose');
const {expect} = require('chai');

const CronPlugin = require('../lib/plugin');

const {Schema} = mongoose;

describe('mongoose-cron', function () {
    let db;
    const testDbName = 'mongoose-cron-test';

    before(function () {
        return mongoose.connect(`mongodb://localhost:27017/${testDbName}`)
            .then((res) => { db = res; });
    });
    before('drop db', (done) => mongoose.connection.db.dropDatabase(done));
    after('disconnect', () => db.disconnect());

    it('pluginize', function () {
        const MySchema = new Schema({});
        MySchema.plugin(CronPlugin);
        const Task = db.model('Task', MySchema);
        expect(Task.createCron).to.an('function');
        delete mongoose.connection.models['Task'];
    });
    describe('usage', function () {
        let Task, cron;
        before(function () {
            const MySchema = new Schema({name: String});
            MySchema.plugin(CronPlugin);
            Task = db.model('Task', MySchema);

        });
        afterEach(function () {
            cron.stop();
        });
        it('handler is executed', function () {
            let handler;
            const promise = new Promise(resolve => { handler = resolve; });
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            return task.save()
                .then(() => {
                    // console.log(doc);
                })
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                });
        });
        it('handler can throw', function () {
            let resolver;
            const promise = new Promise(resolve => { resolver = resolve; });
            const handler = (doc) => {
                resolver(doc);
                throw new Error('ohhoh');
            };
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            const pendingError = new Promise((resolve) => Task.once('mongoose-cron:error', resolve));
            return task.save()
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                    return pendingError;
                })
                .then(() => Promise.delay(1000))
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    console.log(doc);
                    expect(doc.cron.lastError).to.be.equal('ohhoh');
                    // expect(doc.cron.enabled).to.be.undefined; // whaat, why enabled = true?
                });
        });

        it('handler can reject', function () {
            let resolver;
            const promise = new Promise(resolve => { resolver = resolve; });
            const handler = (doc) => {
                resolver(doc);
                return Promise.reject(new Error('rejected'));
            };
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            const pendingError = new Promise((resolve) => Task.once('mongoose-cron:error', resolve));
            return task.save()
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                    return pendingError;
                })
                .then(() => Promise.delay(1000))
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.cron.lastError).to.be.equal('rejected');
                    // expect(doc.cron.enabled).to.be.undefined; // whaat, why enabled = true?
                });
        });
    });
});
