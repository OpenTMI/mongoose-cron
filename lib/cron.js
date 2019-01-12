const moment = require('moment');
const later = require('later');
const {EventEmitter} = require('events');
const {CronNoDocumentError} = require('./errors');

module.exports = class Cron extends EventEmitter {
    /**
     * Cron constructor
     * @param {mongoose.Model}model
     * @param {Object}config
     */
    constructor(model, config) {
        super();

        this._model = model;
        this._handler = config.handler;
        this._running = false;
        this._heartbeat = null;
        this._idleDelay = config.idleDelay || 1; // when there are no jobs for processing, wait 1 sek before continue
        this._nextDelay = config.nextDelay || 0; // wait 0 min before processing the same job again
        this._tickDelay = config.tickDelay || 0; // time between job completion and looking for a new job
        this._addToQuery = config.addToQuery || [];
    }

    /**
     * Returns true if the cron is running.
     */
    isRunning() {
        return this._running;
    }

    /**
     * Starts the heartbit.
     */
    start(delay) {
        if (this._running) return this;

        this._running = true;
        this._nextTick(delay);

        return this;
    }

    /**
     * Stops the heartbit of the schedule.
     */
    stop() {
        clearTimeout(this._heartbeat);
        this._running = false;

        return this;
    }

    /**
     * Returns the next date when the job should be processed or `null` if the job
     * is expired or not recurring.
     */
    getNextStart(doc) {
        if (!doc.cron.interval) { // not recurring job
            return null;
        }

        let future = moment().add(this._nextDelay, 'millisecond'); // date when the next start is possible
        let start = moment(doc.cron.startAt);
        if (start >= future) { // already in future
            return doc.cron.startAt;
        }

        try { // new date
            let schedule = later.parse.cron(doc.cron.interval, true);
            let dates = later.schedule(schedule).next(2, future.toDate(), doc.cron.stopAt);
            return dates[1];
        } catch (err) {
            return null;
        }
    }

    /**
     * Private method which is called on every heartbit.
     */
    _tick() {
        if (!this._running) return;

        let tickDate = new Date();
        let doc = null;
        return this._model.findOneAndUpdate(
            {$and: [
                {'cron.enabled': true, 'cron.locked': {$exists: false}},
                {$or: [{'cron.startAt': {$lte: tickDate}}, {'cron.startAt': {$exists: false}}]},
                {$or: [{'cron.stopAt': {$gte: tickDate}}, {'cron.stopAt': {$exists: false}}]}
            ].concat(this._addToQuery)},
            {'cron.locked': true,
                'cron.startedAt': tickDate
            },
            {sort: {'cron.startAt': 1}}
        )
            .then(res => {
                if(!res)
                    // no active tasks
                    return Promise.resolve();
                doc = res;
                return this._handleDocument(doc)
                    .then(() => this._rescheduleDocument(doc));
            })
            .then(() => this._nextTick(this._tickDelay))
            .catch(err => this._handleError(err, doc));
    }

    /**
     * Private method which starts the next tick.
     */
    _nextTick(delay) {
        if (!delay) {
            return this._tick();
        } else {
            clearTimeout(this._heartbeat);
            this._heartbeat = setTimeout(this._tick.bind(this), delay);
        }
    }

    /**
     * Private method which processes a document of a tick.
     */
    _handleDocument(doc) {
        if (!doc) {
            throw new CronNoDocumentError();
        } else {
            return Promise.resolve()
                .then(() => this._handler(doc));
        }
    }

    /**
     * Private method which tries to reschedule a document, marks it as expired or
     * deletes a job if `removeExpired` is set to `true`.
     */
    _rescheduleDocument(doc) {
        let nextStart = this.getNextStart(doc);
        if (!nextStart) {
            if (doc.cron.removeExpired === true) {
                return doc.remove(); // delete
            } else {
                return doc.update({
                    $unset: {'cron.enabled': 1, 'cron.locked': 1, 'cron.lastError': 1},
                    'cron.processedAt': new Date()
                }); // mark as expired
            }
        } else {
            return doc.update({
                $unset: {'cron.locked': 1, 'cron.lastError': 1},
                'cron.processedAt': new Date(), 'cron.startAt': nextStart
            }); // continue
        }
    }

    /*
  * Private method for handling errors.
  */
    _handleError(err, doc) {
        let delay = 0;
        let promise = Promise.resolve();

        switch(err.name) {
        case 'CronNoDocumentError':
            delay = this._idleDelay;
            break;
        default:
            if (doc) {
                promise = promise
                    .then(() => doc.update({
                        $unset: {'cron.enabled': 1, 'cron.locked': 1},
                        'cron.lastError': err.message
                    }))
                    .then(() => {
                        this._model.emit('mongoose-cron:error', err, doc);
                    });
            } else {
                this._model.emit('mongoose-cron:error', err);
            }
        }
        return promise.then(() => this._nextTick(delay || this._tickDelay))
            .catch(err => this._handleError(err));
    }
};
