const Promise = require('bluebird');
const mongoose = require('mongoose');
const sinon = require('sinon');
const moment = require('moment');
const {expect} = require('chai');

const CronPlugin = require('../lib/plugin');

const {Schema} = mongoose;

describe('mongoose-cron', function () {
    let db;
    const testDbName = 'mongoose-cron-test';

    before(function () {
        return mongoose.connect(`mongodb://localhost:27017/${testDbName}`, { useNewUrlParser: true })
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
        afterEach(function () {
            return Task.deleteMany({});
        });
        const waitTaskEvent = (event) => new Promise((resolve) => Task.once(event, resolve));
        const waitNextTick = () => waitTaskEvent('mongoose-cron:nextTick');
        const waitTaskErrorEvent = () => waitTaskEvent('mongoose-cron:error');

        it('task is executed', function () {
            let handler = sinon.stub();
            cron = Task.createCron({handler}).start();
            expect(cron.start()).to.be.equal(cron);
            expect(cron.isRunning()).to.be.true;
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            return task.save()
                .then(() => waitNextTick())
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc).to.be.ok;
                    expect(doc.cron.enabled).to.be.true;
                    expect(handler.callCount).to.be.equal(1);
                });
        });
        it('long task is executed', function () {
            let handler = sinon.stub().callsFake(() => Promise.delay(1000));
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            return task.save()
                .then(() => Promise.delay(100))
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.cron.processedCount).to.be.equal(0);
                    expect(doc.cron.processing).to.be.true;
                })
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.cron.processedCount).to.be.equal(1);
                    expect(doc.cron.processing).to.be.false;
                    expect(handler.callCount).to.be.equal(1);
                });
        });
        it('one time job', function () {
            let handler;
            const promise = new Promise(resolve => { handler = resolve; });
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a'});
            return task.save()
                .then(() => promise)
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                    expect(doc.cron.enabled).to.be.false;
                });
        });
        it('document with `interval` should run repeatedly', function () {
            let handler = sinon.stub();
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.interval': '* * * * * *'});
            return task.save()
                .then(() => waitNextTick())
                .then(() => {
                    expect(handler.callCount).to.be.equal(1);
                })
                .then(() => Promise.delay(1000))
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(handler.callCount).to.be.at.least(2);
                    expect(doc.cron.processedCount).to.be.at.least(2);
                });
        });
        it('document processing should not start before `startAt`', function () {
            let handler = sinon.stub();
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a',
                'cron.startAt': moment().add(1, 'seconds').toDate(),
                'cron.interval': '* * * * * *'
            });
            return task.save()
                .then(() => waitNextTick())
                .then(() => waitNextTick())
                .then(() => {
                    expect(handler.callCount).to.be.equal(0);
                })
                .then(() => Promise.delay(1000))
                .then(() => waitNextTick())
                .then(() => {
                    expect(handler.callCount).to.be.equal(1);
                });
        });
        it('condition should filter lockable documents', function () {
            let handler = sinon.stub();
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a',
                'cron.locked': true,
                'cron.interval': '* * * * * *'
            });
            return task.save()
                .then(() => waitNextTick())
                .then(() => waitNextTick())
                .then(() => {
                    expect(handler.callCount).to.be.equal(0);
                });
        });
        it('task can be disabled', function () {
            let handler;
            const promise = new Promise(resolve => { handler = resolve; });
            cron = Task.createCron({handler}).start();
            const task = new Task({name: 'a', 'cron.enabled': false, 'cron.interval': '* * * * * *'});
            return task.save()
                .then(() => waitNextTick())
                .then(() => waitNextTick())
                .then(() => promise.timeout(10)
                    .reflect()
                    .then((promise) => {
                        expect(promise.isRejected()).to.be.true;
                    }));
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
            const pendingError = waitTaskErrorEvent();
            return task.save()
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                    return pendingError;
                })
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.cron.lastError).to.be.equal('ohhoh');
                    expect(doc.cron.enabled).to.be.undefined;
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
            const pendingError = waitTaskErrorEvent();
            return task.save()
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                    return pendingError;
                })
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc.cron.lastError).to.be.equal('rejected');
                    expect(doc.cron.enabled).to.be.undefined;
                });
        });
        it('document with `removeExpired` should be deleted after stopAt', function () {
            this.timeout(5000);
            let handler;
            const promise = new Promise(resolve => { handler = resolve; });
            cron = Task.createCron({handler}).start();
            const task = new Task({
                name: 'a',
                cron: {
                    stopAt: moment().add(500, 'ms').toDate(),
                    removeExpired: true,
                    interval: '* * * * * *'
                }});
            return task.save()
                .then(() => waitNextTick())
                .then(() => promise)
                .then((doc) => {
                    expect(doc.name).to.be.equal('a');
                })
                .then(() => Promise.delay(500))
                .then(() => waitNextTick())
                .then(() => Task.findOne({name: 'a'}))
                .then((doc) => {
                    expect(doc).to.be.null;
                });
        });
    });
});
