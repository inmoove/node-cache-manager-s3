# node-cache-manager-fs
Node Cache Manager store for Filesystem
=======================================

The Filesystem store for the [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager) module.

Installation
------------

```sh
npm install https://github.com/inmoove/node-cache-manager-s3 --save
```

Usage examples
--------------

Here are examples that demonstrate how to implement the Filesystem cache store.


## Features

* limit maximum size on disk
* refill cache on startup (in case of application restart)

## Single store

```javascript
// node cachemanager
var cacheManager = require('cache-manager');
// storage for the cachemanager
var s3Store = require('cache-manager-s3');
// initialize caching on disk
var diskCache = cacheManager.caching({store: s3Store, options: {
	path:'diskcache'
	s3: {
		publicURL: '',
		root: '',
        region: '',
        key: '',
        secret: '',
        bucket: ''
	}}
});
```

### Options

options for store initialization

```javascript

options.path = 'cache/'; // path for cached files
options.s3 = {}; // data for s3 connect
```
## Installation

    npm install https://github.com/inmoove/node-cache-manager-s3

## License

node-cache-manager-s3 is licensed under the MIT license.
