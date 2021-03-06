# reusify

[![npm version][npm-badge]][npm-url]
[![Build Status][travis-badge]][travis-url]
[![Coverage Status][coveralls-badge]][coveralls-url]

Reuse your objects and functions for maximum speed. This technique will
make any function run ~10% faster. You call your functions a
lot, and it adds up quickly in hot code paths.

```
$ node benchmarks/createNoCodeFunction.js
Total time 53133
Total iterations 100000000
Iteration/s 1882069.5236482036

$ node benchmarks/reuseNoCodeFunction.js
Total time 50617
Total iterations 100000000
Iteration/s 1975620.838848608
```

The above benchmark uses fibonacci to simulate a real high-cpu load.
The actual numbers might differ for your use case, but the difference
should not.

The benchmark was taken using Node v6.10.0.

This library was extracted from
[fastparallel](http://npm.im/fastparallel).

## Example

```js
var reusify = require('reusify')
var fib = require('reusify/benchmarks/fib')
var instance = reusify(MyObject)

// get an object from the cache
var obj = instance.get()

// set the state
obj.num = 100
obj.func()

// reset the state, if you depend on any
// external object you need to null them
// do not use delete, it is slow
obj.num = 0

// release an object from the cache
instance.release(obj)

function MyObject () {
  // you need to define this property
  // so V8 can compile MyObject into an
  // hidden class
  this.next = null
  this.num = 0

  var that = this

  // this function is never reallocated,
  // so it can be optimized by V8
  this.func = function () {
    if (null) {
      // do nothing
    } else {
      // calculates fibonacci
      fib(that.num)
    }
  }
}
```

The above example was intended for synchronous code, let's see async:
```js
var reusify = require('reusify')
var instance = reusify(MyObject)

for (var i = 0; i < 100, i++) {
  getData(i, console.log)
}

function getData (value, cb) {
  var obj = instance.get()

  obj.value = value
  obj.cb = cb
  obj.run()
}

function MyObject () {
  this.next = null
  that.value = null

  var that = this

  this.run = function () {
    asyncOperation(that.value, that.handle)
  }

  this.handle = function (err, result) {
    that.cb(err, result)
    that.value = null
    that.cb = null
    instance.release(that)
  }
}
```

## Why

It is faster because V8 do not have to collect all the functions you
create. On a short-lived benchmark it is as fast as creating the
nested function, but on a longer time frame it create less
pressure on the garbage collector.

## Other examples
If you want to see some complex example, checkout [middie](https://github.com/fastify/middie) and [steed](https://github.com/mcollina/steed).

## Acknowledgements

Thanks to [Trevor Norris](https://github.com/trevnorris) for
getting me down the rabbit hole of performance, and thanks to [Mathias
Buss](http://github.com/mafintosh) for suggesting me to share this
trick.

## License

MIT

[npm-badge]: https://badge.fury.io/js/reusify.svg
[npm-url]: https://badge.fury.io/js/reusify
[travis-badge]: https://api.travis-ci.org/mcollina/reusify.svg
[travis-url]: https://travis-ci.org/mcollina/reusify
[coveralls-badge]: https://coveralls.io/repos/mcollina/reusify/badge.svg?branch=master&service=github
[coveralls-url]:  https://coveralls.io/github/mcollina/reusify?branch=master
