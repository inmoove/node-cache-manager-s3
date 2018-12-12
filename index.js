'use strict';

/**
 * Module dependencies
 */
var noop = function() {};
var fs = require("fs");
var fsp = require("fs-promise");
var crypto = require('crypto');
var path = require('path');
var async = require('async');
var extend = require('extend');
var knox = require('knox');
var request = require('request');

/**
 * Export 'S3Store'
 */

module.exports = {
    create: function(args) {
        return new S3Store(args && args.options ? args.options : args);
    }
};

/**
 * Helper function that revives buffers from object representation on JSON.parse
 */
function bufferReviver(k, v) {
    if (
        v !== null &&
        typeof v === 'object' &&
        'type' in v &&
        v.type === 'Buffer' &&
        'data' in v &&
        Array.isArray(v.data)) {
        return new Buffer(v.data);
    }
    return v;
}

/**
 * helper object with meta-informations about the cached data
 */
function MetaData() {

    // the key for the storing
    this.key = null;
    // data to store
    this.value = null;
    // temporary filename for the cached file because filenames cannot represend urls completely
    this.filename = null;
}

/**
 * Remove temp
 */
function deleteTemp(metaData) {
    fsp.exists(metaData.filename).then(function(exists) {
        if (exists) {
            return;
        }
        reject();
    })
    .then(function() {
        return fsp.unlink(metaData.filename);
    }, function() {
        return false;
    }).then(function() {
        return true;
    }.bind(this)).catch(function(err) {
        return false;
    });
}

function encode(options, value) {
    value = (value || '').replace(options.site, '');
    return Buffer.from(value).toString('base64');
}

function decode(options, value) {
    value = (value || '').replace(options.site, '');
	return Buffer.from(value, 'base64').toString('ascii');
}

/**
 * construction of the disk storage
 */
function S3Store(options) {
    options = options || {};

    this.options = extend({
        path: 'cache/',
        tryget: true,
        s3: {}
    }, options);


    // check storage directory for existence (or create it)
    if (!fs.existsSync(this.options.path)) {
        fs.mkdirSync(this.options.path);
    }

    this.name = 's3store';

    // internal array for informations about the cached files - resists in memory
    this.collection = {};

    // TODO: need implement!
    // fill the cache on startup with already existing files
    // if (!options.preventfill) {
    // this.intializefill(options.fillcallback);
    // }
}


/**
 * indicate, whether a key is cacheable
 */
S3Store.prototype.isCacheableValue = function(value) {
    return value !== null && value !== undefined;
};

/**
 * delete an entry from the cache
 */
S3Store.prototype.del = function(key, cb) {
    cb = typeof cb === 'function' ? cb : noop;

    if (!this.collection[key]) {
        return cb(null);
    }

    var client = knox.createClient(this.options.s3);
    client.deleteFile(this.collection[key], function (err, res) {
        if (res && res.statusCode !== 200) {
            this.collection[key] = null;
            delete this.collection[key];
            return cb(null);
        } else {
            cb('Delete failure: '+ res.statusCode);
        }
    });
    return cb(null);
};

/**
 * set a key into the cache
 */
S3Store.prototype.set = function(key, val, options, cb) {
    cb = typeof cb === 'function' ? cb : noop;
    if (typeof options === 'function') {
        cb = options;
        options = null;
    }

    var metaData = extend({}, new MetaData(), {
        key: key,
        value: val,
        filename: this.options.path + '/cache_' + encode(this.options, key) + '.dat'
    });

    var stream = JSON.stringify(metaData);

    metaData.size = stream.length;

    try {
        // write data into the cache-file
        fs.writeFile(metaData.filename, stream, function(err) {

            if (err) {
                return cb(err);
            }

            // remove data value from memory
            metaData.value = null;
            delete metaData.value;

            this.currentsize += metaData.size;

            // upload to s3
            var client = knox.createClient(this.options.s3);
            var s3Path = '/' + metaData.filename;
            if (this.options.s3.root && this.options.s3.root !== "") {
                s3Path = '/' + this.options.s3.root + s3Path;
            }
            client.putFile(metaData.filename, s3Path, { 'x-amz-acl': 'public-read' }, function (err, res) {
                deleteTemp(metaData);
                if (res && res.statusCode !== 200) {
                    this.collection[metaData.key] = this.options.s3.publicURL + s3Path;
                    return cb(null, val);
                } else {
                    return cb('Upload failure: '+ res.statusCode);
                }
            });
        }.bind(this));
    } catch (er) {
        return cb(er);
    }
};

/**
 * get entry from the cache
 */
S3Store.prototype.get = function(key, options, cb) {
    if (typeof options === 'function') {
        cb = options;
    }
    cb = typeof cb === 'function' ? cb : noop;

    // get the metadata from the collection
    var dataurl = this.collection[key];
    if (!dataurl) {
        if (!this.options.tryget) return cb(null, null);
        var s3Path = '/' + this.options.path + '/cache_' + encode(this.options, key) + '.dat';
        if (this.options.s3.root && this.options.s3.root !== "") {
            s3Path = '/' + this.options.s3.root + s3Path;
        }
        dataurl = this.options.s3.publicURL + s3Path;
        var self = this;
        request({ url: dataurl }, function (er, res, body) {
            if (!er || !body) {
                try {
                    var diskdata = JSON.parse(body);
                    self.collection[key] = dataurl;
                    cb(null, diskdata.value);
                } catch(e) {
                    return cb(null, null);
                }
            } else {
                return cb(null, null);
            }
        });
    } else {
        request({ url: dataurl }, function (er, res, body) {
            if (!er || !body) {
                try {
                    var diskdata = JSON.parse(body);
                    this.collection[key] = dataurl;
                    cb(null, diskdata.value);
                } catch(e) {
                    return cb(null, null);
                }
            } else {
                return cb(null, null);
            }
        });
    }
};

/**
 * get keys stored in cache
 * @param {Function} cb
 */
S3Store.prototype.keys = function(cb) {
    cb = typeof cb === 'function' ? cb : noop;
    var keys = Object.keys(this.collection);
    cb(null, keys);
};

/**
 * cleanup cache on disk -> delete all used files from the cache
 */
S3Store.prototype.reset = function(key, cb) {
	// TODO: need implement!
};

/**
 * helper method to clean all expired files
 */
S3Store.prototype.cleanExpired = function() {
	// TODO: need implement!
};

/**
 * clean the complete cache and all(!) files in the cache directory
 */
S3Store.prototype.cleancache = function(cb) {
	// TODO: need implement!
};

/**
 * fill the cache from the cache directory (usefull e.g. on server/service restart)
 */
S3Store.prototype.intializefill = function(cb) {
	// TODO: need implement!
};