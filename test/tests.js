const mongoose = require('mongoose');
const {expect} = require('chai');

const CronPlugin = require('../lib/plugin');

const {Schema} = mongoose;

describe('mongoose-cron', function () {
    it('plugin', function () {
        const MySchema = new Schema({});
        MySchema.plugin(CronPlugin);
        expect(MySchema).to.ok;
    });
});
