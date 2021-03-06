const parser = require('cron-parser');
const Cron = require('./cron');

module.exports = function(schema, options = {}) {
    schema.add({
        cron: {
            _id: false,
            enabled: { // on/off switch
                type: Boolean
            },
            startAt: { // first possible start date
                type: Date, default: Date.now
            },
            stopAt: { // last possible start date (`null` if not recurring)
                type: Date
            },
            interval: { // cron string interval (e.g. `* * * * * *`)
                type: String,
                validate: {
                    validator: function (v) {
                        try {
                            parser.parseExpression(v);
                            return true;
                        } catch (err) {
                            return false;
                        }
                    }
                },
            },
            removeExpired: { // set to `true` for the expired jobs to be automatically deleted
                type: Boolean
            },
            startedAt: { // (automatic) set every time a job processing starts
                type: Date
            },
            processedAt: { // (automatic) set every time a job processing ends
                type: Date
            },
            processedCount: { // (automatic) processed count (success)
                type: Number, default: 0
            },
            locked: { // (automatic) `true` when job is processing
                type: Boolean
            },
            lastError: { // (automatic) last error message
                type: String
            }
        }
    });
    schema.virtual('cron.processDuration').get(function () {
        if (this.cron.processedAt && this.cron.startedAt) {
            return this.cron.processedAt - this.cron.startedAt;
        }
    });
    schema.virtual('cron.processing').get(function () {
        return !this.cron.processedAt && !!this.cron.startedAt;
    });
    schema.set('toObject', { getters: true });

    schema.pre('save', function() {
        if (this.cron.enabled === undefined) {
            this.cron.enabled = true;
        }
    });

    schema.index(
        {'cron.enabled': 1, 'cron.locked': 1, 'cron.startAt': 1, 'cron.stopAt': 1}
    );

    schema.statics.createCron = function(config) {
        return new Cron(this, Object.assign({}, options, config));
    };
};
